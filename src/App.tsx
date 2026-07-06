import { useEffect, useState, type FormEvent } from 'react';
import { BLACK, WHITE, type Stone } from './engine/board';
import { LocalGame } from './components/LocalGame';
import { OnlineGame } from './components/OnlineGame';
import type { Level, Mode, Settings } from './game/useGame';
import { normalizeCode } from './online/protocol';
import { createRoom } from './online/useOnlineGame';

/** The room in the address bar (?room=K7MP2Q), so invite links and refreshes work. */
function roomFromUrl(): string | null {
  const raw = new URLSearchParams(location.search).get('room');
  return raw ? normalizeCode(raw) : null;
}

function goToRoom(code: string | null) {
  history.pushState(null, '', code ? `/?room=${code}` : '/');
}

type ColorChoice = 'black' | 'white' | 'random';

function ModeIcon({ kind }: { kind: 'bot' | 'local' | 'online' }) {
  return (
    <span className="mode-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        {kind === 'bot' && (
          <>
            <rect x="5" y="5" width="14" height="14" rx="2.5" />
            <rect x="9.5" y="9.5" width="5" height="5" rx="1" />
            <path d="M9.5 2.5v2.5M14.5 2.5v2.5M9.5 19v2.5M14.5 19v2.5M2.5 9.5H5M2.5 14.5H5M19 9.5h2.5M19 14.5h2.5" />
          </>
        )}
        {kind === 'local' && (
          <>
            <circle cx="9" cy="8" r="3.25" />
            <path d="M3 19.5c0-3.3 2.7-5.75 6-5.75s6 2.45 6 5.75" />
            <path d="M15.5 4.9a3.25 3.25 0 0 1 0 6.2M17.5 14c2 .7 3.5 2.8 3.5 5.5" />
          </>
        )}
        {kind === 'online' && (
          <>
            <circle cx="12" cy="12" r="9" />
            <path d="M3 12h18M12 3c2.4 2.5 3.6 5.5 3.6 9s-1.2 6.5-3.6 9c-2.4-2.5-3.6-5.5-3.6-9S9.6 5.5 12 3z" />
          </>
        )}
      </svg>
    </span>
  );
}

