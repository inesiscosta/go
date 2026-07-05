import { describe, expect, it } from 'vitest';
import { BLACK, Board, PASS, WHITE, type Stone } from '../engine/board';
import { chooseMove } from './mcts';

/** 9×9 board from rows written top (row 9) to bottom (row 1). */
function setup(rows: string[], toPlay: Stone, lastMove?: string): Board {
  const b = new Board(9);
  rows.forEach((row, i) =>
    [...row].forEach((ch, x) => {
      if (ch === 'X') b.cells[b.idx(x, 8 - i)] = BLACK;
      if (ch === 'O') b.cells[b.idx(x, 8 - i)] = WHITE;
    }),
  );
  b.toPlay = toPlay;
  b.moveNumber = 20;
  if (lastMove) b.lastMove = b.point(lastMove);
  return b;
}

const opts = { timeMs: 10_000, komi: 7.5, maxPlayouts: 1500, seed: 7 };

describe('bot', () => {
  it('captures a large group in atari', () => {
    // White's four stones on row 5 have one liberty left, at E5.
    const b = setup(
      [
        '.........',
        '.........',
        '.........',
        'XXXX.....',
        'OOOO.X...',
        'XXXX.....',
        '.........',
        '.........',
        '.........',
      ],
      BLACK,
    );
    expect(b.coord(chooseMove(b, opts).move)).toBe('E5');
  });

  it('rescues its own group from atari', () => {
    // White just played D6; Black's three stones on row 5 have one liberty, E5.
    const b = setup(
      [
        '.........',
        '.........',
        '.........',
        '.OOO.....',
        'OXXX.....',
        '.OOO.....',
        '.........',
        '.........',
        '.........',
      ],
      BLACK,
      'D6',
    );
    expect(b.coord(chooseMove(b, opts).move)).toBe('E5');
  });

  it('beats a random player', () => {
    for (const botColor of [BLACK, WHITE] as Stone[]) {
      const b = new Board(9);
      while (!b.isOver && b.moveNumber < 243) {
        if (b.toPlay === botColor) b.play(chooseMove(b, { ...opts, maxPlayouts: 300 }).move);
        else {
          const moves = b.legalMoves();
          b.play(moves.length ? moves[(b.moveNumber * 7919) % moves.length] : PASS);
        }
      }
      const { black, white } = b.score();
      const blackWins = black - white - 7.5 > 0;
      expect(blackWins).toBe(botColor === BLACK);
    }
  }, 30_000);
});
