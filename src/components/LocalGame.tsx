import { useGame, type Settings } from '../game/useGame';
import { GameScreen } from './GameScreen';

interface Props {
  settings: Settings;
  onRestart: () => void;
  onMenu: () => void;
}

/** A game against the computer, or two players on one device. */
export function LocalGame({ settings, onRestart, onMenu }: Props) {
  const game = useGame(settings);
  const meta = `${settings.size}×${settings.size}${settings.mode === 'bot' ? ` · ${settings.level}` : ''} · komi ${settings.komi}`;
  return (
    <GameScreen
      game={game}
      komi={settings.komi}
      meta={meta}
      onMenu={onMenu}
      endActions={
        <button className="primary" onClick={onRestart}>
          Play again
        </button>
      }
    />
  );
}
