import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseLegacy } from './legacy';

test('parses spreadsheet paste with header', () => {
  const r = parseLegacy('Player\tPoints\tEvents\nMike S\t142\t18\nJo Ann Smith\t97\t12\n');
  assert.deepEqual(r.rows, [
    { name: 'Mike S', points: 142, events: 18 },
    { name: 'Jo Ann Smith', points: 97, events: 12 },
  ]);
  assert.equal(r.errors.length, 0);
});

test('parses CSV and plain spaces, reports bad lines', () => {
  const r = parseLegacy('Mike S, 142, 18\nDave 30 4\njust a name\n\n');
  assert.equal(r.rows.length, 2);
  assert.deepEqual(r.rows[1], { name: 'Dave', points: 30, events: 4 });
  assert.deepEqual(r.errors, [{ line: 3, text: 'just a name' }]);
});

test('column order swap and duplicate names', () => {
  const r = parseLegacy('Mike, 18, 142\nmike, 20, 150', 'events-points');
  assert.deepEqual(r.rows, [{ name: 'mike', points: 150, events: 20 }]);
});

test('MTGevent-style table with header, W–L and 1st places', () => {
  const table = [
    'Rank\tPlayer\tEvents\tW–L\tPoints\t1st Places',
    '1\tDanny\t10\t21–7\t63\t4',
    '2\tBrian StreetUnity\t11\t21–10\t63\t1',
    '18\tJustin\t1\t0–3\t0\t0',
  ].join('\n');
  const r = parseLegacy(table);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.rows, [
    { name: 'Danny', points: 63, events: 10, wins: 21, losses: 7, firsts: 4 },
    { name: 'Brian StreetUnity', points: 63, events: 11, wins: 21, losses: 10, firsts: 1 },
    { name: 'Justin', points: 0, events: 1, wins: 0, losses: 3, firsts: 0 },
  ]);
  assert.deepEqual(r.columns, ['name', 'events', 'record', 'points', 'firsts']);
});

test('header table pasted with spaces instead of tabs', () => {
  const r = parseLegacy('Player   Points   Events\nJo Ann   97   12\n');
  assert.deepEqual(r.rows, [{ name: 'Jo Ann', points: 97, events: 12 }]);
});
