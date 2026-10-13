// Parse pasted "legacy" stats: one player per line with a name, total points
// and number of events. Accepts spreadsheet copy/paste (tabs), CSV, or
// plain "Name 142 18". Header lines and blank lines are skipped.

export interface LegacyRow {
  name: string;
  points: number;
  events: number;
}

export interface LegacyParseResult {
  rows: LegacyRow[];
  /** lines that had text but couldn't be read */
  errors: Array<{ line: number; text: string }>;
}

export type LegacyOrder = 'points-events' | 'events-points';

const NUM = /^-?\d+(?:\.\d+)?$/;

export function parseLegacy(text: string, order: LegacyOrder = 'points-events'): LegacyParseResult {
  const rows: LegacyRow[] = [];
  const errors: LegacyParseResult['errors'] = [];
  const seen = new Map<string, number>();
  let first = true;

  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    const isFirst = first;
    first = false;
    // split on tabs / commas / semicolons; otherwise fall back to whitespace
    let parts = line.split(/\t|,|;/).map((p) => p.trim()).filter(Boolean);
    if (parts.length < 3) parts = line.split(/\s+/);

    const nums: number[] = [];
    while (parts.length && NUM.test(parts[parts.length - 1].replace(/,/g, ''))) {
      nums.unshift(Number(parts.pop()!.replace(/,/g, '')));
    }
    const name = parts.join(' ').replace(/\s+/g, ' ').trim();

    if (nums.length < 2 || !name) {
      // a header row like "Name, Points, Events" (first line, no numbers) is not an error
      if (isFirst && !/\d/.test(line)) return;
      errors.push({ line: i + 1, text: line });
      return;
    }
    const [a, b] = nums.slice(-2);
    const row = order === 'points-events' ? { name, points: a, events: b } : { name, points: b, events: a };
    const key = name.toLowerCase();
    if (seen.has(key)) rows[seen.get(key)!] = row; // last one wins
    else { seen.set(key, rows.length); rows.push(row); }
  });
  return { rows, errors };
}
