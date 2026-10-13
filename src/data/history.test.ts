import assert from 'node:assert/strict';
import { test } from 'node:test';
import { legacyInRange, rivals, withLegacy } from './history';

test('rivals picks most-beaten and most-lost-to opponents', () => {
  const h2h = [
    { opponentId: 'a', wins: 3, losses: 0, draws: 0, matches: 3 },
    { opponentId: 'b', wins: 3, losses: 1, draws: 0, matches: 4 },
    { opponentId: 'c', wins: 0, losses: 2, draws: 0, matches: 2 },
    { opponentId: 'd', wins: 1, losses: 2, draws: 0, matches: 3 },
    { opponentId: 'e', wins: 1, losses: 1, draws: 0, matches: 2 },
  ];
  const r = rivals(h2h);
  assert.equal(r.easiest?.opponentId, 'a'); // 3 wins, better rate than b
  assert.equal(r.toughest?.opponentId, 'c'); // 2 losses, 100% vs d's 67%
  assert.deepEqual(rivals([{ opponentId: 'e', wins: 1, losses: 1, draws: 0, matches: 2 }]), { easiest: undefined, toughest: undefined });
});

test('legacy counts in this year only when tagged with this year', () => {
  const now = new Date(2026, 9, 13);
  assert.equal(legacyInRange({ points: 1, events: 1, year: 2026 }, 'year', now), true);
  assert.equal(legacyInRange({ points: 1, events: 1, year: 2025 }, 'year', now), false);
  assert.equal(legacyInRange({ points: 1, events: 1 }, 'year', now), false);
  assert.equal(legacyInRange({ points: 1, events: 1 }, 'all', now), true);
  assert.equal(legacyInRange({ points: 1, events: 1, year: 2026 }, 'month', now), false);
});

test('withLegacy adds totals', () => {
  const t = withLegacy(undefined, 'x', { points: 63, events: 10, wins: 21, losses: 7, firsts: 4, year: 2026 });
  assert.equal(t.points, 63); assert.equal(t.matches, 28); assert.equal(t.firsts, 4);
});
