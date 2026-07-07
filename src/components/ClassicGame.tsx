import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { ClassicRequest, ClassicResponse } from '../classic/worker';

type Status = 'loading' | 'running' | 'waiting' | 'over' | 'error';

interface Props {
  onMenu: () => void;
}

/** The original 2023 Python text game, unchanged, running in the browser with Pyodide. */
export function ClassicGame({ onMenu }: Props) {
  const [output, setOutput] = useState('');
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState<string | null>(null);
  const [line, setLine] = useState('');
  const worker = useRef<Worker | null>(null);
  const screen = useRef<HTMLPreElement>(null);
  const input = useRef<HTMLInputElement>(null);

  const send = (msg: ClassicRequest) => worker.current?.postMessage(msg);

  useEffect(() => {
    const w = new Worker(new URL('../classic/worker.ts', import.meta.url), { type: 'module' });
    worker.current = w;
    w.onmessage = (e: MessageEvent<ClassicResponse>) => {
      const msg = e.data;
      if (msg.type === 'loading') setStatus('loading');
      else if (msg.type === 'output') {
        setOutput((o) => o + msg.text);
        setStatus((s) => (s === 'loading' ? 'running' : s));
      } else if (msg.type === 'waiting') setStatus('waiting');
      else if (msg.type === 'exit') {
        setStatus(msg.error ? 'error' : 'over');
        setError(msg.error ?? null);
      }
    };
    w.onerror = () => {
      setStatus('error');
      setError('Python failed to start. Check your connection and try again.');
    };
    w.postMessage({ type: 'start' } satisfies ClassicRequest);
    return () => w.terminate();
  }, []);

  // Keep the newest output in view, and the cursor in the input whenever the game is waiting for a move
  useEffect(() => {
    screen.current?.scrollTo({ top: screen.current.scrollHeight });
  }, [output]);
  useEffect(() => {
    if (status === 'waiting') input.current?.focus();
  }, [status]);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (status !== 'waiting') return;
    setStatus('running');
    send({ type: 'line', text: line });
    setLine('');
  }

  function playAgain() {
    setOutput('');
    setError(null);
    setStatus('running');
    send({ type: 'start' });
  }

  return (
    <main className="classic">
      <div className="classic-top">
        <button className="link" onClick={onMenu}>
          <span aria-hidden="true">←</span> Menu
        </button>
      </div>

      <header className="classic-header">
        <h2>Go, the 2023 edition</h2>
        <p>
          My first-year programming coursework, a text-based Go game in Python, running unchanged in your browser
          with <a href="https://pyodide.org">Pyodide</a>. Type an intersection like <code>E5</code>, or{' '}
          <code>P</code> to pass. Two passes in a row end the game.
        </p>
        <p className="classic-source">
          <a href="https://github.com/inesiscosta/Go/tree/original" target="_blank" rel="noopener noreferrer">Original source code</a>
        </p>
      </header>

      <div className="console" onClick={() => input.current?.focus()}>
        <pre ref={screen} className="console-output" role="log" aria-live="polite" aria-label="Game output">
          {status === 'loading' && !output ? 'Loading Python (about 10 MB, only the first time)…' : output}
        </pre>
        <form className="console-input" onSubmit={submit}>
          <span aria-hidden="true">{'>'}</span>
          <input
            ref={input}
            value={line}
            onChange={(e) => setLine(e.target.value)}
            disabled={status !== 'waiting'}
            aria-label="Your move"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
          />
        </form>
      </div>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {(status === 'over' || status === 'error') && (
        <div className="classic-actions">
          <button className="primary" onClick={playAgain}>
            Play again
          </button>
          <button className="secondary" onClick={onMenu}>
            Back to the new version
          </button>
        </div>
      )}
    </main>
  );
}
