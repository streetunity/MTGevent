// Public league website: mtg-event.com/<league>
// Reads the league's public feed from the API and renders it with the same
// scoring / standings / history code the phone app uses (src/core, src/data/history).
import { currentRound, timerRemainingMs } from '../../src/core/eventOps';
import { matchPoints } from '../../src/core/scoring';
import { computeStandings, placeLabel } from '../../src/core/standings';
import { currentSeason, daysLeft, DEFAULT_SEASONS, extendSeasons, Season, seasonLabel, seasonRange, SeasonSettings } from '../../src/core/seasons';
import { Id, Player, TournamentEvent } from '../../src/core/types';
import { eventResultsFor, headToHead, legacyInRange, legacySummary, playerSummaries, rivals, withLegacy } from '../../src/data/history';

// ───────────────────────── data ─────────────────────────

interface Feed {
  league: { slug: string; name: string };
  cursor: number;
  players: Player[];
  events: TournamentEvent[];
  deletions: Array<{ kind: 'event' | 'player'; id: string }>;
  settings: Array<{ name: string; value: unknown }>;
}

const slug = decodeURIComponent(location.pathname.split('/').filter(Boolean)[0] ?? '');
const API = `/api/public/${encodeURIComponent(slug)}`;

const state = {
  name: '',
  cursor: 0,
  players: new Map<Id, Player>(),
  events: new Map<Id, TournamentEvent>(),
  seasons: DEFAULT_SEASONS as SeasonSettings,
  loaded: false,
  error: '' as string,
  lastUpdate: 0,
};

function merge(f: Feed) {
  state.name = f.league.name;
  for (const d of f.deletions) (d.kind === 'event' ? state.events : state.players).delete(d.id);
  for (const p of f.players) state.players.set(p.id, p);
  for (const e of f.events) state.events.set(e.id, e);
  for (const s of f.settings) if (s.name === 'seasons' && s.value) state.seasons = s.value as SeasonSettings;
  state.cursor = f.cursor;
}

async function load(): Promise<boolean> {
  try {
    const res = await fetch(`${API}?since=${state.cursor}`, { cache: 'no-store' });
    if (res.status === 404) { state.error = 'notfound'; return true; }
    if (!res.ok) throw new Error(String(res.status));
    const f = (await res.json()) as Feed;
    const changed = !state.loaded || f.players.length + f.events.length + f.deletions.length + f.settings.length > 0;
    merge(f);
    state.loaded = true;
    state.error = '';
    state.lastUpdate = Date.now();
    return changed;
  } catch {
    if (!state.loaded) state.error = 'offline';
    return !state.loaded;
  }
}

