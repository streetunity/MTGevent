import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';
import { newId } from '../core/id';
import { LegacyRow } from '../core/legacy';
import { DEFAULT_SEASONS, extendSeasons, SeasonSettings } from '../core/seasons';
import { EventSettings, LegacyStats, Player, TournamentEvent } from '../core/types';
import * as db from './db';

interface Store {
  players: Player[];
  playersById: Map<string, Player>;
  events: TournamentEvent[];
  nameOf: (id: string) => string;
  /** returns the existing player if the name matches (case-insensitive), else creates one */
  findOrCreatePlayer: (name: string) => Player;
  renamePlayer: (id: string, name: string) => void;
  /** set or clear (undefined) a player's legacy totals */
  setLegacy: (id: string, legacy: LegacyStats | undefined) => void;
  /** create/match players by name and set their legacy totals; returns counts */
  importLegacy: (rows: LegacyRow[], year?: number) => { updated: number; created: number };
  /** move all of `fromId`'s history onto `intoId` and delete `fromId` */
  mergePlayers: (fromId: string, intoId: string) => void;
  getEvent: (id: string) => TournamentEvent | undefined;
  saveEvent: (ev: TournamentEvent) => void;
  deleteEvent: (id: string) => void;
  /** remove imported legacy stats from every player */
  clearAllLegacy: () => void;
  /** delete every event (players and legacy stats stay) */
  deleteAllEvents: () => void;
  /** wipe players, events and settings */
  resetAll: () => void;
  getSetting: <T>(key: string) => T | undefined;
  setSetting: (key: string, value: unknown) => void;
  /** season configuration (auto-extended so a season always covers today) */
  seasons: SeasonSettings;
  saveSeasons: (s: SeasonSettings) => void;
  lastSettings: () => Partial<EventSettings> | undefined;
  rememberSettings: (s: EventSettings) => void;
  /** re-read everything from the database (after a sync downloaded changes) */
  reload: () => void;
}

const Ctx = createContext<Store | null>(null);

