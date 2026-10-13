import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  addDays, currentSeason, daysLeft, endCurrentSeasonNow, extendSeasons, renameSeason, seasonAt,
  seasonLabel, setSeasonLength, startSeasons,
} from './seasons';

const day = (y: number, m: number, d: number, h = 0) => new Date(y, m - 1, d, h).getTime();

test('first season covers 8 weeks from the start date', () => {
  const s = startSeasons(day(2026, 10, 13, 15), 8, day(2026, 10, 13, 18));
  assert.equal(s.seasons.length, 1);
  assert.equal(s.seasons[0].start, day(2026, 10, 13));
  assert.equal(s.seasons[0].end, day(2026, 12, 8));
  assert.equal(seasonLabel(s.seasons[0]), 'Season 1');
  assert.equal(daysLeft(s.seasons[0], day(2026, 10, 13, 18)), 56);
});

test('seasons roll over automatically, back to back', () => {
  let s = startSeasons(day(2026, 1, 5), 8, day(2026, 1, 5));
  s = extendSeasons(s, day(2026, 7, 1));
  // Jan 5 + 8w = Mar 2, +8w = Apr 27, +8w = Jun 22, +8w = Aug 17
  assert.deepEqual(s.seasons.map((x) => x.number), [1, 2, 3, 4]);
  for (let i = 1; i < s.seasons.length; i++) assert.equal(s.seasons[i].start, s.seasons[i - 1].end);
  assert.equal(currentSeason(s, day(2026, 7, 1))?.number, 4);
  assert.equal(seasonAt(s, day(2026, 3, 1, 23))?.number, 1);
  assert.equal(seasonAt(s, day(2026, 3, 2))?.number, 2);
  assert.equal(seasonAt(s, day(2025, 12, 31)), undefined);
});

test('changing length affects future seasons, optionally the current one', () => {
  const now = day(2026, 2, 1);
  const s = startSeasons(day(2026, 1, 5), 8, now);
  const futureOnly = extendSeasons(setSeasonLength(s, 12, false, now), day(2026, 3, 5));
  assert.equal(futureOnly.seasons[0].end, day(2026, 3, 2)); // season 1 unchanged
  assert.equal(futureOnly.seasons[1].end, addDays(day(2026, 3, 2), 84)); // season 2 is 12 weeks
  const withCurrent = setSeasonLength(s, 12, true, now);
  assert.equal(withCurrent.seasons[0].end, addDays(day(2026, 1, 5), 84));
});

test('end current season now starts the next one today', () => {
  const now = day(2026, 2, 1, 20);
  const s = endCurrentSeasonNow(startSeasons(day(2026, 1, 5), 8, now), now);
  assert.equal(s.seasons[0].end, day(2026, 2, 1));
  assert.equal(currentSeason(s, now)?.number, 2);
  assert.equal(s.seasons[1].start, day(2026, 2, 1));
});

test('rename', () => {
  const s = renameSeason(startSeasons(day(2026, 1, 5), 8, day(2026, 1, 5)), 1, '  Winter League ');
  assert.equal(seasonLabel(s.seasons[0]), 'Winter League');
  assert.equal(seasonLabel(renameSeason(s, 1, '').seasons[0]), 'Season 1');
});

test('disabled seasons never report a current season', () => {
  const s = { ...startSeasons(day(2026, 1, 5), 8, day(2026, 1, 5)), enabled: false };
  assert.equal(currentSeason(s, day(2026, 1, 10)), undefined);
});
