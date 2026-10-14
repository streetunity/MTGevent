// Local SQLite storage. Players are a table (shared roster); each event is
// stored as one JSON document, which keeps the schema simple and makes a
// future sync-to-server step a matter of uploading documents.
import * as SQLite from 'expo-sqlite';
import { Player, TournamentEvent } from '../core/types';

const db = SQLite.openDatabaseSync('mtgevent.db');

db.execSync(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS players (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY NOT NULL,
    status TEXT NOT NULL,
    date INTEGER NOT NULL,
    data TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
  );
  -- "tombstones": a record of what was deleted and when, so a future sync can
  -- tell other devices to delete it too instead of copying it back
  CREATE TABLE IF NOT EXISTS deletions (
    id TEXT NOT NULL,
    kind TEXT NOT NULL,
    deleted_at INTEGER NOT NULL,
    PRIMARY KEY (kind, id)
  );
`);

function tombstone(kind: 'event' | 'player', id: string) {
  db.runSync(
    'INSERT INTO deletions (id, kind, deleted_at, synced) VALUES (?, ?, ?, 0) ON CONFLICT(kind, id) DO UPDATE SET deleted_at = excluded.deleted_at, synced = 0',
    id, kind, Date.now(),
  );
}

export type Deletion = { id: string; kind: 'event' | 'player'; deletedAt: number };

// migrations
const colsOf = (t: string) => db.getAllSync<{ name: string }>(`PRAGMA table_info(${t})`).map((c) => c.name);
if (!colsOf('players').includes('legacy')) db.execSync('ALTER TABLE players ADD COLUMN legacy TEXT');
// sync bookkeeping: dirty = changed on this phone and not uploaded yet (existing rows start dirty
// so the first sync uploads everything); synced = this deletion has been sent to the server
if (!colsOf('players').includes('dirty')) db.execSync('ALTER TABLE players ADD COLUMN dirty INTEGER NOT NULL DEFAULT 1');
if (!colsOf('events').includes('dirty')) db.execSync('ALTER TABLE events ADD COLUMN dirty INTEGER NOT NULL DEFAULT 1');
if (!colsOf('deletions').includes('synced')) db.execSync('ALTER TABLE deletions ADD COLUMN synced INTEGER NOT NULL DEFAULT 0');

export function loadPlayers(): Player[] {
  return db
    .getAllSync<{ id: string; name: string; created_at: number; updated_at: number; legacy: string | null }>('SELECT * FROM players ORDER BY name COLLATE NOCASE')
    .map((r) => ({
      id: r.id, name: r.name, createdAt: r.created_at, updatedAt: r.updated_at,
      ...(r.legacy ? { legacy: JSON.parse(r.legacy) } : {}),
    }));
}

export function savePlayer(p: Player) {
  db.runSync(
    'INSERT INTO players (id, name, created_at, updated_at, legacy, dirty) VALUES (?, ?, ?, ?, ?, 1) ON CONFLICT(id) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at, legacy = excluded.legacy, dirty = 1',
    p.id, p.name, p.createdAt, p.updatedAt, p.legacy ? JSON.stringify(p.legacy) : null,
  );
}

export function deletePlayer(id: string) {
  db.withTransactionSync(() => {
    db.runSync('DELETE FROM players WHERE id = ?', id);
    tombstone('player', id);
  });
}

export function loadEvents(): TournamentEvent[] {
  return db
    .getAllSync<{ data: string }>('SELECT data FROM events ORDER BY date DESC')
    .map((r) => JSON.parse(r.data) as TournamentEvent);
}

export function saveEvent(ev: TournamentEvent) {
  db.runSync(
    'INSERT INTO events (id, status, date, data, updated_at, dirty) VALUES (?, ?, ?, ?, ?, 1) ON CONFLICT(id) DO UPDATE SET status = excluded.status, date = excluded.date, data = excluded.data, updated_at = excluded.updated_at, dirty = 1',
    ev.id, ev.status, ev.date, JSON.stringify(ev), ev.updatedAt,
  );
}

export function deleteEvent(id: string) {
  db.withTransactionSync(() => {
    db.runSync('DELETE FROM events WHERE id = ?', id);
    tombstone('event', id);
  });
}

export function getSetting<T>(key: string): T | undefined {
  const row = db.getFirstSync<{ value: string }>('SELECT value FROM settings WHERE key = ?', key);
  return row ? (JSON.parse(row.value) as T) : undefined;
}

export function setSetting(key: string, value: unknown) {
  db.runSync('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, JSON.stringify(value));
}

export function clearAllLegacy() {
  db.runSync('UPDATE players SET legacy = NULL, updated_at = ?, dirty = 1 WHERE legacy IS NOT NULL', Date.now());
}

export function deleteAllEvents() {
  db.withTransactionSync(() => {
    for (const r of db.getAllSync<{ id: string }>('SELECT id FROM events')) tombstone('event', r.id);
    db.runSync('DELETE FROM events');
  });
}

/** Wipe players, events and saved settings. */
export function resetAll() {
  db.withTransactionSync(() => {
    db.runSync('DELETE FROM events');
    db.runSync('DELETE FROM players');
    db.runSync('DELETE FROM settings');
    // a full reset starts this device over from scratch, so its delete history goes too
    db.runSync('DELETE FROM deletions');
  });
}

/** Everything in one JSON blob, for backup/export. */
export function exportAll() {
  return { version: 1, exportedAt: Date.now(), players: loadPlayers(), events: loadEvents() };
}

// ───────────────────────── sync support ─────────────────────────
// Used only by src/sync. Local edits go through savePlayer/saveEvent (which mark rows dirty);
// changes downloaded from the server go through the applyRemote* functions (which don't).

export function dirtyPlayers(): Player[] {
  return db
    .getAllSync<{ id: string; name: string; created_at: number; updated_at: number; legacy: string | null }>('SELECT * FROM players WHERE dirty = 1')
    .map((r) => ({ id: r.id, name: r.name, createdAt: r.created_at, updatedAt: r.updated_at, ...(r.legacy ? { legacy: JSON.parse(r.legacy) } : {}) }));
}

export function dirtyEvents(): TournamentEvent[] {
  return db.getAllSync<{ data: string }>('SELECT data FROM events WHERE dirty = 1').map((r) => JSON.parse(r.data) as TournamentEvent);
}

export function unsyncedDeletions(): Deletion[] {
  return db
    .getAllSync<{ id: string; kind: 'event' | 'player'; deleted_at: number }>('SELECT * FROM deletions WHERE synced = 0')
    .map((r) => ({ id: r.id, kind: r.kind, deletedAt: r.deleted_at }));
}

/** After an upload: clear the dirty flag, unless the row was edited again while uploading. */
export function markClean(kind: 'player' | 'event', id: string, updatedAt: number) {
  db.runSync(`UPDATE ${kind === 'player' ? 'players' : 'events'} SET dirty = 0 WHERE id = ? AND updated_at = ?`, id, updatedAt);
}

export function markDeletionSynced(d: Deletion) {
  db.runSync('UPDATE deletions SET synced = 1 WHERE kind = ? AND id = ? AND deleted_at = ?', d.kind, d.id, d.deletedAt);
}

/** Mark everything as needing upload (used when joining a league with existing data). */
export function markAllDirty() {
  db.withTransactionSync(() => {
    db.runSync('UPDATE players SET dirty = 1');
    db.runSync('UPDATE events SET dirty = 1');
    db.runSync('UPDATE deletions SET synced = 0');
  });
}

function localState(kind: 'player' | 'event', id: string) {
  return db.getFirstSync<{ updated_at: number; dirty: number }>(`SELECT updated_at, dirty FROM ${kind === 'player' ? 'players' : 'events'} WHERE id = ?`, id);
}

/** Keep a local edit that is newer than what the server sent (it gets uploaded next sync). */
function localWins(kind: 'player' | 'event', id: string, remoteAt: number) {
  const cur = localState(kind, id);
  return !!cur && cur.dirty === 1 && cur.updated_at > remoteAt;
}

/** Returns true if anything changed locally. */
export function applyRemotePlayer(p: Player): boolean {
  if (localWins('player', p.id, p.updatedAt)) return false;
  db.runSync(
    'INSERT INTO players (id, name, created_at, updated_at, legacy, dirty) VALUES (?, ?, ?, ?, ?, 0) ON CONFLICT(id) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at, legacy = excluded.legacy, dirty = 0',
    p.id, p.name, p.createdAt, p.updatedAt, p.legacy ? JSON.stringify(p.legacy) : null,
  );
  db.runSync('DELETE FROM deletions WHERE kind = ? AND id = ?', 'player', p.id);
  return true;
}

export function applyRemoteEvent(ev: TournamentEvent): boolean {
  if (localWins('event', ev.id, ev.updatedAt)) return false;
  db.runSync(
    'INSERT INTO events (id, status, date, data, updated_at, dirty) VALUES (?, ?, ?, ?, ?, 0) ON CONFLICT(id) DO UPDATE SET status = excluded.status, date = excluded.date, data = excluded.data, updated_at = excluded.updated_at, dirty = 0',
    ev.id, ev.status, ev.date, JSON.stringify(ev), ev.updatedAt,
  );
  db.runSync('DELETE FROM deletions WHERE kind = ? AND id = ?', 'event', ev.id);
  return true;
}

export function applyRemoteDeletion(d: Deletion): boolean {
  if (localWins(d.kind, d.id, d.deletedAt)) return false;
  const existed = !!localState(d.kind, d.id);
  db.withTransactionSync(() => {
    db.runSync(`DELETE FROM ${d.kind === 'player' ? 'players' : 'events'} WHERE id = ?`, d.id);
    db.runSync(
      'INSERT INTO deletions (id, kind, deleted_at, synced) VALUES (?, ?, ?, 1) ON CONFLICT(kind, id) DO UPDATE SET deleted_at = excluded.deleted_at, synced = 1',
      d.id, d.kind, d.deletedAt,
    );
  });
  return existed;
}

/** Wipe players and events only (keeps settings such as the sign-in) — used for "replace with league data". */
export function wipeRosterAndEvents() {
  db.withTransactionSync(() => {
    db.runSync('DELETE FROM events');
    db.runSync('DELETE FROM players');
    db.runSync('DELETE FROM deletions');
  });
}
