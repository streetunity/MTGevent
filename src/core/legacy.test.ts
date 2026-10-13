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
