// Thin client for the self-hosted MTG Event server (server/ in this repo).
import { Player, TournamentEvent } from '../core/types';
import type { Deletion } from '../data/db';
import type { SeasonSettings } from '../core/seasons';

export const DEFAULT_SERVER = 'https://mtg-event.com/api';

export interface User { id: string; email: string; name: string }
export interface League { id: string; slug: string; name: string; isPublic: boolean; role: 'owner' | 'organizer' }
export interface Member { id: string; name: string; email: string; role: 'owner' | 'organizer' }

export interface SyncSetting { name: 'seasons'; value: SeasonSettings; updatedAt: number }
export interface SyncPush {
  cursor: number;
  players: Player[];
  events: TournamentEvent[];
  deletions: Deletion[];
  settings: SyncSetting[];
}
export interface SyncResult {
  cursor: number;
  players: Player[];
  events: TournamentEvent[];
  deletions: Deletion[];
  settings: SyncSetting[];
  rejected: Array<{ kind: string; id: string; reason: string }>;
}

export class ApiError extends Error {
  constructor(public status: number, message: string, public code: string) { super(message); }
}

export class Api {
  constructor(public server: string, public token?: string) {}

  private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20_000);
    let res: Response;
    try {
      res = await fetch(`${this.server.replace(/\/+$/, '')}/${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: ctrl.signal,
      });
    } catch {
      throw new ApiError(0, 'Can’t reach the server. Check your internet connection.', 'offline');
    } finally {
      clearTimeout(timer);
    }
    let data: any = null;
    try { data = await res.json(); } catch { /* non-JSON error page */ }
    if (!res.ok) throw new ApiError(res.status, data?.error ?? `Server error (${res.status})`, data?.code ?? 'error');
    return data as T;
  }

  register(name: string, email: string, password: string, deviceName: string, invite?: string) {
    return this.req<{ token: string; user: User; leagues: League[] }>('POST', 'auth/register', { name, email, password, deviceName, ...(invite ? { invite } : {}) });
  }
  login(email: string, password: string, deviceName: string) {
    return this.req<{ token: string; user: User; leagues: League[] }>('POST', 'auth/login', { email, password, deviceName });
  }
  logout() { return this.req<{ ok: true }>('POST', 'auth/logout', {}); }
  me() { return this.req<{ user: User; leagues: League[] }>('GET', 'me'); }
  deleteAccount(password: string) {
    return this.req<{ ok: true; leaguesDeleted: string[]; leaguesTransferred: Array<{ name: string; to: string }> }>('POST', 'account/delete', { password });
  }

  createLeague(name: string, slug?: string) { return this.req<{ league: League }>('POST', 'leagues', { name, ...(slug ? { slug } : {}) }); }
  updateLeague(id: string, patch: { name?: string; isPublic?: boolean }) { return this.req<{ league: Omit<League, 'role'> }>('PATCH', `leagues/${id}`, patch); }
  members(id: string) { return this.req<{ members: Member[] }>('GET', `leagues/${id}/members`); }
  removeMember(id: string, userId: string) { return this.req<{ ok: true }>('DELETE', `leagues/${id}/members/${userId}`); }
  createInvite(id: string, days = 7, uses = 5) { return this.req<{ invite: { code: string; expiresAt: number; usesLeft: number } }>('POST', `leagues/${id}/invites`, { days, uses }); }
  acceptInvite(code: string) { return this.req<{ league: League }>('POST', `invites/${encodeURIComponent(code)}/accept`, {}); }

  sync(leagueId: string, push: SyncPush) { return this.req<SyncResult>('POST', `leagues/${leagueId}/sync`, push); }
  claim(leagueId: string, eventId: string, device: string, force = false) {
    return this.req<{ claimed: boolean; runner: string }>('POST', `leagues/${leagueId}/events/${eventId}/claim`, { device, force });
  }
  release(leagueId: string, eventId: string, device: string) {
    return this.req<{ ok: true }>('POST', `leagues/${leagueId}/events/${eventId}/release`, { device });
  }
}

/** Format an invite code for reading aloud / texting: ABCD-EFGH */
export const prettyCode = (c: string) => (c.length === 8 ? `${c.slice(0, 4)}-${c.slice(4)}` : c);
/** Public page for a league (the website is served from the same domain as the API). */
export const publicUrl = (server: string, slug: string) => `${server.replace(/\/api\/?$/, '').replace(/\/+$/, '')}/${slug}`;
/** The website's privacy policy page. */
export const privacyUrl = (server: string = DEFAULT_SERVER) => publicUrl(server, 'privacy');
