import { EventSettings, Match } from './types';

export interface MatchPoints {
  p1: number;
  p2: number;
}

/** Games a player needs to win the match outright. */
export function gamesToWin(bestOf: 1 | 3): number {
  return bestOf === 3 ? 2 : 1;
}

/**
 * Points each player earns for one match.
 *
 * House (game-weighted), the bar's rules:
 *   - 1 point per game won
 *   - a clean sweep (2-0 in Bo3, 1-0 in Bo1) is worth 3
 *   - a game still in progress when time is called is worth nothing
 *   - a bye is worth 3
 *   e.g. 2-0 → 3/0, 2-1 → 2/1, 1-1 at time → 1/1, 1-0 at time → 1/0
 *
 * Official (MTR): win 3, draw 1, loss 0, bye 3.
 */
export function matchPoints(m: Match, s: Pick<EventSettings, 'scoring' | 'bestOf'>): MatchPoints {
  if (m.p2 === null) return { p1: 3, p2: 0 };
  if (!m.reported) return { p1: 0, p2: 0 };

  if (s.scoring === 'official') {
    if (m.p1Games > m.p2Games) return { p1: 3, p2: 0 };
    if (m.p2Games > m.p1Games) return { p1: 0, p2: 3 };
    return { p1: 1, p2: 1 };
  }

  const need = gamesToWin(s.bestOf);
  const pts = (mine: number, theirs: number) => (mine >= need && theirs === 0 ? 3 : mine);
  return { p1: pts(m.p1Games, m.p2Games), p2: pts(m.p2Games, m.p1Games) };
}

/** Result options shown on the report screen, from p1's point of view. */
export function resultOptions(bestOf: 1 | 3): Array<[number, number]> {
  if (bestOf === 1) return [[1, 0], [0, 1], [0, 0]];
  return [[2, 0], [2, 1], [1, 2], [0, 2], [1, 0], [0, 1], [1, 1], [0, 0]];
}

/** Is this game score a finished match (someone reached the games needed)? */
export function isCompleteResult(p1: number, p2: number, bestOf: 1 | 3): boolean {
  const need = gamesToWin(bestOf);
  return p1 >= need || p2 >= need;
}
