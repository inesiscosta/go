import { useCallback, useEffect, useRef, useState } from 'react';
import { BLACK, Board, PASS, type Stone, WHITE } from '../engine/board';
import type { BotRequest, BotResponse } from '../bot/worker';
import type { GameView } from './types';

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

export function useGame(settings: Settings): GameView {
  const [history, setHistory] = useState<Board[]>(() => [new Board(settings.size)]);
  const [thinking, setThinking] = useState(false);
  const [botWinrate, setBotWinrate] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const worker = useRef<Worker | null>(null);
  const requestId = useRef(0);

  const board = history[history.length - 1];
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
      const next = h[h.length - 1].clone();
      if (!next.isLegal(p)) return h;
      next.play(p);
      return [...h, next];
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
      if (botColor !== null) while (n > 0 && h[n].toPlay === botColor) n--;
      if (botColor !== null && h[n].toPlay === botColor) return h; // bot moves first; nothing to undo
      return h.slice(0, n + 1);
    });
  }, [botColor, stopBot]);

  const canUndo =
    botColor === null
      ? history.length > 1
      : history.slice(0, -1).some((b) => b.toPlay !== botColor);

  return {
    board,
    myColor: botColor === null ? null : botColor === BLACK ? WHITE : BLACK,
    opponentName: 'Computer',
    isMyTurn: isHumanTurn,
    thinking,
    confidence: botWinrate,
    error,
    outcome: null,
    play,
    pass,
    undo,
    canUndo,
  };
}
