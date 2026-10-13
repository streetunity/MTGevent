import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { newId } from '../core/id';
import { LegacyRow } from '../core/legacy';
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
  importLegacy: (rows: LegacyRow[]) => { updated: number; created: number };
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
  lastSettings: () => Partial<EventSettings> | undefined;
  rememberSettings: (s: EventSettings) => void;
}

const Ctx = createContext<Store | null>(null);

export const norm = (s: string) => s.trim().replace(/\s+/g, ' ');

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [players, setPlayers] = useState<Player[]>(() => db.loadPlayers());
  const [events, setEvents] = useState<TournamentEvent[]>(() => db.loadEvents());

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

  const importLegacy = useCallback((rows: LegacyRow[]) => {
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
    resetAll: () => { db.resetAll(); setEvents([]); setPlayers([]); },
    getSetting: (key) => db.getSetting(key),
    setSetting: (key, value) => db.setSetting(key, value),
    lastSettings: () => db.getSetting<Partial<EventSettings>>('lastSettings'),
    rememberSettings: (s) => db.setSetting('lastSettings', { ...s, autoRounds: true }),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('useStore outside StoreProvider');
  return s;
}
