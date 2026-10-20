// Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  addPlayer, beginRound, completeRound, createEvent, currentRound, dropPlayer,
  reportResult, startEvent, swapInCurrent, addTime, pauseTimer, startTimer, timerRemainingMs,
} from './eventOps';
import { pairKey, recommendedRounds } from './pairing';
import { matchPoints } from './scoring';
import { computeStandings, placeLabel } from './standings';
import { Match, TournamentEvent } from './types';

const m = (p1Games: number, p2Games: number): Match =>
  ({ id: 'x', table: 1, p1: 'a', p2: 'b', p1Games, p2Games, reported: true });
const house = { scoring: 'house' as const, bestOf: 3 as const };

test('house scoring matches the bar rules', () => {
  assert.deepEqual(matchPoints(m(2, 0), house), { p1: 3, p2: 0 });
  assert.deepEqual(matchPoints(m(2, 1), house), { p1: 2, p2: 1 });
  assert.deepEqual(matchPoints(m(1, 2), house), { p1: 1, p2: 2 });
  assert.deepEqual(matchPoints(m(1, 1), house), { p1: 1, p2: 1 });
  assert.deepEqual(matchPoints(m(1, 0), house), { p1: 1, p2: 0 });
  assert.deepEqual(matchPoints(m(0, 0), house), { p1: 0, p2: 0 });
  assert.deepEqual(matchPoints({ ...m(2, 0), p2: null }, house), { p1: 3, p2: 0 });
});

test('official scoring', () => {
  const off = { scoring: 'official' as const, bestOf: 3 as const };
  assert.deepEqual(matchPoints(m(2, 1), off), { p1: 3, p2: 0 });
  assert.deepEqual(matchPoints(m(1, 1), off), { p1: 1, p2: 1 });
});

test('recommended rounds', () => {
  assert.equal(recommendedRounds(3), 2);
  assert.equal(recommendedRounds(8), 3);
  assert.equal(recommendedRounds(9), 4);
});

function seeded(seed: number) {
  return () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
}

function makeEvent(n: number): TournamentEvent {
  let ev = createEvent('Test');
  for (let i = 0; i < n; i++) ev = addPlayer(ev, `p${i}`);
  return ev;
}

/** Play a full event, randomly reporting results, and check invariants. */
function playThrough(n: number, seed: number) {
  const rand = seeded(seed);
  let ev = makeEvent(n);
  ev = startEvent(ev, { rand });
  const seen = new Set<string>();
  const byes = new Map<string, number>();
  while (ev.status === 'running') {
    const r = currentRound(ev)!;
    const ids = r.matches.flatMap((x) => (x.p2 ? [x.p1, x.p2] : [x.p1]));
    assert.equal(new Set(ids).size, ids.length, 'nobody paired twice in a round');
    assert.equal(ids.length, n, 'everyone paired');
    for (const x of r.matches) {
      if (x.p2) {
        const k = pairKey(x.p1, x.p2);
        assert.ok(!seen.has(k), `no rematch ${k} (n=${n} seed=${seed} round=${r.number})`);
        seen.add(k);
      } else byes.set(x.p1, (byes.get(x.p1) ?? 0) + 1);
    }
    ev = beginRound(ev);
    for (const x of currentRound(ev)!.matches) {
      if (!x.p2) continue;
      const opts: Array<[number, number]> = [[2, 0], [2, 1], [1, 2], [0, 2], [1, 0], [1, 1]];
      const [a, b] = opts[Math.floor(rand() * opts.length)];
      ev = reportResult(ev, x.id, a, b);
    }
    ev = completeRound(ev, { rand });
  }
  for (const c of byes.values()) assert.equal(c, 1, 'no player gets two byes');
  return ev;
}

test('swiss: no rematches, no double byes, everyone paired', () => {
  for (const n of [4, 5, 6, 7, 8, 9, 12, 13, 16, 23]) {
    for (let seed = 1; seed <= 25; seed++) playThrough(n, seed);
  }
});

