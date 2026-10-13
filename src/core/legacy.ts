// Parse pasted "legacy" stats from before the app.
//
// Best case: a header row names the columns, e.g. a table copied from a
// spreadsheet or MTGevent.com:
//   Rank  Player  Events  W–L  Points  1st Places
// Columns are matched by name (in any order); Rank and unknown columns are
// ignored. Without a header, each line is read as: name, points, events.

export interface LegacyRow {
  name: string;
  points: number;
  events: number;
  wins?: number;
  losses?: number;
  firsts?: number;
}

export interface LegacyParseResult {
  rows: LegacyRow[];
  /** lines that had text but couldn't be read */
  errors: Array<{ line: number; text: string }>;
  /** which columns were recognised from a header row (empty if none) */
  columns: string[];
}

export type LegacyOrder = 'points-events' | 'events-points';

type Col = 'name' | 'points' | 'events' | 'record' | 'wins' | 'losses' | 'firsts' | 'skip';

const NUM = /^-?\d+(?:\.\d+)?$/;
const RECORD = /^(\d+)\s*[-–—:/]\s*(\d+)(?:\s*[-–—:/]\s*\d+)?$/;

function headerCol(h: string): Col | null {
  const s = h.trim().toLowerCase().replace(/[^a-z0-9 –-]/g, '');
  if (!s) return null;
  if (/^(rank|#|pos|position|place)$/.test(s)) return 'skip';
  if (/^(player|players|name|player name)$/.test(s)) return 'name';
  if (/^(points|pts|total points|score)$/.test(s)) return 'points';
  if (/^(events|event|ev|played|events played|attendance)$/.test(s)) return 'events';
  if (/^(w\s*[-–]\s*l|w\s*[-–]\s*l\s*[-–]\s*d|record|w l)$/.test(s)) return 'record';
  if (/^(wins|w)$/.test(s)) return 'wins';
  if (/^(losses|l)$/.test(s)) return 'losses';
  if (/^(1st|1st places?|firsts|first places?|1sts|titles)$/.test(s)) return 'firsts';
  return null;
}

/** Split a line into cells: tabs, then commas/semicolons, then runs of 2+ spaces. */
function cells(line: string): string[] {
  if (line.includes('\t')) return line.split('\t').map((c) => c.trim());
  if (/[,;]/.test(line)) return line.split(/[,;]/).map((c) => c.trim());
  if (/\s{2,}/.test(line)) return line.split(/\s{2,}/).map((c) => c.trim());
  return [line.trim()];
}

const num = (s: string | undefined) => {
  if (s === undefined) return undefined;
  const t = s.replace(/,/g, '').trim();
  return NUM.test(t) ? Number(t) : undefined;
};

export function parseLegacy(text: string, order: LegacyOrder = 'points-events'): LegacyParseResult {
  const lines = text.split(/\r?\n/).map((l, i) => ({ text: l.replace(/\s+$/, ''), n: i + 1 })).filter((l) => l.text.trim());
  const rows: LegacyRow[] = [];
  const errors: LegacyParseResult['errors'] = [];
  const seen = new Map<string, number>();
  const push = (row: LegacyRow) => {
    const key = row.name.toLowerCase();
    if (seen.has(key)) rows[seen.get(key)!] = row; // last one wins
    else { seen.set(key, rows.length); rows.push(row); }
  };
  if (lines.length === 0) return { rows, errors, columns: [] };

  // ── header mode ──
  const headerCells = cells(lines[0].text);
  const map = headerCells.map(headerCol);
  const hasHeader = map.includes('name') && (map.includes('points') || map.includes('events'));
  if (hasHeader) {
    const columns = map.filter((c): c is Col => !!c && c !== 'skip');
    for (const l of lines.slice(1)) {
      const c = cells(l.text);
      const get = (col: Col) => { const i = map.indexOf(col); return i >= 0 ? c[i] : undefined; };
      const name = (get('name') ?? '').replace(/\s+/g, ' ').trim();
      const points = num(get('points'));
      const events = num(get('events'));
      if (!name || (points === undefined && events === undefined)) { errors.push({ line: l.n, text: l.text.trim() }); continue; }
      const row: LegacyRow = { name, points: points ?? 0, events: events ?? 0 };
      const rec = get('record')?.match(RECORD);
      if (rec) { row.wins = Number(rec[1]); row.losses = Number(rec[2]); }
      const w = num(get('wins')), lo = num(get('losses')), f = num(get('firsts'));
      if (w !== undefined) row.wins = w;
      if (lo !== undefined) row.losses = lo;
      if (f !== undefined) row.firsts = f;
      push(row);
    }
    return { rows, errors, columns };
  }

  // ── simple mode: name, then two numbers ──
  lines.forEach((l, idx) => {
    const line = l.text.trim();
    let parts = line.split(/\t|,|;/).map((p) => p.trim()).filter(Boolean);
    if (parts.length < 3) parts = line.split(/\s+/);
    const nums: number[] = [];
    while (parts.length && NUM.test(parts[parts.length - 1].replace(/,/g, ''))) {
      nums.unshift(Number(parts.pop()!.replace(/,/g, '')));
    }
    const name = parts.join(' ').replace(/\s+/g, ' ').trim();
    if (nums.length < 2 || !name) {
      if (idx === 0 && !/\d/.test(line)) return; // an unrecognised header row
      errors.push({ line: l.n, text: line });
      return;
    }
    const [a, b] = nums.slice(-2);
    push(order === 'points-events' ? { name, points: a, events: b } : { name, points: b, events: a });
  });
  return { rows, errors, columns: [] };
}
