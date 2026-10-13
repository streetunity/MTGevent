import { matchPoints } from './scoring';
import { Id, TournamentEvent } from './types';

export interface PlayerRecord {
  playerId: Id;
  points: number;
  wins: number;
  losses: number;
  draws: number;
  byes: number;
  matchesPlayed: number; // includes byes
  gamesWon: number;
  gamesLost: number;
  opponents: Id[]; // real opponents only (no byes)
  /** match-win %, MTR style, floored at 1/3 */
  mwp: number;
  /** game-win %, floored at 1/3 */
  gwp: number;
  omw: number;
  ogw: number;
  dropped: boolean;
}

export interface StandingRow extends PlayerRecord {
  /** 1-based place; tied players share a place */
  place: number;
  tied: boolean;
  inPrizes: boolean;
}

export interface StandingsResult {
  rows: StandingRow[];
  /**
   * Set when a group of tied players straddles the prize cutoff,
   * e.g. 3 players tied for 4th with only 1 prize left.
   */
  cutoffTie?: { playerIds: Id[]; spotsLeft: number; place: number };
}

const FLOOR = 1 / 3;

/** Build each player's record from every reported match (and byes). */
export function computeRecords(ev: TournamentEvent): Map<Id, PlayerRecord> {
  const recs = new Map<Id, PlayerRecord>();
  for (const ep of ev.players) {
    recs.set(ep.playerId, {
      playerId: ep.playerId, points: 0, wins: 0, losses: 0, draws: 0, byes: 0,
      matchesPlayed: 0, gamesWon: 0, gamesLost: 0, opponents: [],
      mwp: 0, gwp: 0, omw: 0, ogw: 0,
      dropped: ep.droppedAfterRound !== undefined,
    });
  }
  // official-style match points, used only for the percentage tiebreakers
  const mp = new Map<Id, number>();
  const gp = new Map<Id, { won: number; played: number }>();
  const add = (id: Id, m: number, gw: number, gl: number) => {
    mp.set(id, (mp.get(id) ?? 0) + m);
    const g = gp.get(id) ?? { won: 0, played: 0 };
    g.won += gw; g.played += gw + gl;
    gp.set(id, g);
  };

  for (const r of ev.rounds) {
    for (const m of r.matches) {
      const a = recs.get(m.p1);
      if (!a) continue;
      if (m.p2 === null) {
        if (r.status === 'pairing') continue;
        a.points += 3; a.byes++; a.wins++; a.matchesPlayed++;
        add(m.p1, 3, 2, 0); // MTR: a bye counts as a 2-0 win for the player's own %
        continue;
      }
      if (!m.reported) continue;
      const b = recs.get(m.p2);
      if (!b) continue;
      const pts = matchPoints(m, ev.settings);
      a.points += pts.p1; b.points += pts.p2;
      a.matchesPlayed++; b.matchesPlayed++;
      a.gamesWon += m.p1Games; a.gamesLost += m.p2Games;
      b.gamesWon += m.p2Games; b.gamesLost += m.p1Games;
      a.opponents.push(b.playerId); b.opponents.push(a.playerId);
      if (m.p1Games > m.p2Games) { a.wins++; b.losses++; add(a.playerId, 3, m.p1Games, m.p2Games); add(b.playerId, 0, m.p2Games, m.p1Games); }
      else if (m.p2Games > m.p1Games) { b.wins++; a.losses++; add(a.playerId, 0, m.p1Games, m.p2Games); add(b.playerId, 3, m.p2Games, m.p1Games); }
      else { a.draws++; b.draws++; add(a.playerId, 1, m.p1Games, m.p2Games); add(b.playerId, 1, m.p2Games, m.p1Games); }
    }
  }

  for (const rec of recs.values()) {
    const m = mp.get(rec.playerId) ?? 0;
    rec.mwp = rec.matchesPlayed ? Math.max(FLOOR, m / (3 * rec.matchesPlayed)) : 0;
    const g = gp.get(rec.playerId);
    rec.gwp = g && g.played ? Math.max(FLOOR, g.won / g.played) : 0;
  }
  for (const rec of recs.values()) {
    const opps = rec.opponents.map((o) => recs.get(o)!).filter(Boolean);
    rec.omw = opps.length ? opps.reduce((s, o) => s + o.mwp, 0) / opps.length : 0;
    rec.ogw = opps.length ? opps.reduce((s, o) => s + o.gwp, 0) / opps.length : 0;
  }
  return recs;
}

