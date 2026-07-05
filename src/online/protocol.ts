/**
 * Messages between the browser and a room's Durable Object (worker/room.ts).
 *
 * The server owns the game: clients send the move they want to make, the
 * server checks it with the same rules engine and broadcasts the result.
 */

export type Color = 'black' | 'white';
export type BoardSize = 9 | 13 | 19;

export interface CreateRoomRequest {
  size: BoardSize;
  komi: number;
  color: Color | 'random';
}

export interface CreateRoomResponse {
  code: string;
  /** Proves the creator owns their seat; kept in localStorage, never in a URL. */
  token: string;
  color: Color;
}

export type ClientMessage =
  /** First message on every connection. Without a valid token you get a free seat, or watch. */
  | { type: 'hello'; token?: string }
  /** `at` is the number of moves the client has seen, so stale or doubled clicks are ignored. */
  | { type: 'move'; move: string; at: number }
  | { type: 'resign' }
  | { type: 'rematch' };

export type Presence = 'empty' | 'online' | 'offline';

export interface Result {
  winner: Color | null; // null = draw
  reason: 'score' | 'resign';
  /** Final area scores (komi included for white) when the game ended by passing. */
  black?: number;
  white?: number;
}

export interface RoomState {
  code: string;
  size: BoardSize;
  komi: number;
  /** Moves in order, as "D4" or "pass". */
  moves: string[];
  result: Result | null;
  players: Record<Color, Presence>;
  /** Which players asked for a rematch after the game ended. */
  rematch: Record<Color, boolean>;
}

export type ServerMessage =
  | { type: 'welcome'; color: Color | null; token?: string }
  | { type: 'state'; state: RoomState }
  | { type: 'error'; message: string };

/** Close code sent when the room doesn't exist (or has expired). */
export const CLOSE_NOT_FOUND = 4004;
/** Close code sent when a room already has too many connections. */
export const CLOSE_FULL = 4029;

/** Room codes avoid look-alike characters (0/O, 1/I/L). */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 6;

export function normalizeCode(input: string): string | null {
  const code = input.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length !== CODE_LENGTH) return null;
  for (const ch of code) if (!CODE_ALPHABET.includes(ch)) return null;
  return code;
}
