/**
 * Bot benchmark: playout speed and head-to-head results.
 *   npx vite-node scripts/bench.ts
 */
import { BLACK, Board, PASS, type Stone } from '../src/engine/board';
import { chooseMove, search } from '../src/bot/mcts';

const KOMI = 7.5;

function speed(size: number) {
  const b = new Board(size);
  const t = performance.now();
  const r = search(b, { timeMs: 2000, komi: KOMI });
  const s = (performance.now() - t) / 1000;
  console.log(`${size}×${size}: ${Math.round(r.playouts / s)} playouts/s`);
}

type Player = (b: Board) => number;

const randomPlayer: Player = (b) => {
  const moves = b.legalMoves();
  return moves.length ? moves[Math.floor(Math.random() * moves.length)] : PASS;
};
const bot =
  (timeMs: number): Player =>
  (b) =>
    chooseMove(b, { timeMs, komi: KOMI }).move;

function game(black: Player, white: Player, size = 9): Stone {
  const b = new Board(size);
  while (!b.isOver && b.moveNumber < size * size * 3) b.play((b.toPlay === BLACK ? black : white)(b));
  const { black: bs, white: ws } = b.score();
  return bs - ws - KOMI > 0 ? 1 : 2;
}

function match(name: string, a: Player, c: Player, games: number) {
  let aWins = 0;
  for (let i = 0; i < games; i++) {
    const aIsBlack = i % 2 === 0;
    const winner = aIsBlack ? game(a, c) : game(c, a);
    if ((winner === BLACK) === aIsBlack) aWins++;
  }
  console.log(`${name}: ${aWins}/${games}`);
}

speed(9);
speed(13);
speed(19);
match('bot 0.3s vs random', bot(300), randomPlayer, 6);
match('bot 1s vs bot 0.1s', bot(1000), bot(100), 6);
