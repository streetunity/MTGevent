import { newId } from './id';
import { computeRecords } from './standings';
import { Id, Match, TournamentEvent } from './types';

/** Recommended Swiss rounds for a player count (standard tournament table). */
export function recommendedRounds(n: number): number {
  if (n <= 2) return 1;
  if (n <= 4) return 2;
  if (n <= 8) return 3;
  if (n <= 16) return 4;
  if (n <= 32) return 5;
  if (n <= 64) return 6;
  if (n <= 128) return 7;
  return 8;
}

/** Players eligible to be paired in the given round. */
export function activePlayerIds(ev: TournamentEvent, roundNumber: number): Id[] {
  return ev.players
    .filter((p) => p.joinedRound <= roundNumber && (p.droppedAfterRound === undefined || p.droppedAfterRound >= roundNumber))
    .map((p) => p.playerId);
}

/** Set of "a|b" keys for every pair that has already played this event. */
export function playedPairs(ev: TournamentEvent, beforeRound?: number): Set<string> {
  const s = new Set<string>();
  for (const r of ev.rounds) {
    if (beforeRound !== undefined && r.number >= beforeRound) continue;
    for (const m of r.matches) if (m.p2) s.add(pairKey(m.p1, m.p2));
  }
  return s;
}

export const pairKey = (a: Id, b: Id) => (a < b ? `${a}|${b}` : `${b}|${a}`);

function shuffle<T>(arr: T[], rand: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export interface PairingOptions {
  rand?: () => number;
  /**
   * Optional extra penalty for pairing two players, e.g. how often they've
   * met in recent events. Higher = avoid more. Used to break up repeat matchups
   * across weeks.
   */
  historyPenalty?: (a: Id, b: Id) => number;
}

/**
 * Swiss pairing:
 *  1. order players by points (random order within the same points)
 *  2. if odd, the lowest-ranked player who hasn't had a bye gets it
 *  3. pair top-down, never repeating a matchup this event if at all possible,
 *     preferring opponents with the closest points
 * Falls back to allowing the fewest rematches if no rematch-free pairing exists.
 */
export function pairRound(ev: TournamentEvent, roundNumber: number, opts: PairingOptions = {}): Match[] {
  const rand = opts.rand ?? Math.random;
  const ids = activePlayerIds(ev, roundNumber);
  const recs = computeRecords(ev);
  const pts = (id: Id) => recs.get(id)?.points ?? 0;
  const played = playedPairs(ev, roundNumber);
  const hadBye = new Set<Id>();
  for (const r of ev.rounds) if (r.number < roundNumber) for (const m of r.matches) if (!m.p2) hadBye.add(m.p1);

  // group by points, shuffle within groups, highest first
  const ordered = shuffle(ids, rand).sort((a, b) => pts(b) - pts(a));

  const tryPair = (pool: Id[], maxRematches: number) =>
    pairPool(pool, played, pts, maxRematches, opts.historyPenalty);

  const build = (pairs: Array<[Id, Id]>, bye: Id | null): Match[] => {
    const matches: Match[] = pairs.map(([a, b], i) => ({
      id: newId(), table: i + 1, p1: a, p2: b, p1Games: 0, p2Games: 0, reported: false,
    }));
    if (bye) matches.push({ id: newId(), table: matches.length + 1, p1: bye, p2: null, p1Games: 2, p2Games: 0, reported: true });
    return matches;
  };

  for (let maxRematches = 0; maxRematches <= ordered.length; maxRematches++) {
    if (ordered.length % 2 === 0) {
      const p = tryPair(ordered, maxRematches);
      if (p) return build(p, null);
    } else {
      // bye candidates from the bottom up; prefer those without a bye yet
      const bottomUp = [...ordered].reverse();
      const candidates = [...bottomUp.filter((id) => !hadBye.has(id)), ...bottomUp.filter((id) => hadBye.has(id))];
      for (const bye of candidates) {
        const p = tryPair(ordered.filter((id) => id !== bye), maxRematches);
        if (p) return build(p, bye);
      }
    }
  }
  return build([], null);
}

/**
 * Backtracking pairer. Takes the highest-ranked unpaired player and tries
 * opponents ordered by closeness in points (and least history penalty).
 */
function pairPool(
  pool: Id[],
  played: Set<string>,
  pts: (id: Id) => number,
  maxRematches: number,
  historyPenalty?: (a: Id, b: Id) => number,
): Array<[Id, Id]> | null {
  let steps = 0;
  const LIMIT = 200_000;
  const out: Array<[Id, Id]> = [];

  const solve = (remaining: Id[], rematches: number): boolean => {
    if (remaining.length === 0) return true;
    if (++steps > LIMIT) return false;
    const [a, ...rest] = remaining;
    const candidates = rest
      .map((b, idx) => ({ b, idx }))
      .sort((x, y) => {
        const dx = Math.abs(pts(a) - pts(x.b));
        const dy = Math.abs(pts(a) - pts(y.b));
        if (dx !== dy) return dx - dy;
        const hx = historyPenalty?.(a, x.b) ?? 0;
        const hy = historyPenalty?.(a, y.b) ?? 0;
        if (hx !== hy) return hx - hy;
        return x.idx - y.idx;
      });
    for (const { b } of candidates) {
      const isRematch = played.has(pairKey(a, b));
      if (isRematch && rematches >= maxRematches) continue;
      out.push([a, b]);
      if (solve(rest.filter((x) => x !== b), rematches + (isRematch ? 1 : 0))) return true;
      out.pop();
    }
    return false;
  };
  return solve(pool, 0) ? out : null;
}

/** Swap two players' seats within a round's matches (manual pairing fix). */
export function swapPlayers(matches: Match[], a: Id, b: Id): Match[] {
  if (a === b) return matches;
  const sub = (id: Id | null) => (id === a ? b : id === b ? a : id);
  return matches.map((m) => {
    const p1 = sub(m.p1)!;
    const p2 = sub(m.p2);
    if (p1 === m.p1 && p2 === m.p2) return m;
    const bye = p2 === null;
    return { ...m, p1, p2, p1Games: bye ? 2 : 0, p2Games: 0, reported: bye };
  });
}

/** Matches in a round that repeat a pairing from an earlier round. */
export function rematchIds(ev: TournamentEvent, roundNumber: number, matches: Match[]): Set<Id> {
  const played = playedPairs(ev, roundNumber);
  return new Set(matches.filter((m) => m.p2 && played.has(pairKey(m.p1, m.p2))).map((m) => m.id));
}
