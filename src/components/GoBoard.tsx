import { useMemo, useState, type KeyboardEvent } from 'react';
import { BLACK, Board, COLUMNS, EMPTY, PASS, WHITE } from '../engine/board';

const CELL = 10;
const MARGIN = 14;

const STAR_POINTS: Record<number, number[]> = {
  9: [2, 4, 6],
  13: [3, 6, 9],
  19: [3, 9, 15],
};

interface Props {
  board: Board;
  interactive: boolean;
  /** Owner of each point (BLACK, WHITE or 0), to draw as territory; null hides it. */
  territory: Uint8Array | null;
  onPlay: (p: number) => void;
  /** Stones marked dead, drawn faded with a cross. */
  dead?: ReadonlySet<number>;
  /** Marking mode (after both pass): clicking a stone calls this instead of playing. */
  onMark?: (p: number) => void;
}

export function GoBoard({ board, interactive, territory, onPlay, dead, onMark }: Props) {
  const n = board.size;
  const span = (n - 1) * CELL;
  const total = span + MARGIN * 2;
  const [hover, setHover] = useState<number | null>(null);
  const [cursor, setCursor] = useState<[number, number]>([Math.floor(n / 2), Math.floor(n / 2)]);
  const [keyboard, setKeyboard] = useState(false);

  // SVG y grows downwards; row 1 sits at the bottom like a real board.
  const px = (x: number) => MARGIN + x * CELL;
  const py = (y: number) => MARGIN + (n - 1 - y) * CELL;

  const marking = !!onMark;
  // While marking, the clickable points are the stones; otherwise the legal moves.
  const legal = useMemo(
    () =>
      new Set(
        marking ? board.points().filter((p) => board.cells[p] !== EMPTY) : interactive ? board.legalMoves() : [],
      ),
    [board, interactive, marking],
  );
  const clickable = interactive || marking;
  const choose = (p: number) => {
    if (!legal.has(p)) return;
    if (onMark) onMark(p);
    else onPlay(p);
  };

  const cursorPoint = board.idx(cursor[0], cursor[1]);
  const ghost = keyboard ? cursorPoint : hover;
  const columns = COLUMNS.slice(0, n).split('');

  function onKeyDown(e: KeyboardEvent) {
    const moves: Record<string, [number, number]> = {
      ArrowUp: [0, 1],
      ArrowDown: [0, -1],
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
    };
    if (e.key in moves) {
      e.preventDefault();
      const [dx, dy] = moves[e.key];
      setKeyboard(true);
      setCursor(([x, y]) => [Math.min(n - 1, Math.max(0, x + dx)), Math.min(n - 1, Math.max(0, y + dy))]);
    } else if ((e.key === 'Enter' || e.key === ' ') && clickable) {
      e.preventDefault();
      setKeyboard(true);
      choose(cursorPoint);
    }
  }

  const label = marking
    ? `${n} by ${n} Go board, marking dead stones. ${dead?.size ?? 0} marked. Use arrow keys to choose a stone and Enter to mark or unmark its group.`
    : `${n} by ${n} Go board. ${board.toPlay === BLACK ? 'Black' : 'White'} to play. ${
        board.lastMove === PASS ? '' : `Last move ${board.coord(board.lastMove)}.`
      } Use arrow keys to choose a point and Enter to play.`;

  return (
    <svg
      className={`board${keyboard ? ' keyboard' : ''}${marking ? ' marking' : ''}`}
      viewBox={`0 0 ${total} ${total}`}
      role="application"
      aria-label={label}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onBlur={() => setKeyboard(false)}
      onPointerLeave={() => setHover(null)}
    >
      <defs>
        <radialGradient id="stone-black" cx="35%" cy="30%" r="70%">
          <stop offset="0%" stopColor="#5b5b5b" />
          <stop offset="100%" stopColor="#0d0d0d" />
        </radialGradient>
        <radialGradient id="stone-white" cx="35%" cy="30%" r="75%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#c9c4ba" />
        </radialGradient>
        <filter id="stone-shadow" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0.5" dy="0.7" stdDeviation="0.5" floodOpacity="0.35" />
        </filter>
      </defs>

      <rect className="board-wood" x="0" y="0" width={total} height={total} />

      {columns.map((_, i) => (
        <g key={i} className="grid">
          <line x1={px(i)} y1={py(0)} x2={px(i)} y2={py(n - 1)} />
          <line x1={px(0)} y1={py(i)} x2={px(n - 1)} y2={py(i)} />
        </g>
      ))}
      {STAR_POINTS[n].flatMap((x) =>
        STAR_POINTS[n].map((y) =>
          n === 9 && (x === 4) !== (y === 4) ? null : (
            <circle key={`${x}-${y}`} className="star" cx={px(x)} cy={py(y)} r="1" />
          ),
        ),
      )}

      {columns.map((c, i) => (
        <g key={c} className="coord" aria-hidden="true">
          <text x={px(i)} y={MARGIN / 2 + 1.5}>{c}</text>
          <text x={px(i)} y={total - MARGIN / 2 + 1.5}>{c}</text>
          <text x={MARGIN / 2 - 1} y={py(i) + 1.5}>{i + 1}</text>
          <text x={total - MARGIN / 2 + 1} y={py(i) + 1.5}>{i + 1}</text>
        </g>
      ))}

      {territory &&
        board.points().map((p) => {
          const owner = territory[p];
          if (!owner) return null;
          const [x, y] = board.xy(p);
          return (
            <rect
              key={`t${p}`}
              className={owner === BLACK ? 'territory-black' : 'territory-white'}
              x={px(x) - 2}
              y={py(y) - 2}
              width="4"
              height="4"
            />
          );
        })}

      {board.points().map((p) => {
        const c = board.cells[p];
        if (c === EMPTY) return null;
        const [x, y] = board.xy(p);
        const isDead = dead?.has(p) ?? false;
        const r = CELL * 0.48;
        return (
          <g key={`s${p}`} className={isDead ? 'stone dead' : 'stone'}>
            <circle
              cx={px(x)}
              cy={py(y)}
              r={r}
              fill={c === BLACK ? 'url(#stone-black)' : 'url(#stone-white)'}
              filter={isDead ? undefined : 'url(#stone-shadow)'}
            />
            {isDead && (
              <path
                className={c === BLACK ? 'dead-mark on-black' : 'dead-mark on-white'}
                d={`M${px(x) - r * 0.45} ${py(y) - r * 0.45}l${r * 0.9} ${r * 0.9}m0 ${-r * 0.9}l${-r * 0.9} ${r * 0.9}`}
              />
            )}
          </g>
        );
      })}

      {!marking && board.lastMove !== PASS && board.cells[board.lastMove] !== EMPTY && (() => {
        const [x, y] = board.xy(board.lastMove);
        return (
          <circle
            className={board.cells[board.lastMove] === BLACK ? 'last-on-black' : 'last-on-white'}
            cx={px(x)}
            cy={py(y)}
            r={CELL * 0.2}
          />
        );
      })()}

      {interactive && ghost !== null && legal.has(ghost) && (() => {
        const [x, y] = board.xy(ghost);
        return (
          <circle
            className="ghost"
            cx={px(x)}
            cy={py(y)}
            r={CELL * 0.48}
            fill={board.toPlay === WHITE ? '#fff' : '#111'}
          />
        );
      })()}
      {keyboard && (
        <rect
          className="cursor"
          x={px(cursor[0]) - CELL / 2}
          y={py(cursor[1]) - CELL / 2}
          width={CELL}
          height={CELL}
          rx="1.5"
        />
      )}

      {clickable &&
        board.points().map((p) => {
          const [x, y] = board.xy(p);
          return (
            <rect
              key={`h${p}`}
              className={legal.has(p) ? 'hit' : 'hit hit-disabled'}
              x={px(x) - CELL / 2}
              y={py(y) - CELL / 2}
              width={CELL}
              height={CELL}
              onPointerEnter={() => {
                setKeyboard(false);
                setHover(p);
              }}
              onClick={() => choose(p)}
            />
          );
        })}
    </svg>
  );
}
