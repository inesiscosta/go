/**
 * Go bot: Monte Carlo Tree Search with RAVE and heuristic priors.
 *
 * Each iteration walks down the search tree, then finishes the game with a
 * fast semi-random "playout" and records who won. Moves that win more often
 * get explored more. RAVE (all-moves-as-first) lets one playout inform every
 * move played anywhere in it, which makes the search learn quickly.
 *
 * Priors give new moves a head start (or a handicap) based on Go knowledge:
 * captures, saving groups in atari, playing near the last move, avoiding
 * self-atari and the first line in open areas.
 *
 * Inspired by Petr Baudiš's "michi" (a minimal MCTS Go engine in Python).
 */

import { BLACK, Board, EDGE, EMPTY, PASS, type Stone, WHITE, opponent } from '../engine/board';

const RAVE_EQUIV = 3500;
const EXPAND_VISITS = 8;
const PRIOR_EVEN = 10; // every move starts at 5 wins / 10 visits
const PRIOR_SELFATARI = 10;
const PRIOR_CAPTURE_ONE = 15;
const PRIOR_CAPTURE_MANY = 30;
const PRIOR_SAVE_ATARI = 20;
const PRIOR_NEAR_LAST = 10;
const PRIOR_EMPTY_AREA = 10;

interface Node {
  move: number;
  /** The player who made `move`; win counts are from their point of view. */
  player: Stone;
  children: Node[] | null;
  n: number; // visits (including prior)
  w: number; // wins (including prior)
  real: number; // real visits, for the expansion threshold
  rn: number; // RAVE visits
  rw: number; // RAVE wins
}

export interface SearchResult {
  move: number;
  /** Estimated chance that the bot wins, 0..1. */
  winrate: number;
  playouts: number;
}

export interface SearchOptions {
  timeMs: number;
  komi: number;
  /** Optional cap, mainly for tests. */
  maxPlayouts?: number;
  seed?: number;
}

let rngState = 0x9e3779b9;
const rand = (n: number): number => {
  rngState ^= rngState << 13;
  rngState ^= rngState >>> 17;
  rngState ^= rngState << 5;
  return (rngState >>> 0) % n;
};

/** p is a single-point eye of `color` (filling it would be pointless or worse). */
function isEye(b: Board, p: number, color: Stone): boolean {
  const cells = b.cells;
  for (let i = 0; i < 4; i++) {
    const c = cells[p + b.dirs[i]];
    if (c !== color && c !== EDGE) return false;
  }
  let enemy = 0;
  let edge = 0;
  for (let i = 0; i < 4; i++) {
    const c = cells[p + b.diags[i]];
    if (c === EDGE) edge = 1;
    else if (c !== color && c !== EMPTY) enemy++;
  }
  return enemy + edge < 2;
}

/** Size of the opponent stones a move at p would capture (0 if none). */
function captureSize(b: Board, p: number, color: Stone): number {
  const opp = opponent(color);
  let total = 0;
  for (let i = 0; i < 4; i++) {
    const q = p + b.dirs[i];
    if (b.cells[q] === opp && b.liberties(q, 2) === 1) {
      // Count each captured group once (neighbours may share a group).
      let dup = false;
      for (let j = 0; j < i; j++) {
        const r = p + b.dirs[j];
        if (b.cells[r] === opp && b.group(r).includes(q)) dup = true;
      }
      if (!dup) total += b.group(q).length;
    }
  }
  return total;
}

/** Liberties the stone at p would have after a non-capturing move (capped at 3). */
function libertiesAfter(b: Board, p: number, color: Stone): number {
  b.cells[p] = color;
  const libs = b.liberties(p, 3);
  b.cells[p] = EMPTY;
  return libs;
}

/** Puts the player's own group into atari without capturing anything. */
function isSelfAtari(b: Board, p: number, color: Stone): boolean {
  let empties = 0;
  for (let i = 0; i < 4; i++) if (b.cells[p + b.dirs[i]] === EMPTY) empties++;
  if (empties >= 2) return false; // fast path
  if (captureSize(b, p, color) > 0) return false;
  return libertiesAfter(b, p, color) <= 1;
}

/**
 * Tactical reply to the last move: capture the stone just played if it is in
 * atari, or rescue one of our groups it put in atari.
 */
function tacticalMove(b: Board): number {
  const last = b.lastMove;
  if (last === PASS) return PASS;
  const color = b.toPlay;
  if (b.cells[last] === opponent(color) && b.liberties(last, 2) === 1) {
    const lib = b.findLiberty(last);
    if (b.isLegal(lib)) return lib;
  }
  for (let i = 0; i < 4; i++) {
    const q = last + b.dirs[i];
    if (b.cells[q] === color && b.liberties(q, 2) === 1) {
      const lib = b.findLiberty(q);
      if (b.isLegal(lib) && libertiesAfter(b, lib, color) >= 2) return lib;
    }
  }
  return PASS;
}

