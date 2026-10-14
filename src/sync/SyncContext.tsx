// Shared-league connection: sign-in, league choice and automatic background sync.
// Works offline-first — the phone always saves locally; sync catches up when it can.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import * as db from '../data/db';
import { useStore } from '../data/store';
import { Api, ApiError, DEFAULT_SERVER, League, User } from './api';
import { pendingCount, syncPass } from './engine';

interface Session {
  server: string;
  token: string;
  user: User;
  league?: League;
  cursor: number;
  lastSyncAt?: number;
}

export type SyncStatus = 'off' | 'idle' | 'syncing' | 'offline' | 'error';

interface SyncCtx {
  session?: Session;
  status: SyncStatus;
  error?: string;
  pending: number;
  /** label this phone uses when it claims an event, e.g. "Brian (k3f9)" */
  device: string;
  api: Api;
  signIn: (email: string, password: string, server?: string) => Promise<League[]>;
  register: (name: string, email: string, password: string, invite?: string, server?: string) => Promise<League[]>;
  signOut: () => Promise<void>;
  myLeagues: () => Promise<League[]>;
  /** connect this phone to a league. mode = what to do with data already on the phone */
  connect: (league: League, mode: 'merge' | 'replace', isNewLeague?: boolean) => Promise<void>;
  disconnect: () => void;
  updateLeague: (league: League) => void;
  syncNow: () => Promise<void>;
}

const Ctx = createContext<SyncCtx | null>(null);
const KEY = 'syncSession';

function deviceTag(): string {
  let tag = db.getSetting<string>('deviceTag');
  if (!tag) {
    tag = Math.random().toString(36).slice(2, 6);
    db.setSetting('deviceTag', tag);
  }
  return tag;
}

