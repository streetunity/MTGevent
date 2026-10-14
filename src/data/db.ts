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
    'INSERT INTO deletions (id, kind, deleted_at) VALUES (?, ?, ?) ON CONFLICT(kind, id) DO UPDATE SET deleted_at = excluded.deleted_at',
    id, kind, Date.now(),
  );
}

export function loadDeletions(since = 0): Array<{ id: string; kind: 'event' | 'player'; deletedAt: number }> {
  return db
    .getAllSync<{ id: string; kind: 'event' | 'player'; deleted_at: number }>('SELECT * FROM deletions WHERE deleted_at > ? ORDER BY deleted_at', since)
    .map((r) => ({ id: r.id, kind: r.kind, deletedAt: r.deleted_at }));
}

// migrations
const cols = db.getAllSync<{ name: string }>('PRAGMA table_info(players)').map((c) => c.name);
if (!cols.includes('legacy')) db.execSync('ALTER TABLE players ADD COLUMN legacy TEXT');

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
    'INSERT INTO players (id, name, created_at, updated_at, legacy) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at, legacy = excluded.legacy',
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
    'INSERT INTO events (id, status, date, data, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET status = excluded.status, date = excluded.date, data = excluded.data, updated_at = excluded.updated_at',
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
  db.runSync('UPDATE players SET legacy = NULL, updated_at = ?', Date.now());
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
