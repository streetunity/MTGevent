// Pure state transitions for an event. Each returns a new event object.
import { newId } from './id';
import { pairRound, PairingOptions, recommendedRounds, swapPlayers } from './pairing';
import { DEFAULT_SETTINGS, EventSettings, Id, Round, TournamentEvent } from './types';

const touch = (ev: TournamentEvent): TournamentEvent => ({ ...ev, updatedAt: Date.now() });

export function createEvent(title: string, settings: Partial<EventSettings> = {}, date = Date.now()): TournamentEvent {
  const now = Date.now();
  return {
    id: newId(), title, date, status: 'setup',
    settings: { ...DEFAULT_SETTINGS, ...settings },
    players: [], rounds: [], createdAt: now, updatedAt: now,
  };
}

export function defaultTitle(date = new Date()): string {
  const day = date.toLocaleDateString('en-US', { weekday: 'long' });
  const md = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${day} Night Magic – ${md}`;
}

function withAutoRounds(ev: TournamentEvent): TournamentEvent {
  if (!ev.settings.autoRounds || ev.status !== 'setup') return ev;
  return { ...ev, settings: { ...ev.settings, rounds: recommendedRounds(ev.players.length) } };
}

export function updateSettings(ev: TournamentEvent, patch: Partial<EventSettings>): TournamentEvent {
  const settings = { ...ev.settings, ...patch };
  if (patch.rounds !== undefined) settings.autoRounds = false;
  return touch(withAutoRounds({ ...ev, settings }));
}

export function currentRound(ev: TournamentEvent): Round | undefined {
  return ev.rounds[ev.rounds.length - 1];
}

/** Add a player. During setup they play from round 1; once running they join the next unpaired round. */
export function addPlayer(ev: TournamentEvent, playerId: Id): TournamentEvent {
  if (ev.players.some((p) => p.playerId === playerId)) return ev;
  const cur = currentRound(ev);
  let joinedRound = 1;
  if (cur) joinedRound = cur.status === 'pairing' ? cur.number : cur.number + 1;
  let next = { ...ev, players: [...ev.players, { playerId, joinedRound }] };
  // a late add during the pairing step should be re-paired in
  return touch(withAutoRounds(next));
}

/** Remove completely (only safe before they've played). */
export function removePlayer(ev: TournamentEvent, playerId: Id): TournamentEvent {
  const hasPlayed = ev.rounds.some((r) => r.status !== 'pairing' && r.matches.some((m) => m.p1 === playerId || m.p2 === playerId));
  if (hasPlayed) return dropPlayer(ev, playerId);
  const rounds = ev.rounds.map((r) =>
    r.status === 'pairing' ? { ...r, matches: r.matches.filter((m) => m.p1 !== playerId && m.p2 !== playerId) } : r);
  return touch(withAutoRounds({ ...ev, rounds, players: ev.players.filter((p) => p.playerId !== playerId) }));
}

/**
 * Drop a player. They keep their record and stay in the standings,
 * but won't be paired after the current round.
 * If the current round is still being paired, they're removed from it.
 */
export function dropPlayer(ev: TournamentEvent, playerId: Id): TournamentEvent {
  const cur = currentRound(ev);
  const lastRound = cur ? (cur.status === 'pairing' ? cur.number - 1 : cur.number) : 0;
  const players = ev.players.map((p) => (p.playerId === playerId ? { ...p, droppedAfterRound: lastRound } : p));
  const next = { ...ev, players };
  // dropping during the pairing step re-pairs the round without them
  if (cur?.status === 'pairing') return repairCurrent(next);
  return touch(next);
}

export function undropPlayer(ev: TournamentEvent, playerId: Id): TournamentEvent {
  const players = ev.players.map((p) => (p.playerId === playerId ? { ...p, droppedAfterRound: undefined } : p));
  return touch({ ...ev, players });
}

function newRound(ev: TournamentEvent, number: number, opts?: PairingOptions): Round {
  return {
    number, status: 'pairing',
    matches: pairRound(ev, number, opts),
    timer: { durationMs: ev.settings.roundMinutes * 60_000, elapsedMs: 0 },
  };
}

/** Lock in the player list and generate round 1 pairings. */
export function startEvent(ev: TournamentEvent, opts?: PairingOptions): TournamentEvent {
  const base = { ...ev, status: 'running' as const };
  return touch({ ...base, rounds: [newRound(base, 1, opts)] });
}

/** Throw away the current (unstarted) round's pairings and pair again. */
export function repairCurrent(ev: TournamentEvent, opts?: PairingOptions): TournamentEvent {
  const cur = currentRound(ev);
  if (!cur || cur.status !== 'pairing') return ev;
  const without = { ...ev, rounds: ev.rounds.slice(0, -1) };
  return touch({ ...ev, rounds: [...without.rounds, newRound(without, cur.number, opts)] });
}

export function swapInCurrent(ev: TournamentEvent, a: Id, b: Id): TournamentEvent {
  const cur = currentRound(ev);
  if (!cur || cur.status === 'complete') return ev;
  const rounds = ev.rounds.map((r) => (r === cur ? { ...r, matches: swapPlayers(r.matches, a, b) } : r));
  return touch({ ...ev, rounds });
}

/** Pairings are final; start the round (the timer is started separately). */
export function beginRound(ev: TournamentEvent): TournamentEvent {
  const cur = currentRound(ev);
  if (!cur || cur.status !== 'pairing' || cur.matches.length === 0) return ev;
  return touch({ ...ev, rounds: ev.rounds.map((r) => (r === cur ? { ...r, status: 'active' as const } : r)) });
}

/** Report or correct any match result, in any round. */
export function reportResult(ev: TournamentEvent, matchId: Id, p1Games: number, p2Games: number): TournamentEvent {
  const rounds = ev.rounds.map((r) => ({
    ...r,
    matches: r.matches.map((m) => (m.id === matchId && m.p2 ? { ...m, p1Games, p2Games, reported: true } : m)),
  }));
  return touch({ ...ev, rounds });
}

export function clearResult(ev: TournamentEvent, matchId: Id): TournamentEvent {
  const rounds = ev.rounds.map((r) => ({
    ...r,
    matches: r.matches.map((m) => (m.id === matchId && m.p2 ? { ...m, p1Games: 0, p2Games: 0, reported: false } : m)),
  }));
  return touch({ ...ev, rounds });
}

export function unreportedCount(r: Round): number {
  return r.matches.filter((m) => !m.reported).length;
}

/** Close the current round (all results must be in) and pair the next, or finish. */
export function completeRound(ev: TournamentEvent, opts?: PairingOptions): TournamentEvent {
  const cur = currentRound(ev);
  if (!cur || cur.status !== 'active' || unreportedCount(cur) > 0) return ev;
  const closed: TournamentEvent = {
    ...ev,
    rounds: ev.rounds.map((r) => (r === cur ? { ...r, status: 'complete' as const, timer: { ...r.timer, runningSince: undefined } } : r)),
  };
  if (cur.number >= ev.settings.rounds) return touch({ ...closed, status: 'complete' });
  return touch({ ...closed, rounds: [...closed.rounds, newRound(closed, cur.number + 1, opts)] });
}

/** Add one more round beyond the planned count (e.g. a tie you want to settle). */
export function addExtraRound(ev: TournamentEvent, opts?: PairingOptions): TournamentEvent {
  if (ev.status !== 'complete') return ev;
  const last = currentRound(ev);
  const n = (last?.number ?? 0) + 1;
  const reopened = { ...ev, status: 'running' as const, settings: { ...ev.settings, rounds: n } };
  return touch({ ...reopened, rounds: [...ev.rounds, newRound(reopened, n, opts)] });
}

export function finishEarly(ev: TournamentEvent): TournamentEvent {
  const cur = currentRound(ev);
  let rounds = ev.rounds;
  if (cur && cur.status === 'pairing') rounds = rounds.slice(0, -1);
  return touch({ ...ev, rounds, status: 'complete' });
}

// ---- timer ----

export function timerRemainingMs(r: Round, now = Date.now()): number {
  const t = r.timer;
  const elapsed = t.elapsedMs + (t.runningSince ? now - t.runningSince : 0);
  return t.durationMs - elapsed;
}

function mapTimer(ev: TournamentEvent, f: (r: Round) => Round['timer']): TournamentEvent {
  const cur = currentRound(ev);
  if (!cur) return ev;
  return touch({ ...ev, rounds: ev.rounds.map((r) => (r === cur ? { ...r, timer: f(r) } : r)) });
}

export const startTimer = (ev: TournamentEvent, now = Date.now()) =>
  mapTimer(ev, (r) => (r.timer.runningSince ? r.timer : { ...r.timer, runningSince: now }));

export const pauseTimer = (ev: TournamentEvent, now = Date.now()) =>
  mapTimer(ev, (r) => (r.timer.runningSince
    ? { ...r.timer, elapsedMs: r.timer.elapsedMs + (now - r.timer.runningSince), runningSince: undefined }
    : r.timer));

export const addTime = (ev: TournamentEvent, ms: number) =>
  mapTimer(ev, (r) => ({ ...r.timer, durationMs: Math.max(0, r.timer.durationMs + ms) }));

export const resetTimer = (ev: TournamentEvent) =>
  mapTimer(ev, () => ({ durationMs: ev.settings.roundMinutes * 60_000, elapsedMs: 0 }));