export function SyncProvider({ children }: { children: React.ReactNode }) {
  const store = useStore();
  const [session, setSessionState] = useState<Session | undefined>(() => {
    const s = db.getSetting<Session>(KEY) ?? undefined;
    // Seasons set up before sharing existed were never marked for upload. If this phone owns
    // the league and has never synced seasons, share them now.
    if (s?.league?.role === 'owner' && !db.getSetting('seasonsMeta') && db.getSetting<{ seasons?: unknown[] }>('seasons')?.seasons?.length) {
      db.setSetting('seasonsMeta', { updatedAt: Date.now(), dirty: true });
    }
    return s;
  });
  const [status, setStatus] = useState<SyncStatus>(session?.league ? 'idle' : 'off');
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(0);
  const sessionRef = useRef(session);
  const running = useRef(false);
  const again = useRef(false);

  const setSession = useCallback((s: Session | undefined) => {
    sessionRef.current = s;
    setSessionState(s);
    db.setSetting(KEY, s ?? null);
  }, []);

  const api = useMemo(() => new Api(session?.server ?? DEFAULT_SERVER, session?.token), [session?.server, session?.token]);
  const device = `${session?.user.name ?? 'Phone'} (${deviceTag()})`;

  const syncNow = useCallback(async () => {
    const s = sessionRef.current;
    if (!s?.league) return;
    if (running.current) { again.current = true; return; }
    running.current = true;
    setStatus('syncing');
    try {
      do {
        again.current = false;
        const cur = sessionRef.current;
        if (!cur?.league) break;
        const r = await syncPass(new Api(cur.server, cur.token), cur.league.id, cur.cursor);
        // only record the result if this phone is still connected to the same league
        const latest = sessionRef.current;
        if (latest?.league?.id === cur.league.id) setSession({ ...latest, cursor: r.cursor, lastSyncAt: Date.now() });
        if (r.changed) store.reload();
        setError(r.invalid ? `${r.invalid} item${r.invalid === 1 ? '' : 's'} couldn’t be shared (invalid data).` : undefined);
      } while (again.current);
      setStatus('idle');
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError(0, String(e), 'error');
      if (err.status === 401) {
        // signed out elsewhere or session removed: keep local data, drop the connection
        setSession(undefined);
        setStatus('off');
        setError('You were signed out. Sign in again to keep sharing.');
      } else if (err.status === 403) {
        const cur = sessionRef.current;
        if (cur) setSession({ ...cur, league: undefined, cursor: 0 });
        setStatus('off');
        setError('You no longer have access to that league. Your data is still on this phone.');
      } else {
        setStatus(err.code === 'offline' ? 'offline' : 'error');
        setError(err.message);
      }
    } finally {
      running.current = false;
      setPending(pendingCount());
    }
  }, [setSession, store.reload]);

  // ── triggers ──
  // 1) local changes: sync a couple of seconds after the last edit
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    const n = pendingCount();
    setPending(n);
    if (!session?.league || n === 0) return;
    clearTimeout(debounce.current);
    debounce.current = setTimeout(syncNow, 2500);
    return () => clearTimeout(debounce.current);
  }, [store.players, store.events, store.seasons, session?.league?.id]);

  // 2) app opened / brought back, plus every 30 s while open, to pick up co-hosts' changes
  useEffect(() => {
    if (!session?.league) return;
    syncNow();
    let t = setInterval(syncNow, 30_000);
    const sub = AppState.addEventListener('change', (st) => {
      clearInterval(t);
      if (st === 'active') { syncNow(); t = setInterval(syncNow, 30_000); }
    });
    return () => { clearInterval(t); sub.remove(); };
  }, [session?.league?.id, syncNow]);

  // ── account ──
  const signIn = useCallback(async (email: string, password: string, server = DEFAULT_SERVER) => {
    const r = await new Api(server).login(email.trim(), password, device);
    setSession({ server, token: r.token, user: r.user, cursor: 0 });
    setError(undefined);
    return r.leagues;
  }, [setSession, device]);

  const register = useCallback(async (name: string, email: string, password: string, invite?: string, server = DEFAULT_SERVER) => {
    const r = await new Api(server).register(name.trim(), email.trim(), password, device, invite?.trim() || undefined);
    setSession({ server, token: r.token, user: r.user, cursor: 0 });
    setError(undefined);
    return r.leagues;
  }, [setSession, device]);

  const signOut = useCallback(async () => {
    const s = sessionRef.current;
    if (s) { try { await new Api(s.server, s.token).logout(); } catch { /* offline: token just expires unused */ } }
    setSession(undefined);
    setStatus('off');
    setError(undefined);
  }, [setSession]);

  const myLeagues = useCallback(async () => {
    const s = sessionRef.current;
    if (!s) return [];
    return (await new Api(s.server, s.token).me()).leagues;
  }, []);

  const connect = useCallback(async (league: League, mode: 'merge' | 'replace', isNewLeague = false) => {
    const s = sessionRef.current;
    if (!s) return;
    if (mode === 'replace') {
      db.wipeRosterAndEvents();
      db.setSetting('seasons', null);
      db.setSetting('seasonsMeta', null);
    } else {
      db.markAllDirty(); // upload everything already on this phone
      const meta = db.getSetting<{ updatedAt: number; dirty: boolean }>('seasonsMeta');
      const hasSeasons = !!db.getSetting<{ seasons?: unknown[] }>('seasons')?.seasons?.length;
      if (isNewLeague) {
        // a brand-new league takes this phone's season setup
        if (hasSeasons) db.setSetting('seasonsMeta', { updatedAt: Date.now(), dirty: true });
      } else {
        // joining an existing league: its season setup wins over this phone's
        db.setSetting('seasonsMeta', { updatedAt: meta?.updatedAt ?? 0, dirty: false });
      }
    }
    store.reload();
    setSession({ ...s, league, cursor: 0, lastSyncAt: undefined });
    setStatus('idle');
    setError(undefined);
    // the league effect above kicks off the first sync
  }, [setSession, store.reload]);

  const disconnect = useCallback(() => {
    const s = sessionRef.current;
    if (s) setSession({ ...s, league: undefined, cursor: 0, lastSyncAt: undefined });
    setStatus('off');
    setError(undefined);
  }, [setSession]);

  const updateLeague = useCallback((league: League) => {
    const s = sessionRef.current;
    if (s?.league?.id === league.id) setSession({ ...s, league });
  }, [setSession]);

  const value: SyncCtx = {
    session, status, error, pending, device, api,
    signIn, register, signOut, myLeagues, connect, disconnect, updateLeague, syncNow,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSync(): SyncCtx {
  const s = useContext(Ctx);
  if (!s) throw new Error('useSync outside SyncProvider');
  return s;
}

/** "just now", "3 min ago", ... */
export function ago(ts?: number): string {
  if (!ts) return 'never';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  return new Date(ts).toLocaleDateString();
}
