import { describe, expect, it } from 'vitest';
import { BLACK, Board, PASS, WHITE } from './board';
import fixtures from './fixtures.json';

/** The original Python game labels columns A, B, C, … without skipping I. */
const toOriginal = (b: Board, p: number) => {
  if (p === PASS) return 'P';
  const [x, y] = b.xy(p);
  return String.fromCharCode(65 + x) + (y + 1);
};
const fromOriginal = (b: Board, s: string) =>
  s === 'P' ? PASS : b.idx(s.charCodeAt(0) - 65, Number(s.slice(1)) - 1);

type Step = { legal: string[]; move: string; board: string; score: [number, number] };
type Game = { size: number; steps: Step[] };

describe('agrees with the original Python engine', () => {
  (fixtures.games as Game[]).forEach((game, i) => {
    it(`reference game ${i + 1} (${game.size}×${game.size}, ${game.steps.length} moves)`, () => {
      const b = new Board(game.size);
      game.steps.forEach((step, n) => {
        const legal = b.legalMoves().map((p) => toOriginal(b, p)).sort();
        expect(legal, `legal moves before move ${n + 1}`).toEqual(step.legal);
        b.play(fromOriginal(b, step.move));
        expect(b.serialize(), `board after move ${n + 1} (${step.move})`).toBe(step.board);
        const { black, white } = b.score();
        expect([black, white], `score after move ${n + 1}`).toEqual(step.score);
      });
    });
  });

  it('the reference games exercise ko', () => {
    // At least one position where an empty point is illegal and it is not suicide.
    let koPositions = 0;
    for (const game of fixtures.games as Game[]) {
      const b = new Board(game.size);
      for (const step of game.steps) {
        if (b.koPoint !== -1) koPositions++;
        b.play(fromOriginal(b, step.move));
      }
    }
    expect(koPositions).toBeGreaterThan(0);
  });
});

/** Builds a board from rows written top (highest row) to bottom. */
function setup(rows: string[], toPlay = BLACK): Board {
  const b = new Board(9);
  const n = rows.length;
  rows.forEach((row, i) =>
    [...row.replace(/ /g, '')].forEach((ch, x) => {
      if (ch === 'X') b.cells[b.idx(x, n - 1 - i)] = BLACK;
      if (ch === 'O') b.cells[b.idx(x, n - 1 - i)] = WHITE;
    }),
  );
  b.toPlay = toPlay as 1 | 2;
  return b;
}

describe('rules', () => {
  it('captures a surrounded stone', () => {
    const b = setup(['.X.', 'XO.', '.X.']); // rows 3..1
    b.play(b.point('C2'));
    expect(b.cells[b.point('B2')]).toBe(0);
    expect(b.captures[BLACK]).toBe(1);
  });

  it('forbids suicide', () => {
    const b = setup(['O.', '.O'], BLACK); // A1 is surrounded by white
    expect(b.isLegal(b.point('A1'))).toBe(false);
  });

  it('allows a surrounded move when it captures', () => {
    // C2 is surrounded by white, but it takes B2's last liberty.
    const b = setup(['.XO.', 'XO.O', '.XO.'], BLACK);
    expect(b.isLegal(b.point('C2'))).toBe(true);
  });

  it('applies the ko rule for one move only', () => {
    const b = setup(['.XO.', 'XO.O', '.XO.'], BLACK);
    b.play(b.point('C2')); // black captures B2
    expect(b.isLegal(b.point('B2'))).toBe(false); // white can't retake at once
    b.play(b.point('H8')); // ko threat elsewhere
    b.play(b.point('H7'));
    expect(b.isLegal(b.point('B2'))).toBe(true);
  });

  it('ends after two consecutive passes', () => {
    const b = new Board(9);
    b.play(PASS);
    expect(b.isOver).toBe(false);
    b.play(b.point('E5'));
    b.play(PASS);
    b.play(PASS);
    expect(b.isOver).toBe(true);
  });
});