// ───────────────────────── helpers ─────────────────────────

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const nameOf = (id: Id) => state.players.get(id)?.name ?? 'Unknown player';
const fmtDate = (ts: number) => new Date(ts).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
const shortDate = (ts: number) => new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const ord = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`;
const allEvents = () => [...state.events.values()].filter((e) => e.status !== 'setup').sort((a, b) => b.date - a.date);
const liveEvents = () => allEvents().filter((e) => e.status === 'running');
const seasons = () => extendSeasons(state.seasons);
const playerLink = (id: Id) => `<a class="plink" href="#/players/${encodeURIComponent(id)}">${esc(nameOf(id))}</a>`;

function clock(ms: number) {
  const neg = ms < 0;
  const s = Math.floor(Math.abs(ms) / 1000);
  return `${neg ? '+' : ''}${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// UI state that survives re-renders
const ui = {
  range: '' as '' | 'season' | 'month' | 'year' | 'all',
  seasonPick: null as number | null,
  sort: 'points' as 'points' | 'wins' | 'events',
  find: '',
  playerQ: '',
};

// ───────────────────────── views ─────────────────────────

function liveView(): string {
  const live = liveEvents();
  if (!live.length) {
    return `<section class="empty"><div class="big">🃏</div><h2>No event running right now</h2>
      <p>When a night starts, pairings and the round timer show up here.</p>
      <a class="btn" href="#/standings">See the standings</a></section>`;
  }
  return live.map((ev) => {
    const r = currentRound(ev);
    const st = computeStandings(ev, nameOf);
    const q = ui.find.trim().toLowerCase();
    const matches = r ? [...r.matches].sort((a, b) => a.table - b.table) : [];
    const hit = (id: Id | null) => !!id && !!q && nameOf(id).toLowerCase().includes(q);
    const shown = q ? matches.filter((m) => hit(m.p1) || hit(m.p2)) : matches;
    const running = !!r?.timer.runningSince;
    return `
      <section class="card live">
        <div class="eyebrow"><span class="pulse"></span>LIVE · ${esc(fmtDate(ev.date))}</div>
        <h2>${esc(ev.title)}</h2>
        ${r ? `<div class="sub">Round ${r.number} of ${ev.settings.rounds}${r.status === 'pairing' ? ' · pairings being set — they may still change' : ''}</div>` : ''}
        ${r && r.status === 'active' ? `
          <div class="timer ${running ? '' : 'paused'}" data-timer="${esc(ev.id)}">${clock(timerRemainingMs(r))}</div>
          <div class="timer-note" data-timer-note="${esc(ev.id)}">${running ? '' : (r.timer.elapsedMs ? 'Timer paused' : 'Timer not started yet')}</div>` : ''}
      </section>
      ${r ? `
      <section>
        <label class="find"><span>Find your table</span>
          <input id="find" data-keep type="search" autocomplete="off" placeholder="Type your name" value="${esc(ui.find)}"></label>
        <div class="tables">
          ${shown.length ? shown.map((m) => {
            if (!m.p2) return `<div class="match ${hit(m.p1) ? 'me' : ''}"><div class="tno">BYE</div><div class="side">${playerLink(m.p1)}</div><div class="res win">+3</div></div>`;
            const pts = matchPoints(m, ev.settings);
            const w1 = m.reported && m.p1Games > m.p2Games, w2 = m.reported && m.p2Games > m.p1Games;
            return `<div class="match ${hit(m.p1) || hit(m.p2) ? 'me' : ''}">
              <div class="tno">T${m.table}</div>
              <div class="side ${w1 ? 'won' : ''}">${playerLink(m.p1)}</div>
              <div class="vs">${m.reported ? `<b>${m.p1Games}–${m.p2Games}</b><small>${pts.p1}/${pts.p2} pts</small>` : 'vs'}</div>
              <div class="side right ${w2 ? 'won' : ''}">${playerLink(m.p2)}</div>
            </div>`;
          }).join('') : `<p class="muted">No table found for “${esc(ui.find)}”.</p>`}
        </div>
      </section>` : ''}
      <section>
        <h3>Standings so far</h3>
        ${standingsTable(st.rows, ev)}
      </section>`;
  }).join('<hr>');
}

function standingsTable(rows: ReturnType<typeof computeStandings>['rows'], ev: TournamentEvent): string {
  if (!rows.length) return '<p class="muted">No results yet.</p>';
  return `<ol class="rows">${rows.map((r) => `
    <li class="${r.inPrizes && ev.status === 'complete' ? 'prize' : ''} ${r.dropped ? 'dropped' : ''}">
      <span class="place">${placeLabel(r)}</span>
      <span class="who">${playerLink(r.playerId)}<small>${r.wins}-${r.losses}${r.draws ? `-${r.draws}` : ''} · games ${r.gamesWon}-${r.gamesLost}${r.byes ? ` · ${r.byes} bye` : ''}${r.dropped ? ' · dropped' : ''}</small></span>
      <span class="pts">${r.points}</span>
    </li>`).join('')}</ol>`;
}

function standingsView(): string {
  const ss = seasons();
  const cur = currentSeason(ss);
  const hasSeasons = ss.enabled && ss.seasons.length > 0;
  if (!ui.range) ui.range = cur ? 'season' : 'year';
  if (!hasSeasons && ui.range === 'season') ui.range = 'year';
  const season: Season | undefined = ui.range === 'season' ? (ui.seasonPick ? ss.seasons.find((s) => s.number === ui.seasonPick) : cur) : undefined;
  const eff = ui.range === 'season' && !season ? 'year' : ui.range;
  const now = new Date();

  const sums = playerSummaries(allEvents(), (e) => {
    const d = new Date(e.date);
    if (eff === 'season') return !!season && e.date >= season.start && e.date < season.end;
    if (eff === 'month') return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    if (eff === 'year') return d.getFullYear() === now.getFullYear();
    return true;
  });
  let anyLegacy = false;
  for (const p of state.players.values()) {
    if (!p.legacy || !legacyInRange(p.legacy, eff as 'season' | 'month' | 'year' | 'all', now)) continue;
    anyLegacy = true;
    sums.set(p.id, withLegacy(sums.get(p.id), p.id, p.legacy));
  }
  const key = ui.sort;
  const rows = [...sums.values()].filter((s) => s.events > 0)
    .sort((a, b) => (key === 'points' ? b.points - a.points : key === 'wins' ? b.wins - a.wins : b.events - a.events) || b.points - a.points);

  const ranges = hasSeasons ? [['season', 'Season'], ['year', 'This year'], ['all', 'All time']] : [['month', 'This month'], ['year', 'This year'], ['all', 'All time']];
  const isPast = !!season && season.end <= Date.now();
  const top = rows[0]?.[key];
  const champs = isPast && rows.length ? rows.filter((r) => r.points === rows[0].points).map((r) => nameOf(r.playerId)) : [];

  // shared places: equal value → same rank
  let lastVal: number | null = null, lastRank = 0;
  const ranked = rows.map((r, i) => {
    const v = r[key];
    if (v !== lastVal) { lastRank = i + 1; lastVal = v; }
    return { r, rank: lastRank };
  });

  return `
    <div class="seg" role="tablist">${ranges.map(([v, l]) => `<button data-range="${v}" class="${ui.range === v ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div class="seg small">${[['points', 'Points'], ['wins', 'Match wins'], ['events', 'Attendance']].map(([v, l]) => `<button data-sort="${v}" class="${ui.sort === v ? 'on' : ''}">${l}</button>`).join('')}</div>
    ${ui.range === 'season' && ss.seasons.length > 1 ? `<div class="chips">${[...ss.seasons].reverse().map((s) =>
      `<button data-season="${s === cur ? '' : s.number}" class="${s.number === season?.number ? 'on' : ''}">${esc(seasonLabel(s))}${s === cur ? ' · now' : ''}</button>`).join('')}</div>` : ''}
    ${season ? `<section class="card ${isPast ? 'gold' : 'accent'}">
      <h2>${esc(seasonLabel(season))}</h2>
      <div class="sub">${esc(seasonRange(season))} · ${isPast ? 'finished' : `${daysLeft(season)} day${daysLeft(season) === 1 ? '' : 's'} left`}</div>
      ${champs.length ? `<div class="champ">🏆 Champion${champs.length > 1 ? 's' : ''}: ${champs.map(esc).join(', ')}</div>` : ''}
    </section>` : ''}
    ${anyLegacy && (eff === 'year' || eff === 'all') ? `<p class="note">Includes stats from before the app${eff === 'year' ? ` (${now.getFullYear()})` : ''}.</p>` : ''}
    ${rows.length ? `<ol class="rows">${ranked.map(({ r, rank }) => `
      <li class="${rank <= 4 && top ? 'top' : ''}">
        <span class="place">${rank}</span>
        <span class="who">${playerLink(r.playerId)}<small>${r.events} event${r.events === 1 ? '' : 's'} · ${r.wins}-${r.losses} · ${r.firsts}× 1st</small></span>
        <span class="pts">${r[key]}</span>
      </li>`).join('')}</ol>` : `<p class="muted center">${eff === 'season' ? 'No events yet this season.' : 'No events in this range yet.'}</p>`}`;
}

function eventsView(): string {
  const evs = allEvents();
  if (!evs.length) return '<p class="muted center">No events yet.</p>';
  return `<ul class="list">${evs.map((ev) => {
    const st = ev.status === 'complete' ? computeStandings(ev, nameOf) : null;
    const winners = st ? st.rows.filter((r) => r.place === 1).map((r) => nameOf(r.playerId)) : [];
    return `<li><a href="#/events/${encodeURIComponent(ev.id)}">
      <span class="date">${esc(shortDate(ev.date))}</span>
      <span class="who"><b>${esc(ev.title)}</b><small>${ev.players.length} players${winners.length ? ` · 🏆 ${winners.map(esc).join(', ')}` : ''}${ev.status === 'running' ? ' · <span class="livetag">LIVE</span>' : ''}</small></span>
      <span class="chev">›</span></a></li>`;
  }).join('')}</ul>`;
}

function eventDetail(id: Id): string {
  const ev = state.events.get(id);
  if (!ev || ev.status === 'setup') return `<p class="muted center">That event isn’t available.</p><p class="center"><a class="btn" href="#/events">All events</a></p>`;
  const st = computeStandings(ev, nameOf);
  const fmt = `${ev.settings.format[0].toUpperCase()}${ev.settings.format.slice(1)} · best of ${ev.settings.bestOf} · ${ev.players.length} players`;
  return `
    <a class="back" href="#/events">‹ All events</a>
    <section class="card ${ev.status === 'running' ? 'accent' : ''}">
      <div class="eyebrow">${ev.status === 'running' ? '<span class="pulse"></span>LIVE · ' : ''}${esc(fmtDate(ev.date))}</div>
      <h2>${esc(ev.title)}</h2>
      <div class="sub">${esc(fmt)}</div>
    </section>
    <h3>${ev.status === 'complete' ? 'Final standings' : 'Standings so far'}</h3>
    ${standingsTable(st.rows, ev)}
    ${[...ev.rounds].reverse().filter((r) => r.status !== 'pairing').map((r) => `
      <h3>Round ${r.number}</h3>
      <div class="tables">${[...r.matches].sort((a, b) => a.table - b.table).map((m) => {
        if (!m.p2) return `<div class="match"><div class="tno">BYE</div><div class="side">${playerLink(m.p1)}</div><div class="res win">+3</div></div>`;
        const w1 = m.reported && m.p1Games > m.p2Games, w2 = m.reported && m.p2Games > m.p1Games;
        return `<div class="match"><div class="tno">T${m.table}</div>
          <div class="side ${w1 ? 'won' : ''}">${playerLink(m.p1)}</div>
          <div class="vs">${m.reported ? `<b>${m.p1Games}–${m.p2Games}</b>` : '—'}</div>
          <div class="side right ${w2 ? 'won' : ''}">${playerLink(m.p2)}</div></div>`;
      }).join('')}</div>`).join('')}`;
}

function playersView(): string {
  const sums = playerSummaries(allEvents());
  const q = ui.playerQ.trim().toLowerCase();
  const list = [...state.players.values()]
    .map((p) => ({ p, s: withLegacy(sums.get(p.id), p.id, p.legacy) }))
    .filter(({ p, s }) => s.events > 0 && (!q || p.name.toLowerCase().includes(q)))
    .sort((a, b) => a.p.name.localeCompare(b.p.name, undefined, { sensitivity: 'base' }));
  return `
    <label class="find"><span>Search players</span>
      <input id="playerQ" data-keep type="search" autocomplete="off" placeholder="Name" value="${esc(ui.playerQ)}"></label>
    ${list.length ? `<ul class="list">${list.map(({ p, s }) => `<li><a href="#/players/${encodeURIComponent(p.id)}">
      <span class="who"><b>${esc(p.name)}</b><small>${s.events} event${s.events === 1 ? '' : 's'} · ${s.wins}-${s.losses} · ${s.points} pts${s.firsts ? ` · ${s.firsts}× 1st` : ''}</small></span>
      <span class="chev">›</span></a></li>`).join('')}</ul>` : '<p class="muted center">No players found.</p>'}`;
}

function playerDetail(id: Id): string {
  const p = state.players.get(id);
  if (!p) return `<p class="muted center">Player not found.</p><p class="center"><a class="btn" href="#/players">All players</a></p>`;
  const evs = allEvents();
  const app = playerSummaries(evs).get(id);
  const all = withLegacy(app, id, p.legacy);
  const cur = currentSeason(seasons());
  const seasonSum = cur ? playerSummaries(evs, (e) => e.date >= cur.start && e.date < cur.end).get(id) : undefined;
  const h2h = headToHead(evs, id);
  const rv = rivals(h2h);
  const results = eventResultsFor(evs, id);
  const pct = all.matches ? Math.round((all.wins / all.matches) * 100) : 0;
  const stat = (n: string | number, l: string) => `<div class="stat"><b>${esc(n)}</b><small>${esc(l)}</small></div>`;
  const recStr = (h: { wins: number; losses: number; draws: number }) => `${h.wins}-${h.losses}${h.draws ? `-${h.draws}` : ''}`;
  return `
    <a class="back" href="#/players">‹ All players</a>
    <section class="card accent"><h2>${esc(p.name)}</h2>
      <div class="stats">
        ${stat(all.points, 'points')}${stat(all.events, 'events')}${stat(`${all.wins}-${all.losses}`, 'match record')}
        ${stat(`${pct}%`, 'match wins')}${stat(all.firsts, '1st places')}${stat(all.prizeFinishes, 'prize finishes')}
      </div>
      ${p.legacy ? `<p class="note">Includes stats from before the app: ${esc(legacySummary(p.legacy))}.</p>` : ''}
    </section>
    ${cur && seasonSum ? `<section class="card"><div class="eyebrow">${esc(seasonLabel(cur))}</div>
      <div class="stats">${stat(seasonSum.points, 'points')}${stat(seasonSum.events, 'events')}${stat(`${seasonSum.wins}-${seasonSum.losses}`, 'record')}</div></section>` : ''}
    ${rv.easiest || rv.toughest ? `<div class="rivals">
      ${rv.easiest ? `<section class="card"><div class="eyebrow">EASIEST OPPONENT</div><h3>${playerLink(rv.easiest.opponentId)}</h3><div class="sub">${recStr(rv.easiest)} against them</div></section>` : ''}
      ${rv.toughest ? `<section class="card"><div class="eyebrow">BIGGEST CHALLENGE</div><h3>${playerLink(rv.toughest.opponentId)}</h3><div class="sub">${recStr(rv.toughest)} against them</div></section>` : ''}
    </div>` : ''}
    ${h2h.length ? `<h3>Head to head</h3><ul class="list compact">${h2h.map((h) => `<li><div class="rowline">
      <span class="who">${playerLink(h.opponentId)}<small>${h.matches} match${h.matches === 1 ? '' : 'es'}</small></span>
      <span class="rec ${h.wins > h.losses ? 'up' : h.losses > h.wins ? 'down' : ''}">${recStr(h)}</span></div></li>`).join('')}</ul>` : ''}
    ${results.length ? `<h3>Events</h3><ul class="list compact">${results.map((r) => `<li><a href="#/events/${encodeURIComponent(r.eventId)}">
      <span class="date">${esc(shortDate(r.date))}</span>
      <span class="who"><b>${esc(r.title)}</b><small>${r.record} · ${r.points} pts · of ${r.players}</small></span>
      <span class="placepill ${r.place === 1 ? 'first' : ''}">${r.tied ? 'T-' : ''}${ord(r.place)}</span></a></li>`).join('')}</ul>` : ''}`;
}

// ───────────────────────── shell / routing ─────────────────────────

const app = document.getElementById('app')!;
const title = document.getElementById('league')!;
const nav = document.getElementById('nav')!;
const updated = document.getElementById('updated')!;

function route(): { tab: string; id?: string } {
  const [, tab, id] = location.hash.replace(/^#/, '').split('/');
  if (tab) return { tab, id: id ? decodeURIComponent(id) : undefined };
  return { tab: liveEvents().length ? 'live' : 'standings' };
}

function render() {
  if (state.error === 'notfound') {
    title.textContent = 'League not found';
    nav.innerHTML = '';
    app.innerHTML = `<section class="empty"><div class="big">🔍</div><h2>We couldn’t find that league</h2>
      <p>Check the web address with your organizer. It looks like <b>mtg-event.com/your-league</b>.</p></section>`;
    document.title = 'League not found · MTG Event';
    return;
  }
  if (!state.loaded) {
    app.innerHTML = state.error === 'offline'
      ? `<section class="empty"><div class="big">📡</div><h2>Can’t load right now</h2><p>Check your connection — this page retries automatically.</p></section>`
      : `<div class="loading">Loading…</div>`;
    return;
  }
  title.textContent = state.name;
  document.title = `${state.name} · MTG Event`;
  const r = route();
  const live = liveEvents().length > 0;
  const tabs: Array<[string, string]> = [['live', 'Live'], ['standings', 'Standings'], ['events', 'Events'], ['players', 'Players']];
  nav.innerHTML = tabs.map(([t, l]) => `<a href="#/${t}" class="${r.tab === t ? 'on' : ''}">${t === 'live' && live ? '<span class="pulse"></span>' : ''}${l}</a>`).join('');

  // keep focus/caret in a search box across re-renders
  const active = document.activeElement as HTMLInputElement | null;
  const keepId = active?.dataset?.keep !== undefined ? active.id : null;
  const caret = keepId ? active!.selectionStart : null;

  app.innerHTML =
    r.tab === 'live' ? liveView()
    : r.tab === 'standings' ? standingsView()
    : r.tab === 'events' ? (r.id ? eventDetail(r.id) : eventsView())
    : r.tab === 'players' ? (r.id ? playerDetail(r.id) : playersView())
    : standingsView();

  if (keepId) {
    const el = document.getElementById(keepId) as HTMLInputElement | null;
    if (el) { el.focus(); if (caret !== null) el.setSelectionRange(caret, caret); }
  }
  tickTimers();
  updated.textContent = state.lastUpdate ? `Updated ${new Date(state.lastUpdate).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : '';
}

function tickTimers() {
  document.querySelectorAll<HTMLElement>('[data-timer]').forEach((el) => {
    const ev = state.events.get(el.dataset.timer!);
    const r = ev && currentRound(ev);
    if (!r) return;
    const ms = timerRemainingMs(r);
    el.textContent = clock(ms);
    el.classList.toggle('over', ms <= 0);
    el.classList.toggle('warn', ms > 0 && ev!.settings.warnMinutes > 0 && ms <= ev!.settings.warnMinutes * 60_000);
    const note = document.querySelector<HTMLElement>(`[data-timer-note="${CSS.escape(ev!.id)}"]`);
    if (note && r.timer.runningSince) note.textContent = ms <= 0 ? 'Time! Finish the current turn, then 5 more turns.' : '';
  });
}

// events
window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });
app.addEventListener('input', (e) => {
  const t = e.target as HTMLInputElement;
  if (t.id === 'find') { ui.find = t.value; render(); }
  if (t.id === 'playerQ') { ui.playerQ = t.value; render(); }
});
app.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('button');
  if (!b) return;
  if (b.dataset.range) { ui.range = b.dataset.range as typeof ui.range; ui.seasonPick = null; render(); }
  if (b.dataset.sort) { ui.sort = b.dataset.sort as typeof ui.sort; render(); }
  if (b.dataset.season !== undefined) { ui.seasonPick = b.dataset.season ? Number(b.dataset.season) : null; render(); }
});

// polling: every 10 s during a live event, 60 s otherwise; paused while the tab is hidden
let timer: ReturnType<typeof setTimeout> | undefined;
async function poll() {
  clearTimeout(timer);
  if (!document.hidden) {
    const changed = await load();
    if (changed) render(); else updated.textContent = `Updated ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  }
  if (state.error === 'notfound') return;
  timer = setTimeout(poll, liveEvents().length ? 10_000 : 60_000);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
setInterval(tickTimers, 1000);

if (!slug) {
  location.replace('/');
} else {
  render();
  poll();
}
