// Cross-event history: player stats, head-to-head, leaderboards, and the
// "don't keep pairing the same people every week" penalty.
import { pairKey } from '../core/pairing';
import { matchPoints } from '../core/scoring';
import { computeStandings } from '../core/standings';
import { Id, LegacyStats, TournamentEvent } from '../core/types';

/**
 * Penalty for pairing a and b, based on how many times they met in their
 * most recent events (last 6 completed events, newer meetings weigh more).
 */
export function makeHistoryPenalty(events: TournamentEvent[], excludeEventId?: Id) {
  const recent = events
    .filter((e) => e.status === 'complete' && e.id !== excludeEventId)
    .sort((a, b) => b.date - a.date)
    .slice(0, 6);
  const weight = new Map<string, number>();
  recent.forEach((ev, i) => {
    const w = 6 - i;
    for (const r of ev.rounds) for (const m of r.matches) {
      if (!m.p2) continue;
      const k = pairKey(m.p1, m.p2);
      weight.set(k, (weight.get(k) ?? 0) + w);
    }
  });
  return (a: Id, b: Id) => weight.get(pairKey(a, b)) ?? 0;
}

export interface PlayerSummary {
  playerId: Id;
  events: number;
  matches: number;
  wins: number;
  losses: number;
  draws: number;
  gamesWon: number;
  gamesLost: number;
  points: number;
  firsts: number;
  prizeFinishes: number;
}

export const emptySummary = (playerId: Id): PlayerSummary => ({
  playerId, events: 0, matches: 0, wins: 0, losses: 0, draws: 0, gamesWon: 0, gamesLost: 0, points: 0, firsts: 0, prizeFinishes: 0,
});

/** App stats plus imported legacy totals (legacy has no game scores or prize finishes). */
export function withLegacy(s: PlayerSummary | undefined, playerId: Id, legacy?: LegacyStats): PlayerSummary {
  const base = s ?? emptySummary(playerId);
  if (!legacy) return base;
  const w = legacy.wins ?? 0, l = legacy.losses ?? 0;
  return {
    ...base,
    events: base.events + legacy.events,
    points: base.points + legacy.points,
    wins: base.wins + w,
    losses: base.losses + l,
    matches: base.matches + w + l,
    firsts: base.firsts + (legacy.firsts ?? 0),
  };
}

/** Does this legacy record belong in a leaderboard range? */
export function legacyInRange(l: LegacyStats, range: 'month' | 'year' | 'all', now = new Date()): boolean {
  if (range === 'all') return true;
  if (range === 'year') return l.year === now.getFullYear();
  return false; // legacy has no month, so it never counts in "this month"
}

export function legacySummary(l: LegacyStats): string {
  const parts = [`${l.points} pts`, `${l.events} events`];
  if (l.wins !== undefined || l.losses !== undefined) parts.push(`${l.wins ?? 0}-${l.losses ?? 0}`);
  if (l.firsts) parts.push(`${l.firsts}× 1st`);
  return parts.join(' · ') + (l.year ? ` (${l.year})` : '');
}

export interface H2H { opponentId: Id; wins: number; losses: number; draws: number; matches: number }

export function playerSummaries(events: TournamentEvent[], filter?: (e: TournamentEvent) => boolean): Map<Id, PlayerSummary> {
  const out = new Map<Id, PlayerSummary>();
  const get = (id: Id) => {
    let s = out.get(id);
    if (!s) { s = { playerId: id, events: 0, matches: 0, wins: 0, losses: 0, draws: 0, gamesWon: 0, gamesLost: 0, points: 0, firsts: 0, prizeFinishes: 0 }; out.set(id, s); }
    return s;
  };
  for (const ev of events) {
    if (ev.status === 'setup' || (filter && !filter(ev))) continue;
    for (const p of ev.players) get(p.playerId).events++;
    for (const r of ev.rounds) {
      if (r.status === 'pairing') continue;
      for (const m of r.matches) {
        if (!m.p2) { const s = get(m.p1); s.points += 3; continue; }
        if (!m.reported) continue;
        const a = get(m.p1), b = get(m.p2);
        const pts = matchPoints(m, ev.settings);
        a.points += pts.p1; b.points += pts.p2;
        a.matches++; b.matches++;
        a.gamesWon += m.p1Games; a.gamesLost += m.p2Games;
        b.gamesWon += m.p2Games; b.gamesLost += m.p1Games;
        if (m.p1Games > m.p2Games) { a.wins++; b.losses++; }
        else if (m.p2Games > m.p1Games) { b.wins++; a.losses++; }
        else { a.draws++; b.draws++; }
      }
    }
    if (ev.status === 'complete') {
      const st = computeStandings(ev);
      for (const row of st.rows) {
        if (row.place === 1) get(row.playerId).firsts++;
        if (row.inPrizes) get(row.playerId).prizeFinishes++;
      }
    }
  }
  return out;
}

export function headToHead(events: TournamentEvent[], playerId: Id): H2H[] {
  const map = new Map<Id, H2H>();
  for (const ev of events) for (const r of ev.rounds) for (const m of r.matches) {
    if (!m.p2 || !m.reported) continue;
    let me: number, them: number, opp: Id;
    if (m.p1 === playerId) { me = m.p1Games; them = m.p2Games; opp = m.p2; }
    else if (m.p2 === playerId) { me = m.p2Games; them = m.p1Games; opp = m.p1; }
    else continue;
    const h = map.get(opp) ?? { opponentId: opp, wins: 0, losses: 0, draws: 0, matches: 0 };
    h.matches++;
    if (me > them) h.wins++; else if (them > me) h.losses++; else h.draws++;
    map.set(opp, h);
  }
  return [...map.values()].sort((a, b) => b.matches - a.matches);
}

export interface Rivals {
  /** opponent this player has beaten the most */
  easiest?: H2H;
  /** opponent who has beaten this player the most */
  toughest?: H2H;
}

/**
 * "Easiest opponent" = most match wins against them (ties: better win rate,
 * then more matches). "Biggest challenge" = most losses to them (same idea).
 * Only counts matches played in the app. The same opponent can't be both.
 */
export function rivals(h2h: H2H[]): Rivals {
  const rate = (a: number, h: H2H) => a / h.matches;
  const easiest = [...h2h].filter((h) => h.wins > 0 && h.wins > h.losses)
    .sort((a, b) => b.wins - a.wins || rate(b.wins, b) - rate(a.wins, a) || b.matches - a.matches)[0];
  const toughest = [...h2h].filter((h) => h.losses > 0 && h.losses > h.wins)
    .sort((a, b) => b.losses - a.losses || rate(b.losses, b) - rate(a.losses, a) || b.matches - a.matches)[0];
  return { easiest, toughest };
}

export interface PlayerEventResult { eventId: Id; title: string; date: number; place: number; tied: boolean; points: number; record: string; players: number }

export function eventResultsFor(events: TournamentEvent[], playerId: Id): PlayerEventResult[] {
  const out: PlayerEventResult[] = [];
  for (const ev of events) {
    if (ev.status === 'setup' || !ev.players.some((p) => p.playerId === playerId)) continue;
    const row = computeStandings(ev).rows.find((r) => r.playerId === playerId);
    if (!row) continue;
    out.push({
      eventId: ev.id, title: ev.title, date: ev.date, place: row.place, tied: row.tied, points: row.points,
      record: `${row.wins}-${row.losses}${row.draws ? `-${row.draws}` : ''}`, players: ev.players.length,
    });
  }
  return out.sort((a, b) => b.date - a.date);
}
