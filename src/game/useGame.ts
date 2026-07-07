import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BLACK, Board, PASS, type Stone, WHITE } from '../engine/board';
import { estimateDead } from '../bot/mcts';
import type { BotRequest, BotResponse } from '../bot/worker';
import type { GameView, Outcome } from './types';

export type Mode = 'bot' | 'local';
export type Level = 'easy' | 'medium' | 'hard';

export interface Settings {
  mode: Mode;
  size: 9 | 13 | 19;
  komi: number;
  level: Level;
  /** The human's colour when playing the computer. */
  humanColor: Stone;
}

function searchOptions(level: Level, size: number, komi: number) {
  if (level === 'easy') return { komi, timeMs: 5000, maxPlayouts: 200 };
  if (level === 'medium') return { komi, timeMs: size === 9 ? 1200 : 2000 };
  return { komi, timeMs: size === 9 ? 3500 : 6000 };
}

/** Keeps the bot from answering instantly, which feels abrupt. */
const MIN_THINK_MS = 450;

/** A position and when it was reached (for the clocks). */
interface Entry {
  board: Board;
  at: number;
}

/** The dead-stone marks for one finished position. Stale (ignored) once the position changes, e.g. after an undo. */
interface Marks {
  board: Board;
  dead: ReadonlySet<number>;
  accepted: boolean;
}

/** Toggles the whole group at p in or out of the dead set. */
export function toggleGroup(board: Board, dead: ReadonlySet<number>, p: number): Set<number> {
  const next = new Set(dead);
  const group = board.group(p);
  const wasDead = dead.has(p);
  for (const q of group) {
    if (wasDead) next.delete(q);
    else next.add(q);
  }
  return next;
}

export function finalOutcome(board: Board, dead: Iterable<number>, komi: number): Outcome {
  const { black, white: w } = board.scoreWithDead(dead);
  const white = w + komi;
  return {
    winner: black === white ? null : black > white ? BLACK : WHITE,
    reason: 'score',
    black,
    white,
    dead: new Set(dead),
  };
}

export function useGame(settings: Settings): GameView {
  const [history, setHistory] = useState<Entry[]>(() => [{ board: new Board(settings.size), at: Date.now() }]);
  const [marks, setMarks] = useState<Marks | null>(null);
  const [thinking, setThinking] = useState(false);
  const [botWinrate, setBotWinrate] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const worker = useRef<Worker | null>(null);
  const requestId = useRef(0);

  const board = history[history.length - 1].board;
  const botColor = settings.mode === 'bot' ? (settings.humanColor === BLACK ? WHITE : BLACK) : null;
  const isHumanTurn = !board.isOver && board.toPlay !== botColor;

  const stopBot = useCallback(() => {
    requestId.current++;
    if (worker.current) {
      worker.current.terminate();
      worker.current = null;
    }
    setThinking(false);
  }, []);

  useEffect(() => stopBot, [stopBot]);

  const apply = useCallback((p: number) => {
    setHistory((h) => {
      const next = h[h.length - 1].board.clone();
      if (!next.isLegal(p)) return h;
      next.play(p);
      return [...h, { board: next, at: Date.now() }];
    });
  }, []);

  // Ask the bot for a move whenever it's its turn.
  useEffect(() => {
    if (botColor === null || board.isOver || board.toPlay !== botColor) return;
    const id = ++requestId.current;
    if (!worker.current)
      worker.current = new Worker(new URL('../bot/worker.ts', import.meta.url), { type: 'module' });
    const w = worker.current;
    const started = performance.now();
    setThinking(true);
    setError(null);

    w.onmessage = (e: MessageEvent<BotResponse>) => {
      if (e.data.id !== id) return;
      const wait = Math.max(0, MIN_THINK_MS - (performance.now() - started));
      setTimeout(() => {
        if (requestId.current !== id) return;
        setThinking(false);
        setBotWinrate(e.data.winrate);
        apply(e.data.move);
      }, wait);
    };
    w.onerror = () => {
      if (requestId.current !== id) return;
      setThinking(false);
      setError('The computer ran into a problem. Try undoing, or start a new game.');
    };
    w.postMessage({
      id,
      state: board.toState(),
      options: searchOptions(settings.level, settings.size, settings.komi),
    } satisfies BotRequest);
  }, [board, botColor, settings.level, settings.size, settings.komi, apply]);

  const play = useCallback(
    (p: number) => {
      if (isHumanTurn) apply(p);
    },
    [isHumanTurn, apply],
  );

  const pass = useCallback(() => {
    if (isHumanTurn) apply(PASS);
  }, [isHumanTurn, apply]);

  // Against the computer, undo goes back to the human's previous turn.
  const undo = useCallback(() => {
    stopBot();
    setHistory((h) => {
      let n = h.length - 1;
      if (n === 0) return h;
      n--;
      if (botColor !== null) while (n > 0 && h[n].board.toPlay === botColor) n--;
      if (botColor !== null && h[n].board.toPlay === botColor) return h; // bot moves first; nothing to undo
      return h.slice(0, n + 1);
    });
  }, [botColor, stopBot]);

  const canUndo =
    botColor === null
      ? history.length > 1
      : history.slice(0, -1).some((e) => e.board.toPlay !== botColor);

  // Once both players pass, start from the engine's guess at the dead stones;
  // the human adjusts it and accepts (the computer goes along with it).
  const suggested = useMemo(() => (board.isOver ? new Set(estimateDead(board)) : null), [board]);
  const current: Marks | null =
    marks?.board === board ? marks : suggested ? { board, dead: suggested, accepted: false } : null;

  const outcome = current?.accepted ? finalOutcome(board, current.dead, settings.komi) : null;

  const scoring =
    current && !current.accepted
      ? {
          dead: current.dead,
          toggle: (p: number) => setMarks({ board, dead: toggleGroup(board, current.dead, p), accepted: false }),
          accept: () => setMarks({ ...current, accepted: true }),
        }
      : null;

  return {
    board,
    myColor: botColor === null ? null : botColor === BLACK ? WHITE : BLACK,
    opponentName: 'Computer',
    isMyTurn: isHumanTurn,
    thinking,
    confidence: botWinrate,
    error,
    outcome,
    scoring,
    clock: {
      start: history[0].at,
      times: history.slice(1).map((e) => e.at),
      end: board.isOver ? history[history.length - 1].at : null,
    },
    play,
    pass,
    undo,
    canUndo,
  };
}