test('incomplete round blocks advancing', () => {
  let ev = startEvent(makeEvent(4), { rand: seeded(3) });
  ev = beginRound(ev);
  const before = ev.rounds.length;
  ev = completeRound(ev);
  assert.equal(ev.rounds.length, before);
  assert.equal(currentRound(ev)!.status, 'active');
});

test('dropped players are not paired again but keep standings', () => {
  let ev = startEvent(makeEvent(6), { rand: seeded(7) });
  ev = beginRound(ev);
  for (const x of currentRound(ev)!.matches) ev = reportResult(ev, x.id, 2, 0);
  ev = dropPlayer(ev, 'p0');
  ev = completeRound(ev, { rand: seeded(8) });
  const r2 = currentRound(ev)!;
  assert.ok(!r2.matches.some((x) => x.p1 === 'p0' || x.p2 === 'p0'));
  assert.equal(r2.matches.filter((x) => !x.p2).length, 1, '5 players -> one bye');
  const st = computeStandings(ev);
  assert.ok(st.rows.some((r) => r.playerId === 'p0'));
});

test('swap players in pairing step', () => {
  let ev = startEvent(makeEvent(4), { rand: seeded(2) });
  const [m1, m2] = currentRound(ev)!.matches;
  ev = swapInCurrent(ev, m1.p1, m2.p1);
  const [n1, n2] = currentRound(ev)!.matches;
  assert.equal(n1.p1, m2.p1);
  assert.equal(n2.p1, m1.p1);
});

test('shared placement + prize cutoff flag', () => {
  // 6 players, after round 1 three winners 2-0 (3 pts), three losers (0)
  let ev = startEvent(makeEvent(6), { rand: seeded(5) });
  ev = { ...ev, settings: { ...ev.settings, prizeSpots: 2 } };
  ev = beginRound(ev);
  for (const x of currentRound(ev)!.matches) ev = reportResult(ev, x.id, 2, 0);
  const st = computeStandings(ev);
  assert.equal(st.rows.filter((r) => r.place === 1).length, 3);
  assert.equal(placeLabel(st.rows[0]), 'T-1st');
  assert.ok(st.cutoffTie, 'three tied for 2 prizes is flagged');
  assert.equal(st.cutoffTie!.spotsLeft, 2);

  const st4 = computeStandings({ ...ev, settings: { ...ev.settings, prizeSpots: 4 } });
  // 3 at 1st, 3 tied at 4th for 1 spot
  assert.ok(st4.cutoffTie);
  assert.equal(st4.rows.filter((r) => r.inPrizes).length, 3);
});

test('timer pause / add time', () => {
  let ev = startEvent(makeEvent(4), { rand: seeded(1) });
  ev = beginRound(ev);
  const t0 = 1_000_000;
  ev = startTimer(ev, t0);
  ev = pauseTimer(ev, t0 + 60_000);
  const r = currentRound(ev)!;
  assert.equal(timerRemainingMs(r, t0 + 999_999), 49 * 60_000);
  ev = addTime(ev, 5 * 60_000);
  assert.equal(timerRemainingMs(currentRound(ev)!, t0), 54 * 60_000);
});

test('events default to a fixed 3 rounds, whatever the turnout', () => {
  const ev = makeEvent(12);
  assert.equal(ev.settings.autoRounds, false);
  assert.equal(ev.settings.rounds, 3);
  // finishing round 3 ends the event instead of pairing a 4th
  let run = startEvent(ev);
  for (let r = 1; r <= 3; r++) {
    run = beginRound(run);
    for (const x of currentRound(run)!.matches) if (x.p2) run = reportResult(run, x.id, 2, 0);
    run = completeRound(run);
  }
  assert.equal(run.status, 'complete');
  assert.equal(run.rounds.length, 3);
});

test('"use recommended" still follows the player count', () => {
  let ev = createEvent('Auto', { autoRounds: true });
  for (let i = 0; i < 12; i++) ev = addPlayer(ev, `p${i}`);
  assert.equal(ev.settings.rounds, 4);
});
