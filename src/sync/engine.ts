// One sync pass: upload what changed on this phone, download what changed on the server.
// Conflict rules match the server: newest edit wins, deletions beat older edits,
// an edit made after a deletion brings the item back.
import * as db from '../data/db';
import { extendSeasons, SeasonSettings } from '../core/seasons';
import { Api, SyncResult, SyncSetting } from './api';

export interface SeasonsMeta { updatedAt: number; dirty: boolean }

export interface PassResult {
  cursor: number;
  /** something local changed → the UI should reload */
  changed: boolean;
  uploaded: number;
  downloaded: number;
  /** items the server refused as invalid (would never sync) */
  invalid: number;
}

function pendingSeasons(): SyncSetting[] {
  const meta = db.getSetting<SeasonsMeta>('seasonsMeta');
  const value = db.getSetting<SeasonSettings>('seasons');
  return meta?.dirty && value ? [{ name: 'seasons', value, updatedAt: meta.updatedAt }] : [];
}

/** How many local changes are waiting to upload. */
export function pendingCount(): number {
  return db.dirtyPlayers().length + db.dirtyEvents().length + db.unsyncedDeletions().length + pendingSeasons().length;
}

function apply(res: SyncResult): { changed: boolean; downloaded: number } {
  let changed = false, downloaded = 0;
  const note = (c: boolean) => { if (c) { changed = true; downloaded++; } };
  for (const d of res.deletions) note(db.applyRemoteDeletion(d));
  for (const p of res.players) note(db.applyRemotePlayer(p));
  for (const e of res.events) note(db.applyRemoteEvent(e));
  for (const s of res.settings) {
    if (s.name !== 'seasons') continue;
    const meta = db.getSetting<SeasonsMeta>('seasonsMeta');
    if (meta?.dirty && meta.updatedAt > s.updatedAt) continue; // our newer change uploads next time
    db.setSetting('seasons', extendSeasons(s.value));
    db.setSetting('seasonsMeta', { updatedAt: s.updatedAt, dirty: false } satisfies SeasonsMeta);
    note(true);
  }
  return { changed, downloaded };
}

export async function syncPass(api: Api, leagueId: string, cursor: number): Promise<PassResult> {
  const players = db.dirtyPlayers();
  const events = db.dirtyEvents();
  const deletions = db.unsyncedDeletions();
  const settings = pendingSeasons();

  const res = await api.sync(leagueId, { cursor, players, events, deletions, settings });

  // everything we sent is now settled on the server one way or the other
  for (const p of players) db.markClean('player', p.id, p.updatedAt);
  for (const e of events) db.markClean('event', e.id, e.updatedAt);
  for (const d of deletions) db.markDeletionSynced(d);
  for (const s of settings) {
    const meta = db.getSetting<SeasonsMeta>('seasonsMeta');
    if (meta && meta.updatedAt === s.updatedAt) db.setSetting('seasonsMeta', { ...meta, dirty: false });
  }

  let { changed, downloaded } = apply(res);
  let newCursor = res.cursor;
  const invalid = res.rejected.filter((r) => r.reason === 'invalid' || r.reason === 'too_large').length;

  // The server kept a newer copy of something we sent. Download everything once so this
  // phone ends up with the server's version even if we'd already seen it before.
  if (res.rejected.length > invalid) {
    const full = await api.sync(leagueId, { cursor: 0, players: [], events: [], deletions: [], settings: [] });
    const r2 = apply(full);
    changed = changed || r2.changed;
    downloaded += r2.downloaded;
    newCursor = full.cursor;
  }

  return { cursor: newCursor, changed, uploaded: players.length + events.length + deletions.length + settings.length, downloaded, invalid };
}
