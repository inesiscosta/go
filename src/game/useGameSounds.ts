import { useEffect, useRef, useState } from 'react';
import { PASS, type Board, type Stone } from '../engine/board';
import { isMuted, onMutedChange, setMuted, sounds } from '../sound';
import type { Outcome } from './types';

/**
 * Plays sounds for what just happened on the board. Only a single new move
 * makes a sound, so undo, reconnecting or loading a game in progress stay quiet.
 */
export function useGameSounds(board: Board, outcome: Outcome | null, myColor: Stone | null) {
  const previous = useRef<Board | null>(null);
  const wasOver = useRef(outcome !== null);

  useEffect(() => {
    const before = previous.current;
    previous.current = board;
    if (!before || board.moveNumber !== before.moveNumber + 1) return;
    if (board.lastMove === PASS) {
      sounds.pass();
      return;
    }
    sounds.stone();
    const captured = board.captures[1] + board.captures[2] - before.captures[1] - before.captures[2];
    if (captured > 0) sounds.capture(captured);
  }, [board]);

  useEffect(() => {
    const over = outcome !== null;
    if (over && !wasOver.current) {
      if (myColor === null || outcome.winner === null) sounds.end('neutral');
      else sounds.end(outcome.winner === myColor ? 'win' : 'loss');
    }
    wasOver.current = over;
  }, [outcome, myColor]);
}

export function useMuted(): [boolean, (muted: boolean) => void] {
  const [muted, set] = useState(isMuted);
  useEffect(() => onMutedChange(set), []);
  return [muted, setMuted];
}
