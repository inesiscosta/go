import { useEffect, useState, type ReactNode } from 'react';
import { BLACK, PASS, WHITE, type Stone } from '../engine/board';
import type { Clock, GameView } from '../game/types';
import { useGameSounds, useMuted } from '../game/useGameSounds';
import { GoBoard } from './GoBoard';

const colorName = (c: Stone) => (c === BLACK ? 'Black' : 'White');

function SoundIcon({ muted }: { muted: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" />
      {muted ? (
        <path d="M16 9.5l5 5m0-5l-5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      ) : (
        <path
          d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}

/** Time each player has spent on their own turns, in ms (index by Stone). */
function timeSpent(clock: Clock, now: number): [number, number, number] {
  const spent: [number, number, number] = [0, 0, 0];
  if (clock.start === null) return spent;
  let prev = clock.start;
  let toMove: Stone = BLACK;
  for (const t of clock.times) {
    spent[toMove] += Math.max(0, t - prev);
    prev = t;
    toMove = toMove === BLACK ? WHITE : BLACK;
  }
  spent[toMove] += Math.max(0, (clock.end ?? now) - prev);
  return spent;
}

function formatTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** The current time, updated twice a second while `running`. */
function useNow(running: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [running]);
  return running ? now : Date.now();
}

interface Props {
  game: GameView;
  komi: number;
  /** Short description shown at the top of the panel, e.g. "9×9 · medium · komi 7.5". */
  meta: string;
  onMenu: () => void;
  /** Buttons shown once the game is over (play again, rematch…). */
  endActions?: ReactNode;
  /** Extra buttons during the game (resign…). */
  extraActions?: ReactNode;
  /** Shown above the status (room code, invite link…). */
  header?: ReactNode;
}

export function GameScreen({ game, komi, meta, onMenu, endActions, extraActions, header }: Props) {
  const { board, myColor, scoring, outcome } = game;
  const [showTerritory, setShowTerritory] = useState(false);

  // Dead stones come off the board before counting: the ones being marked, or the ones agreed at the end.
  const dead = scoring?.dead ?? outcome?.dead;
  const score = dead ? board.scoreWithDead(dead) : board.score();
  const black = score.black;
  const white = score.white + komi;
  const over = outcome !== null;
  const showScore = showTerritory || !!scoring || (over && outcome.reason === 'score');
  useGameSounds(board, outcome, myColor);

  const clockRunning = game.clock.start !== null && game.clock.end === null && !over;
  const now = useNow(clockRunning);
  const spent = timeSpent(game.clock, now);
  const total = game.clock.start === null ? 0 : (game.clock.end ?? now) - game.clock.start;
  const [muted, setMuted] = useMuted();

  const who = (c: Stone) => (myColor === null ? colorName(c) : c === myColor ? 'You' : game.opponentName);

  let status: string;
  if (outcome) {
    if (outcome.winner === null) status = 'Draw';
    else {
      const w = who(outcome.winner);
      const verb = w === 'You' ? 'win' : 'wins';
      status =
        outcome.reason === 'resign'
          ? `${w} ${verb} by resignation`
          : `${w} ${verb} by ${Math.abs(outcome.black - outcome.white)}`;
    }
  } else if (scoring) status = 'Mark dead stones';
  else if (game.status) status = game.status;
  else if (game.thinking) status = `${game.opponentName} is thinking…`;
  else if (myColor !== null) status = game.isMyTurn ? 'Your move' : `${game.opponentName}'s move`;
  else status = `${colorName(board.toPlay)} to play`;

  const passedBy =
    board.lastMove === PASS && board.moveNumber > 0 ? (board.toPlay === BLACK ? WHITE : BLACK) : null;

  return (
    <main className="game">
      <div className="board-wrap">
        <GoBoard
          board={board}
          interactive={game.isMyTurn && !over}
          territory={showScore ? score.territory : null}
          onPlay={game.play}
          dead={dead}
          onMark={scoring?.toggle}
        />
      </div>

      <aside className="panel">
        <div className="panel-top">
          <button className="link" onClick={onMenu}>
            <span aria-hidden="true">←</span> Menu
          </button>
          <span className="meta">{meta}</span>
          <button
            className="icon-button"
            onClick={() => setMuted(!muted)}
            aria-pressed={!muted}
            aria-label={muted ? 'Turn sound on' : 'Turn sound off'}
            title={muted ? 'Sound off' : 'Sound on'}
          >
            <SoundIcon muted={muted} />
          </button>
        </div>

        {header}

        <div className="status-block">
          <p className="move-count">
            {board.moveNumber === 0 ? 'New game' : `Move ${board.moveNumber}`}
            {game.clock.start !== null && (
              <>
                {' · '}
                <span className="game-time" title="Game time">
                  {formatTime(total)}
                </span>
              </>
            )}
          </p>
          <h2 className={`status ${over ? 'over' : ''}`} aria-live="polite">
            {status}
          </h2>
        </div>
        {scoring && (
          <p className="hint">
            {scoring.toggle
              ? 'Both players passed. Click any group that could not survive to mark it dead (click again to bring it back). Dead stones count as captured. '
              : 'Both players passed and are marking dead stones. '}
            {scoring.accepted &&
              (scoring.accepted.me
                ? 'Waiting for your opponent to accept.'
                : scoring.accepted.them
                  ? 'Your opponent accepted these marks.'
                  : '')}
          </p>
        )}
        {passedBy && !over && !scoring && (
          <p className="hint">
            {who(passedBy)} passed. {game.isMyTurn || myColor === null ? 'Pass too to end the game.' : ''}
          </p>
        )}
        {game.error && (
          <p className="error" role="alert">
            {game.error}
          </p>
        )}

        <div className="players">
          {[BLACK, WHITE].map((c) => (
            <div key={c} className={`player ${!over && !scoring && board.toPlay === c ? 'to-play' : ''}`}>
              <span className={`swatch ${c === BLACK ? 'black' : 'white'}`} aria-hidden="true" />
              <div className="player-name">
                <strong>{myColor === null ? colorName(c as Stone) : who(c as Stone)}</strong>
                <span>
                  {myColor === null ? '' : `${colorName(c as Stone)} · `}
                  {showScore
                    ? `${c === BLACK ? black : white} points${c === WHITE && komi > 0 ? ` incl. ${komi} komi` : ''}`
                    : c === WHITE && komi > 0
                      ? `+${komi} komi`
                      : 'moves first'}
                </span>
              </div>
              <span
                className={`clock ${clockRunning && board.toPlay === c ? 'running' : ''}`}
                title="Time spent thinking"
                aria-label={`Time used: ${formatTime(spent[c])}`}
              >
                {formatTime(spent[c])}
              </span>
              {c !== myColor && myColor !== null && game.thinking ? (
                <span className="spinner" aria-label="Thinking" />
              ) : (
                <span className="captures" title="Stones captured">
                  <strong>{board.captures[c]}</strong>
                  <span>captured</span>
                </span>
              )}
            </div>
          ))}
        </div>

        {game.confidence !== null && !over && (
          <div className="estimate">
            <span>
              {game.opponentName}'s confidence <strong>{Math.round(game.confidence * 100)}%</strong>
            </span>
            <span className="meter" aria-hidden="true">
              <span style={{ width: `${Math.round(game.confidence * 100)}%` }} />
            </span>
          </div>
        )}

        <div className="actions">
          {scoring ? (
            <>
              {scoring.accept && (
                <button className="primary" onClick={scoring.accept}>
                  {scoring.accepted ? 'Accept score' : 'Done, count it'}
                </button>
              )}
              {game.undo && (
                <button onClick={game.undo} disabled={!game.canUndo}>
                  Undo
                </button>
              )}
              {extraActions}
            </>
          ) : !over ? (
            <>
              <button onClick={game.pass} disabled={!game.isMyTurn}>
                Pass
              </button>
              {game.undo && (
                <button onClick={game.undo} disabled={!game.canUndo}>
                  Undo
                </button>
              )}
              {extraActions}
            </>
          ) : (
            <>
              {endActions}
              {game.undo && (
                <button onClick={game.undo} disabled={!game.canUndo}>
                  Undo
                </button>
              )}
            </>
          )}
        </div>

        <label className="toggle">
          <input
            role="switch"
            type="checkbox"
            checked={showScore}
            disabled={over || !!scoring}
            onChange={(e) => setShowTerritory(e.target.checked)}
          />
          Show score if the game ended now
        </label>

        <details className="rules">
          <summary>How scoring works</summary>
          <p>
            Your score is your stones on the board plus the empty points only your stones surround
            (area scoring). Play ends when both players pass in a row. You then mark the stones
            that couldn't survive as dead: they're taken off and count for the side surrounding
            them, so you don't need to capture them before passing.
          </p>
        </details>
      </aside>
    </main>
  );
}
