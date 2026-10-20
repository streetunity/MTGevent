// Core data model. Everything here is plain data so it can be saved as JSON,
// tested without React Native, and synced to a server later.

export type Id = string;

export interface LegacyStats {
  /** total points earned before this app (e.g. from MTGevent.com) */
  points: number;
  /** number of events played before this app */
  events: number;
  /** optional match record and 1st places from before this app */
  wins?: number;
  losses?: number;
  firsts?: number;
  /** calendar year these stats come from; undefined = undated (counts in all-time only) */
  year?: number;
}

export interface Player {
  id: Id;
  name: string;
  createdAt: number;
  updatedAt: number;
  legacy?: LegacyStats;
}

export type Format = 'constructed' | 'draft' | 'sealed' | 'commander';
export type Structure = 'swiss'; // 'swiss_topcut' | 'single_elim' planned
export type ScoringPreset = 'house' | 'official';
export type TiebreakMode = 'shared' | 'official' | 'h2h';

export interface EventSettings {
  format: Format;
  structure: Structure;
  bestOf: 1 | 3;
  rounds: number;
  /** true while the round count is still following the recommendation */
  autoRounds: boolean;
  roundMinutes: number;
  /** minutes-left warning; 0 = no warning */
  warnMinutes: number;
  scoring: ScoringPreset;
  tiebreak: TiebreakMode;
  prizeSpots: number;
}

export interface EventPlayer {
  playerId: Id;
  /** round number the player first becomes pairable (1 = from the start) */
  joinedRound: number;
  /** if set, the player is not paired in any round after this one */
  droppedAfterRound?: number;
}

export interface Match {
  id: Id;
  table: number;
  p1: Id;
  /** null = bye */
  p2: Id | null;
  p1Games: number;
  p2Games: number;
  reported: boolean;
}

export type RoundStatus = 'pairing' | 'active' | 'complete';

export interface RoundTimer {
  durationMs: number;
  /** epoch ms when the clock was last started or resumed; undefined = not running */
  runningSince?: number;
  /** ms already elapsed before runningSince */
  elapsedMs: number;
}

export interface Round {
  number: number;
  status: RoundStatus;
  matches: Match[];
  timer: RoundTimer;
}

export type EventStatus = 'setup' | 'running' | 'complete';

export interface TournamentEvent {
  id: Id;
  title: string;
  date: number;
  location?: string;
  status: EventStatus;
  settings: EventSettings;
  players: EventPlayer[];
  rounds: Round[];
  createdAt: number;
  updatedAt: number;
}

export const DEFAULT_SETTINGS: EventSettings = {
  format: 'constructed',
  structure: 'swiss',
  bestOf: 3,
  rounds: 3,
  autoRounds: false, // house default: a fixed 3 rounds; "Use recommended" switches to auto
  roundMinutes: 50,
  warnMinutes: 10,
  scoring: 'house',
  tiebreak: 'shared',
  prizeSpots: 4,
};
