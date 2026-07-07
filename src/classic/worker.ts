/// <reference lib="webworker" />
/**
 * Runs the original 2023 Python game in Pyodide, off the main thread.
 *
 * Pyodide (about 10 MB) is fetched from jsDelivr the first time someone opens the classic game, so it never
 * slows down the main app. The version is pinned to match the `pyodide` dev dependency used by the tests.
 */
import type { PyodideAPI } from 'pyodide';
import goSource from './Go.py?raw';
import runner from './run.py?raw';

const PYODIDE_URL = 'https://cdn.jsdelivr.net/pyodide/v314.0.7/full/';

export type ClassicRequest = { type: 'start' } | { type: 'line'; text: string };
export type ClassicResponse =
  | { type: 'loading' }
  | { type: 'output'; text: string }
  /** The game is waiting for the player to type a line. */
  | { type: 'waiting' }
  | { type: 'exit'; error?: string };

const post = (msg: ClassicResponse) => self.postMessage(msg);

let pyodide: Promise<PyodideAPI> | null = null;
let answer: ((line: string) => void) | null = null;

function load(): Promise<PyodideAPI> {
  pyodide ??= (async () => {
    post({ type: 'loading' });
    const { loadPyodide } = (await import(/* @vite-ignore */ `${PYODIDE_URL}pyodide.mjs`)) as typeof import('pyodide');
    const py = await loadPyodide({ indexURL: PYODIDE_URL });
    const decoder = new TextDecoder();
    const write = (buffer: Uint8Array) => {
      post({ type: 'output', text: decoder.decode(buffer, { stream: true }) });
      return buffer.length;
    };
    py.setStdout({ write });
    py.setStderr({ write });
    py.globals.set('GO_SOURCE', goSource);
    py.globals.set(
      'read_line',
      () =>
        new Promise<string>((resolve) => {
          answer = resolve;
          post({ type: 'waiting' });
        }),
    );
    return py;
  })();
  return pyodide;
}

async function play() {
  try {
    const py = await load();
    await py.runPythonAsync(runner, { filename: 'run.py' });
    post({ type: 'exit' });
  } catch (err) {
    pyodide = null;
    post({ type: 'exit', error: err instanceof Error ? err.message : String(err) });
  }
}

self.onmessage = (e: MessageEvent<ClassicRequest>) => {
  if (e.data.type === 'start') {
    void play();
  } else if (e.data.type === 'line' && answer) {
    const resolve = answer;
    answer = null;
    resolve(e.data.text);
  }
};