/** Head-to-head points player a earned against b across the event. */
function h2hPoints(ev: TournamentEvent, a: Id, b: Id): number {
  let pts = 0;
  for (const r of ev.rounds) for (const m of r.matches) {
    if (!m.reported || m.p2 === null) continue;
    const p = matchPoints(m, ev.settings);
    if (m.p1 === a && m.p2 === b) pts += p.p1;
    else if (m.p2 === a && m.p1 === b) pts += p.p2;
  }
  return pts;
}

const EPS = 1e-9;
const cmpNum = (x: number, y: number) => (Math.abs(x - y) < EPS ? 0 : y - x);

export function computeStandings(ev: TournamentEvent, nameOf: (id: Id) => string = (id) => id): StandingsResult {
  const recs = [...computeRecords(ev).values()];
  const mode = ev.settings.tiebreak;

  const official = (a: PlayerRecord, b: PlayerRecord) =>
    cmpNum(a.omw, b.omw) || cmpNum(a.gwp, b.gwp) || cmpNum(a.ogw, b.ogw);

  // "Tie key" decides whether two players share a place.
  const tieCmp = (a: PlayerRecord, b: PlayerRecord): number => {
    const byPts = cmpNum(a.points, b.points);
    if (byPts || mode === 'shared') return byPts;
    if (mode === 'h2h') {
      const d = h2hPoints(ev, b.playerId, a.playerId) - h2hPoints(ev, a.playerId, b.playerId);
      if (d) return d;
    }
    return official(a, b);
  };

  // Head-to-head is only meaningful between two players; for bigger groups
  // a plain sort with pairwise h2h could be inconsistent, so we resolve
  // groups: sort by points, then within each equal-points group apply h2h
  // only when the group has exactly 2 players.
  const sorted = [...recs].sort((a, b) => cmpNum(a.points, b.points) || official(a, b) || nameOf(a.playerId).localeCompare(nameOf(b.playerId)));
  if (mode === 'h2h') {
    let i = 0;
    while (i < sorted.length) {
      let j = i;
      while (j + 1 < sorted.length && cmpNum(sorted[j + 1].points, sorted[i].points) === 0) j++;
      if (j === i + 1) {
        const d = h2hPoints(ev, sorted[j].playerId, sorted[i].playerId) - h2hPoints(ev, sorted[i].playerId, sorted[j].playerId);
        if (d > 0) [sorted[i], sorted[j]] = [sorted[j], sorted[i]];
      }
      i = j + 1;
    }
  }

  const sameTie = (a: PlayerRecord, b: PlayerRecord) => {
    if (mode === 'h2h') {
      if (cmpNum(a.points, b.points)) return false;
      const d = h2hPoints(ev, a.playerId, b.playerId) - h2hPoints(ev, b.playerId, a.playerId);
      if (d) return false;
      return official(a, b) === 0;
    }
    return tieCmp(a, b) === 0;
  };

  const rows: StandingRow[] = [];
  sorted.forEach((rec, idx) => {
    const prev = rows[idx - 1];
    const place = prev && sameTie(sorted[idx - 1], rec) ? prev.place : idx + 1;
    rows.push({ ...rec, place, tied: false, inPrizes: false });
  });
  for (let i = 0; i < rows.length; i++) {
    rows[i].tied = rows.some((r, j) => j !== i && r.place === rows[i].place);
  }

  // Prizes: everyone placed inside the prize spots gets one.
  const spots = ev.settings.prizeSpots;
  let cutoffTie: StandingsResult['cutoffTie'];
  if (spots > 0 && rows.length > spots) {
    const boundary = rows[spots - 1];
    const group = rows.filter((r) => r.place === boundary.place);
    const above = rows.filter((r) => r.place < boundary.place).length;
    const spotsLeft = spots - above;
    if (group.length > spotsLeft) {
      cutoffTie = { playerIds: group.map((g) => g.playerId), spotsLeft, place: boundary.place };
    }
    for (const r of rows) r.inPrizes = r.place < boundary.place || (!cutoffTie && r.place === boundary.place);
  } else {
    for (const r of rows) r.inPrizes = spots > 0;
  }
  return { rows, cutoffTie };
}

export function formatPct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

export function placeLabel(row: StandingRow): string {
  const n = row.place;
  const suf = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
  return `${row.tied ? 'T-' : ''}${n}${suf}`;
}