// Empty points of the playout board, kept up to date between moves.
// `slot[p]` is p's index in `empties`.
const empties = new Int32Array(21 * 21);
const slot = new Int32Array(21 * 21);
let numEmpty = 0;

function rebuildEmpties(b: Board): void {
  numEmpty = 0;
  const cells = b.cells;
  for (let p = b.W + 1, end = cells.length - b.W - 1; p < end; p++)
    if (cells[p] === EMPTY) {
      slot[p] = numEmpty;
      empties[numEmpty++] = p;
    }
}

function swapEmpties(i: number, j: number): void {
  const a = empties[i];
  const c = empties[j];
  empties[i] = c;
  empties[j] = a;
  slot[c] = i;
  slot[a] = j;
}

function playoutMove(b: Board): number {
  const t = tacticalMove(b);
  if (t !== PASS) return t;

  // Sample random empty points; rejected ones are swapped past the end of
  // the live range, so the set of empties itself never changes here.
  const color = b.toPlay;
  let n = numEmpty;
  while (n > 0) {
    const i = rand(n);
    const p = empties[i];
    if (b.isLegal(p) && !isEye(b, p, color) && !isSelfAtari(b, p, color)) return p;
    swapEmpties(i, --n);
  }
  return PASS;
}

/** Plays the game out, recording the first player to play each point (for RAVE). */
function playout(b: Board, amaf: Uint8Array): void {
  const limit = b.size * b.size * 3;
  rebuildEmpties(b);
  for (let i = 0; i < limit && b.passes < 2; i++) {
    const p = playoutMove(b);
    if (p === PASS) {
      b.pass();
      continue;
    }
    const color = b.toPlay;
    if (amaf[p] === 0) amaf[p] = color;
    const before = b.captures[color];
    b.playUnchecked(p);
    if (b.captures[color] !== before) rebuildEmpties(b);
    else swapEmpties(slot[p], --numEmpty);
  }
}

/** Quick area count at the end of a playout, where nearly all empty points are eyes. */
function playoutWinner(b: Board, komi: number): Stone {
  const cells = b.cells;
  let score = -komi; // black minus white
  for (let p = b.W + 1, end = cells.length - b.W - 1; p < end; p++) {
    const c = cells[p];
    if (c === BLACK) score++;
    else if (c === WHITE) score--;
    else if (c === EMPTY) {
      let owner = 0;
      for (let i = 0; i < 4; i++) {
        const nc = cells[p + b.dirs[i]];
        if (nc === BLACK || nc === WHITE) owner |= nc;
      }
      if (owner === BLACK) score++;
      else if (owner === WHITE) score--;
    }
  }
  return score > 0 ? BLACK : WHITE;
}

function newNode(move: number, player: Stone, priorN: number, priorW: number): Node {
  return { move, player, children: null, n: priorN, w: priorW, real: 0, rn: 0, rw: 0 };
}

function expand(node: Node, b: Board): void {
  const color = b.toPlay;
  const children: Node[] = [];
  const last = b.lastMove;
  const [lx, ly] = last === PASS ? [-99, -99] : b.xy(last);

  // Groups of ours currently in atari: their liberty is an escape candidate.
  const rescue = new Set<number>();
  for (const p of b.points())
    if (b.cells[p] === color && b.liberties(p, 2) === 1) rescue.add(b.findLiberty(p));

  for (const p of b.points()) {
    if (!b.isLegal(p) || isEye(b, p, color)) continue;
    let n = PRIOR_EVEN;
    let w = PRIOR_EVEN / 2;

    const cap = captureSize(b, p, color);
    if (cap === 1) {
      n += PRIOR_CAPTURE_ONE;
      w += PRIOR_CAPTURE_ONE;
    } else if (cap > 1) {
      n += PRIOR_CAPTURE_MANY;
      w += PRIOR_CAPTURE_MANY;
    }
    if (cap === 0 && libertiesAfter(b, p, color) <= 1) n += PRIOR_SELFATARI;
    if (rescue.has(p) && libertiesAfter(b, p, color) >= 2) {
      n += PRIOR_SAVE_ATARI;
      w += PRIOR_SAVE_ATARI;
    }

    const [x, y] = b.xy(p);
    if (Math.abs(x - lx) + Math.abs(y - ly) <= 2) {
      n += PRIOR_NEAR_LAST;
      w += PRIOR_NEAR_LAST;
    }

    // In open areas, the first two lines are slow and the third line is good.
    if (isOpenArea(b, x, y)) {
      const line = Math.min(x, y, b.size - 1 - x, b.size - 1 - y);
      if (line <= 1) n += PRIOR_EMPTY_AREA;
      else if (line === 2) {
        n += PRIOR_EMPTY_AREA;
        w += PRIOR_EMPTY_AREA;
      }
    }

    children.push(newNode(p, color, n, w));
  }
  if (children.length === 0) children.push(newNode(PASS, color, PRIOR_EVEN, PRIOR_EVEN / 2));
  node.children = children;
}