function Segmented<T extends string | number>({
  label,
  value,
  options,
  onChange,
  disabled = false,
  note,
}: {
  label: string;
  value: T;
  options: { value: T; label: string; hint?: string }[];
  onChange: (v: T) => void;
  /** Kept on screen but greyed out, so the menu doesn't change size between modes. */
  disabled?: boolean;
  /** A short line under the label, e.g. why the row is disabled. */
  note?: string;
}) {
  return (
    <fieldset className={disabled ? 'field disabled' : 'field'} disabled={disabled}>
      <legend>
        {label}
        {note && <span className="field-note">{note}</span>}
      </legend>
      <div className="segmented">
        {options.map((o) => (
          <label key={o.value} className={o.value === value ? 'selected' : ''} title={o.hint}>
            <input
              type="radio"
              name={label}
              value={String(o.value)}
              checked={o.value === value}
              onChange={() => onChange(o.value)}
            />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export default function App() {
  const [mode, setMode] = useState<Mode | 'online'>('bot');
  const [room, setRoom] = useState<string | null>(roomFromUrl);
  const [joinCode, setJoinCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [menuError, setMenuError] = useState<string | null>(null);

  useEffect(() => {
    const onPop = () => setRoom(roomFromUrl());
    addEventListener('popstate', onPop);
    return () => removeEventListener('popstate', onPop);
  }, []);
  const [size, setSize] = useState<9 | 13 | 19>(9);
  const [level, setLevel] = useState<Level>('medium');
  const [color, setColor] = useState<ColorChoice>('black');
  const [komi, setKomi] = useState(7.5);
  const [game, setGame] = useState<{ settings: Settings; key: number } | null>(null);

  async function start() {
    setMenuError(null);
    if (mode === 'online') {
      setBusy(true);
      try {
        const created = await createRoom({ size, komi, color });
        goToRoom(created.code);
        setRoom(created.code);
      } catch {
        setMenuError("Couldn't create a room. Check your connection and try again.");
      } finally {
        setBusy(false);
      }
      return;
    }
    const humanColor: Stone =
      color === 'random' ? (Math.random() < 0.5 ? BLACK : WHITE) : color === 'black' ? BLACK : WHITE;
    setGame({ settings: { mode, size, level, komi, humanColor }, key: Date.now() });
  }

  function join(e: FormEvent) {
    e.preventDefault();
    const code = normalizeCode(joinCode);
    if (!code) {
      setMenuError('Room codes are 6 letters and numbers, like K7MP2Q.');
      return;
    }
    goToRoom(code);
    setRoom(code);
  }

  if (room)
    return (
      <OnlineGame
        key={room}
        code={room}
        onMenu={() => {
          goToRoom(null);
          setRoom(null);
        }}
      />
    );

  if (game)
    return (
      <LocalGame
        key={game.key}
        settings={game.settings}
        onRestart={start}
        onMenu={() => setGame(null)}
      />
    );

  return (
    <main className="menu">
      <header className="menu-header">
        <h1>
          <span className="logo" aria-hidden="true">
            <span />
            <span />
          </span>
          Go
        </h1>
        <p>The ancient game of surrounding territory. Play the computer, a friend on this screen, or a friend anywhere.</p>
      </header>

      <div className="modes" role="radiogroup" aria-label="Game mode">
        <button
          role="radio"
          aria-checked={mode === 'bot'}
          className={mode === 'bot' ? 'mode selected' : 'mode'}
          onClick={() => setMode('bot')}
        >
          <ModeIcon kind="bot" />
          <strong>vs Computer</strong>
          <span>A Monte Carlo Tree Search bot that runs in your browser</span>
        </button>
        <button
          role="radio"
          aria-checked={mode === 'local'}
          className={mode === 'local' ? 'mode selected' : 'mode'}
          onClick={() => setMode('local')}
        >
          <ModeIcon kind="local" />
          <strong>Two players</strong>
          <span>Take turns on this device</span>
        </button>
        <button
          role="radio"
          aria-checked={mode === 'online'}
          className={mode === 'online' ? 'mode selected' : 'mode'}
          onClick={() => setMode('online')}
        >
          <ModeIcon kind="online" />
          <strong>Online</strong>
          <span>Invite a friend with a link or room code</span>
        </button>
      </div>

      <div className="options card">
        <Segmented
          label="Board"
          value={size}
          onChange={setSize}
          options={[
            { value: 9, label: '9×9' },
            { value: 13, label: '13×13' },
            { value: 19, label: '19×19' },
          ]}
        />
        <Segmented
          label="Difficulty"
          value={level}
          onChange={setLevel}
          disabled={mode !== 'bot'}
          note={
            mode !== 'bot'
              ? 'Only against the computer'
              : size === 19
                ? 'The bot is strongest on 9×9'
                : undefined
          }
          options={[
            { value: 'easy', label: 'Easy' },
            { value: 'medium', label: 'Medium' },
            { value: 'hard', label: 'Hard' },
          ]}
        />
        <Segmented
          label="You play"
          value={color}
          onChange={setColor}
          disabled={mode === 'local'}
          note={mode === 'local' ? 'You take turns with both colours' : undefined}
          options={[
            { value: 'black', label: 'Black', hint: 'Black moves first' },
            { value: 'white', label: 'White' },
            { value: 'random', label: 'Random' },
          ]}
        />
        <Segmented
          label="Komi"
          value={komi}
          onChange={setKomi}
          options={[
            { value: 7.5, label: '7.5', hint: 'Standard compensation for White moving second' },
            { value: 0.5, label: '0.5' },
            { value: 0, label: 'None', hint: 'As in the original coursework game' },
          ]}
        />
      </div>


      <button className="primary start" onClick={start} disabled={busy}>
        {mode === 'online' ? (busy ? 'Creating room…' : 'Create room') : 'Start game'}
      </button>

      {/* Always rendered (hidden outside online mode) so the menu keeps its size. */}
      <form className={mode === 'online' ? 'join' : 'join hidden'} onSubmit={join} inert={mode !== 'online'}>
          <span className="or" aria-hidden="true">or</span>
          <label htmlFor="join-code">Join a room with a code</label>
          <div>
            <input
              id="join-code"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value)}
              placeholder="K7MP2Q"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={12}
            />
            <button type="submit">Join</button>
          </div>
      </form>

      {menuError && (
        <p className="error" role="alert">
          {menuError}
        </p>
      )}

      <footer className="menu-footer">
        <p>Started life as a text-based Python game for a first-year programming course.</p>
        <p className="footer-links">
          <a href="https://github.com/inesiscosta/Go/tree/original">See the original</a>
          <span aria-hidden="true">·</span>
          <a href="https://github.com/inesiscosta/Go">Source</a>
        </p>
      </footer>
    </main>
  );
}
