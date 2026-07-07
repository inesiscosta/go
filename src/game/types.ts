import type { Board, Stone } from '../engine/board';

export interface Outcome {
  winner: Stone | null; // null = draw
  reason: 'score' | 'resign';
  /** Area scores, komi included for white. */
  black: number;
  white: number;
  /** The stones agreed dead, when the game was scored. */
  dead?: ReadonlySet<number>;
}

/**
 * After both players pass, they agree which stones are dead before the game
 * is scored. Present only during that phase.
 */
export interface Scoring {
  /** Points currently marked dead. */
  dead: ReadonlySet<number>;
  /** Marks or unmarks the whole group at p. Missing when you can't change the marks (spectators). */
  toggle?: (p: number) => void;
  /** Agrees to the current marks. Missing when you can't (spectators, or you already have). */
  accept?: () => void;
  /** Online only: who has agreed to the current marks. */
  accepted?: { me: boolean; them: boolean };
}

/** Wall-clock times (local epoch ms) for the players' clocks. */
export interface Clock {
  /** When the game started, or null if it hasn't (waiting for an opponent). */
  start: number | null;
  /** When each move was played, in order. */
  times: readonly number[];
  /** When the clocks stopped (play ended), or null while they run. */
  end: number | null;
}

/** What the game screen needs, whoever the opponent is. */
export interface GameView {
  board: Board;
  /** The local player's colour, or null when both players share this device. */
  myColor: Stone | null;
  /** What to call the other side: "Computer", "Opponent". */
  opponentName: string;
  isMyTurn: boolean;
  /** The opponent is thinking (bot). */
  thinking: boolean;
  /** The bot's estimate of its own winning chances. */
  confidence: number | null;
  error: string | null;
  /** Set once the game is over: resignation, or the score after dead stones were agreed. */
  outcome: Outcome | null;
  scoring: Scoring | null;
  clock: Clock;
  /** Replaces the computed status line, e.g. "Waiting for your opponent". */
  status?: string;
  play: (p: number) => void;
  pass: () => void;
  undo?: () => void;
  canUndo: boolean;
}