export const norm = (s: string) => s.trim().replace(/\s+/g, ' ');

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [players, setPlayers] = useState<Player[]>(() => db.loadPlayers());
  const [events, setEvents] = useState<TournamentEvent[]>(() => db.loadEvents());
  const [seasons, setSeasons] = useState<SeasonSettings>(() => {
    const stored = db.getSetting<SeasonSettings>('seasons') ?? DEFAULT_SEASONS;
    const ext = extendSeasons(stored);
    if (ext !== stored) db.setSetting('seasons', ext);
    return ext;
  });
  const saveSeasons = useCallback((s: SeasonSettings) => {
    const ext = extendSeasons(s);
    db.setSetting('seasons', ext);
    // a deliberate change → share it with the league on the next sync
    db.setSetting('seasonsMeta', { updatedAt: Date.now(), dirty: true });
    setSeasons(ext);
  }, []);
  const reload = useCallback(() => {
    setPlayers(db.loadPlayers());
    setEvents(db.loadEvents());
    setSeasons(extendSeasons(db.getSetting<SeasonSettings>('seasons') ?? DEFAULT_SEASONS));
  }, []);
  // roll over to the next season if the app was left open (or in the background) past a season's end
  useEffect(() => {
    const roll = () => setSeasons((cur) => {
      const ext = extendSeasons(cur);
      if (ext !== cur) db.setSetting('seasons', ext);
      return ext;
    });
    const sub = AppState.addEventListener('change', (st) => { if (st === 'active') roll(); });
    const t = setInterval(roll, 60 * 60 * 1000);
    return () => { sub.remove(); clearInterval(t); };
  }, []);

  const playersById = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const nameOf = useCallback((id: string) => playersById.get(id)?.name ?? 'Unknown', [playersById]);

  const sortPlayers = (ps: Player[]) => [...ps].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

  const findOrCreatePlayer = useCallback((raw: string) => {
    const name = norm(raw);
    const existing = players.find((p) => p.name.toLowerCase() === name.toLowerCase());
    if (existing) return existing;
    const now = Date.now();
    const p: Player = { id: newId(), name, createdAt: now, updatedAt: now };
    db.savePlayer(p);
    setPlayers((ps) => sortPlayers([...ps, p]));
    return p;
  }, [players]);

  const renamePlayer = useCallback((id: string, raw: string) => {
    const name = norm(raw);
    if (!name) return;
    setPlayers((ps) => {
      const next = ps.map((p) => (p.id === id ? { ...p, name, updatedAt: Date.now() } : p));
      const changed = next.find((p) => p.id === id);
      if (changed) db.savePlayer(changed);
      return sortPlayers(next);
    });
  }, []);

  const setLegacy = useCallback((id: string, legacy: LegacyStats | undefined) => {
    setPlayers((ps) => ps.map((p) => {
      if (p.id !== id) return p;
      const next: Player = { ...p, updatedAt: Date.now() };
      if (legacy) next.legacy = legacy; else delete next.legacy;
      db.savePlayer(next);
      return next;
    }));
  }, []);

  const importLegacy = useCallback((rows: LegacyRow[], year?: number) => {
    const byName = new Map(players.map((p) => [p.name.toLowerCase(), p]));
    const now = Date.now();
    let updated = 0, created = 0;
    const out = new Map(players.map((p) => [p.id, p]));
    for (const r of rows) {
      const name = norm(r.name);
      const legacy: LegacyStats = { points: r.points, events: r.events };
      if (r.wins !== undefined) legacy.wins = r.wins;
      if (r.losses !== undefined) legacy.losses = r.losses;
      if (r.firsts !== undefined) legacy.firsts = r.firsts;
      if (year !== undefined) legacy.year = year;
      const existing = byName.get(name.toLowerCase());
      const p: Player = existing
        ? { ...existing, legacy, updatedAt: now }
        : { id: newId(), name, createdAt: now, updatedAt: now, legacy };
      if (existing) updated++; else created++;
      byName.set(name.toLowerCase(), p);
      out.set(p.id, p);
      db.savePlayer(p);
    }
    setPlayers(sortPlayers([...out.values()]));
    return { updated, created };
  }, [players]);

  const saveEvent = useCallback((ev: TournamentEvent) => {
    db.saveEvent(ev);
    setEvents((es) => {
      const rest = es.filter((e) => e.id !== ev.id);
      return [ev, ...rest].sort((a, b) => b.date - a.date);
    });
  }, []);

  const mergePlayers = useCallback((fromId: string, intoId: string) => {
    if (fromId === intoId) return;
    const swap = (id: string | null) => (id === fromId ? intoId : id);
    setEvents((es) => es.map((ev) => {
      const touches = ev.players.some((p) => p.playerId === fromId);
      if (!touches) return ev;
      const both = ev.players.some((p) => p.playerId === intoId);
      const next: TournamentEvent = {
        ...ev,
        updatedAt: Date.now(),
        // if both were in the same event, keep the target's entry
        players: both ? ev.players.filter((p) => p.playerId !== fromId) : ev.players.map((p) => ({ ...p, playerId: swap(p.playerId)! })),
        rounds: ev.rounds.map((r) => ({ ...r, matches: r.matches.map((m) => ({ ...m, p1: swap(m.p1)!, p2: swap(m.p2) })) })),
      };
      db.saveEvent(next);
      return next;
    }));
    db.deletePlayer(fromId);
    setPlayers((ps) => {
      const from = ps.find((p) => p.id === fromId);
      return ps.filter((p) => p.id !== fromId).map((p) => {
        if (p.id !== intoId || !from?.legacy) return p;
        // combine legacy totals so nothing is lost
        const a = p.legacy, b = from.legacy;
        const legacy: LegacyStats = {
          points: (a?.points ?? 0) + b.points,
          events: (a?.events ?? 0) + b.events,
          wins: (a?.wins ?? 0) + (b.wins ?? 0),
          losses: (a?.losses ?? 0) + (b.losses ?? 0),
          firsts: (a?.firsts ?? 0) + (b.firsts ?? 0),
        };
        const y = a ? (a.year === b.year ? a.year : undefined) : b.year;
        if (y !== undefined) legacy.year = y;
        const next = { ...p, legacy, updatedAt: Date.now() };
        db.savePlayer(next);
        return next;
      });
    });
  }, []);

  const value: Store = {
    players, playersById, events, nameOf, findOrCreatePlayer, renamePlayer, mergePlayers, setLegacy, importLegacy,
    getEvent: (id) => events.find((e) => e.id === id),
    saveEvent,
    deleteEvent: (id) => { db.deleteEvent(id); setEvents((es) => es.filter((e) => e.id !== id)); },
    clearAllLegacy: () => {
      db.clearAllLegacy();
      setPlayers((ps) => ps.map((p) => { if (!p.legacy) return p; const { legacy: _l, ...rest } = p; return rest; }));
    },
    deleteAllEvents: () => { db.deleteAllEvents(); setEvents([]); },
    resetAll: () => { db.resetAll(); setEvents([]); setPlayers([]); setSeasons(DEFAULT_SEASONS); },
    seasons,
    saveSeasons,
    getSetting: (key) => db.getSetting(key),
    setSetting: (key, value) => db.setSetting(key, value),
    lastSettings: () => {
      const saved = db.getSetting<Partial<EventSettings> & { v?: number }>('lastSettings');
      if (!saved) return undefined;
      const { v, ...rest } = saved;
      // settings saved by older versions always had auto rounds forced on; start those at a fixed 3
      return v === 2 ? rest : { ...rest, autoRounds: false, rounds: 3 };
    },
    // remember the organizer's choices (including a fixed round count) for the next event
    rememberSettings: (s) => db.setSetting('lastSettings', { ...s, v: 2 }),
    reload,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('useStore outside StoreProvider');
  return s;
}
