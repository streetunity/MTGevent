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
`);

export function loadPlayers(): Player[] {
  return db
    .getAllSync<{ id: string; name: string; created_at: number; updated_at: number }>('SELECT * FROM players ORDER BY name COLLATE NOCASE')
    .map((r) => ({ id: r.id, name: r.name, createdAt: r.created_at, updatedAt: r.updated_at }));
}

export function savePlayer(p: Player) {
  db.runSync(
    'INSERT INTO players (id, name, created_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at',
    p.id, p.name, p.createdAt, p.updatedAt,
  );
}

export function deletePlayer(id: string) {
  db.runSync('DELETE FROM players WHERE id = ?', id);
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
  db.runSync('DELETE FROM events WHERE id = ?', id);
}

export function getSetting<T>(key: string): T | undefined {
  const row = db.getFirstSync<{ value: string }>('SELECT value FROM settings WHERE key = ?', key);
  return row ? (JSON.parse(row.value) as T) : undefined;
}

export function setSetting(key: string, value: unknown) {
  db.runSync('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, JSON.stringify(value));
}

/** Everything in one JSON blob, for backup/export. */
export function exportAll() {
  return { version: 1, exportedAt: Date.now(), players: loadPlayers(), events: loadEvents() };
}