function isOpenArea(b: Board, x: number, y: number): boolean {
  for (let dy = -3; dy <= 3; dy++)
    for (let dx = -3; dx <= 3; dx++) {
      if (Math.abs(dx) + Math.abs(dy) > 3) continue;
      const xx = x + dx;
      const yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= b.size || yy >= b.size) continue;
      if (b.cells[b.idx(xx, yy)] !== EMPTY) return false;
    }
  return true;
}

/** Blend of real win rate and RAVE win rate (no explicit exploration term; priors do that). */
function urgency(c: Node): number {
  const winrate = c.w / c.n;
  if (c.rn === 0) return winrate;
  const beta = c.rn / (c.rn + c.n + (c.rn * c.n) / RAVE_EQUIV);
  return beta * (c.rw / c.rn) + (1 - beta) * winrate;
}

function selectChild(node: Node): Node {
  const kids = node.children!;
  let best = kids[0];
  let bestU = -1;
  for (let i = 0; i < kids.length; i++) {
    const u = urgency(kids[i]);
    if (u > bestU) {
      bestU = u;
      best = kids[i];
    }
  }
  return best;
}

export function search(root: Board, opts: SearchOptions): SearchResult {
  if (opts.seed !== undefined) rngState = opts.seed || 1;
  const tree = newNode(PASS, opponent(root.toPlay), 0, 0);
  expand(tree, root);

  const deadline = performance.now() + opts.timeMs;
  const max = opts.maxPlayouts ?? Infinity;
  const path: Node[] = [];
  const amaf = new Uint8Array(root.cells.length);
  let playouts = 0;

  while (playouts < max && (playouts < 50 || performance.now() < deadline)) {
    const b = root.clone();
    amaf.fill(0);
    path.length = 0;
    let node = tree;
    path.push(node);

    // Selection, expanding nodes that have been visited enough.
    while (!b.isOver) {
      if (node.children === null) {
        if (node.real < EXPAND_VISITS) break;
        expand(node, b);
      }
      node = selectChild(node);
      path.push(node);
      if (node.move === PASS) b.pass();
      else {
        if (amaf[node.move] === 0) amaf[node.move] = b.toPlay;
        b.playUnchecked(node.move);
      }
    }

    playout(b, amaf);
    const winner = playoutWinner(b, opts.komi);
    playouts++;

    for (const nd of path) {
      nd.n++;
      nd.real++;
      if (winner === nd.player) nd.w++;
      if (nd.children)
        for (const c of nd.children)
          if (c.move !== PASS && amaf[c.move] === c.player) {
            c.rn++;
            if (winner === c.player) c.rw++;
          }
    }
  }

  let best = tree.children![0];
  for (const c of tree.children!) if (c.real > best.real) best = c;
  return { move: best.move, winrate: best.w / best.n, playouts };
}

/** Points the given colour would get if the game ended now (area scoring, plus komi for white). */
function leadAsIs(b: Board, color: Stone, komi: number): number {
  const { black, white } = b.score();
  const diff = black - white - komi;
  return color === BLACK ? diff : -diff;
}

/**
 * Picks the bot's move, including when to pass:
 *  - the opponent passed and we are already ahead → pass and end the game
 *  - the opponent passed and we are clearly lost → pass too
 *  - no sensible moves are left (only our own eyes) → pass
 * Filling our own territory costs nothing under area scoring, so the bot
 * never passes first while there is still something to play.
 */
export function chooseMove(b: Board, opts: SearchOptions): SearchResult {
  const color = b.toPlay;
  const lead = leadAsIs(b, color, opts.komi);
  if (b.lastMove === PASS && b.moveNumber > 0 && lead > 0)
    return { move: PASS, winrate: 1, playouts: 0 };

  const result = search(b, opts);
  if (result.move === PASS) return result;
  if (b.lastMove === PASS && b.moveNumber > 0 && result.winrate < 0.15)
    return { ...result, move: PASS };
  return result;
}
