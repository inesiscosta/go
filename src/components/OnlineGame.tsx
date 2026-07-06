import { useEffect, useState } from 'react';
import { useOnlineGame } from '../online/useOnlineGame';
import { GameScreen } from './GameScreen';

interface Props {
  code: string;
  onMenu: () => void;
}

function InviteBox({ code }: { code: string }) {
  const link = `${location.origin}/?room=${code}`;
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  }

  return (
    <div className="invite">
      <p className="invite-title">Invite a friend</p>
      <p className="invite-code" aria-label={`Room code ${code.split('').join(' ')}`}>
        {code}
      </p>
      <div className="invite-link">
        <input readOnly value={link} aria-label="Invite link" onFocus={(e) => e.target.select()} />
        <button onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
      </div>
      <p className="hint">Send them the link, or the code to enter under “Join a room”. Waiting for them to join…</p>
    </div>
  );
}

/** Two-step resign so a misclick doesn't end the game (no browser dialogs). */
function ResignButton({ onResign }: { onResign: () => void }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button className={armed ? 'danger' : ''} onClick={() => (armed ? onResign() : setArmed(true))}>
      {armed ? 'Confirm resign' : 'Resign'}
    </button>
  );
}

export function OnlineGame({ code, onMenu }: Props) {
  const { view, state, connection, color, resign, rematch } = useOnlineGame(code);

  if (connection === 'not-found')
    return (
      <main className="center-message">
        <h2>Room {code} doesn't exist</h2>
        <p>It may have expired: rooms are removed after a week without activity.</p>
        <button className="primary" onClick={onMenu}>
          Back to menu
        </button>
      </main>
    );

  if (connection === 'full')
    return (
      <main className="center-message">
        <h2>Room {code} is full</h2>
        <p>Too many people are connected to this game right now. Try again in a little while.</p>
        <button className="primary" onClick={onMenu}>
          Back to menu
        </button>
      </main>
    );

  if (!view || !state || color === undefined)
    return (
      <main className="center-message">
        <span className="spinner" aria-hidden="true" />
        <p>{connection === 'reconnecting' ? 'Reconnecting…' : `Joining room ${code}…`}</p>
      </main>
    );

  const opponent = color === null ? null : color === 'black' ? 'white' : 'black';
  const opponentPresence = opponent ? state.players[opponent] : null;

  const header = (
    <>
      {connection === 'reconnecting' && (
        <p className="banner" role="status">
          Connection lost. Reconnecting…
        </p>
      )}
      {opponentPresence === 'empty' ? (
        <InviteBox code={code} />
      ) : (
        <p className="room-line">
          Room <strong>{code}</strong>
          {color === null && ' · watching'}
          {opponentPresence && (
            <span className={`presence ${opponentPresence}`}>
              {opponentPresence === 'online' ? 'Opponent online' : 'Opponent disconnected'}
            </span>
          )}
        </p>
      )}
    </>
  );

  const iAskedRematch = color ? state.rematch[color] : false;
  const theyAskedRematch = opponent ? state.rematch[opponent] : false;

  return (
    <GameScreen
      game={view}
      komi={state.komi}
      meta={`${state.size}×${state.size} · online · komi ${state.komi}`}
      onMenu={onMenu}
      header={header}
      extraActions={color && opponentPresence !== 'empty' && <ResignButton onResign={resign} />}
      endActions={
        color && (
          <button className="primary" onClick={rematch} disabled={iAskedRematch}>
            {iAskedRematch ? 'Rematch requested' : theyAskedRematch ? 'Accept rematch' : 'Rematch'}
          </button>
        )
      }
    />
  );
}
