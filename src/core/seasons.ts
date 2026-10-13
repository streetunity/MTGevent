// Seasons: fixed-length blocks of weeks (e.g. 8 or 12). The organizer starts
// Season 1 on a date; each following season starts the moment the previous one
// ends, generated automatically. Seasons are stored once created, so changing
// the length later never rewrites past seasons.

export interface Season {
  number: number;
  /** custom name; falls back to "Season N" */
  name?: string;
  /** local midnight the season starts (epoch ms, inclusive) */
  start: number;
  /** local midnight the next season starts (epoch ms, exclusive) */
  end: number;
}

export interface SeasonSettings {
  enabled: boolean;
  /** length of new seasons, in weeks */
  weeks: number;
  seasons: Season[];
}

export const DEFAULT_SEASONS: SeasonSettings = { enabled: false, weeks: 8, seasons: [] };

/** Local midnight for the day containing `ts`. */
export function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Add whole days in local time (safe across daylight-saving changes). */
export function addDays(ts: number, days: number): number {
  const d = new Date(ts);
  d.setDate(d.getDate() + days);
  return d.getTime();
}

export const seasonLabel = (s: Season) => s.name?.trim() || `Season ${s.number}`;

/** Begin seasons: Season 1 starts on `startDate` (snapped to midnight). */
export function startSeasons(startDate: number, weeks: number, now = Date.now()): SeasonSettings {
  const start = startOfDay(startDate);
  const first: Season = { number: 1, start, end: addDays(start, weeks * 7) };
  return extendSeasons({ enabled: true, weeks, seasons: [first] }, now);
}

/** Append seasons until one covers `now`. Returns the same object if nothing changed. */
export function extendSeasons(s: SeasonSettings, now = Date.now()): SeasonSettings {
  if (!s.enabled || s.seasons.length === 0) return s;
  let seasons = s.seasons;
  let last = seasons[seasons.length - 1];
  if (last.end > now) return s;
  seasons = [...seasons];
  let guard = 0;
  while (last.end <= now && guard++ < 1000) {
    const next: Season = { number: last.number + 1, start: last.end, end: addDays(last.end, s.weeks * 7) };
    seasons.push(next);
    last = next;
  }
  return { ...s, seasons };
}

export function seasonAt(s: SeasonSettings, ts: number): Season | undefined {
  return s.seasons.find((x) => ts >= x.start && ts < x.end);
}

export function currentSeason(s: SeasonSettings, now = Date.now()): Season | undefined {
  if (!s.enabled) return undefined;
  return seasonAt(s, now);
}

/** Change the length of future seasons; optionally also stretch/shrink the current one. */
export function setSeasonLength(s: SeasonSettings, weeks: number, applyToCurrent: boolean, now = Date.now()): SeasonSettings {
  let seasons = s.seasons;
  if (applyToCurrent) {
    const cur = seasonAt(s, now);
    if (cur) {
      // keep only seasons up to the current one; later ones are regenerated
      seasons = seasons.filter((x) => x.number <= cur.number)
        .map((x) => (x.number === cur.number ? { ...x, end: addDays(x.start, weeks * 7) } : x));
    }
  }
  return extendSeasons({ ...s, weeks, seasons }, now);
}

/** End the current season today and start the next one now. */
export function endCurrentSeasonNow(s: SeasonSettings, now = Date.now()): SeasonSettings {
  const cur = seasonAt(s, now);
  if (!cur) return s;
  const today = startOfDay(now);
  // a season needs at least one day; if it started today, end it tomorrow instead
  const end = today > cur.start ? today : addDays(cur.start, 1);
  const seasons = s.seasons.filter((x) => x.number <= cur.number)
    .map((x) => (x.number === cur.number ? { ...x, end } : x));
  const next: Season = { number: cur.number + 1, start: end, end: addDays(end, s.weeks * 7) };
  return extendSeasons({ ...s, seasons: [...seasons, next] }, now);
}

export function renameSeason(s: SeasonSettings, number: number, name: string): SeasonSettings {
  return { ...s, seasons: s.seasons.map((x) => (x.number === number ? { ...x, name: name.trim() || undefined } : x)) };
}

export function daysLeft(season: Season, now = Date.now()): number {
  return Math.max(0, Math.round((season.end - startOfDay(now)) / 86_400_000));
}

/** "Oct 13 – Dec 7" (end shown as the season's last day). */
export function seasonRange(season: Season): string {
  const f = (ts: number) => new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${f(season.start)} – ${f(addDays(season.end, -1))}`;
}
