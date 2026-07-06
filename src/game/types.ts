import type { Board, Stone } from '../engine/board';

export interface Outcome {
  winner: Stone | null; // null = draw
  reason: 'score' | 'resign';
  /** Area scores, komi included for white. */
  black: number;
  white: number;
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
  /** Set when the game ended some way other than two passes, e.g. resignation. */
  outcome: Outcome | null;
  /** Replaces the computed status line, e.g. "Waiting for your opponent". */
  status?: string;
  play: (p: number) => void;
  pass: () => void;
  undo?: () => void;
  canUndo: boolean;
}
