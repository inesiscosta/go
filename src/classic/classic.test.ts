import { loadPyodide, type PyodideAPI } from 'pyodide';
import { beforeAll, describe, expect, it } from 'vitest';
// The same files the classic game's worker loads in the browser. Go.py is a byte-for-byte copy of the
// original branch's (git show original:Go.py > src/classic/Go.py).
import goSource from './Go.py?raw';
import runner from './run.py?raw';

let pyodide: PyodideAPI;

beforeAll(async () => {
  // Under Vitest, Pyodide can't infer where its own files are, so point it at the package
  pyodide = await loadPyodide({ indexURL: new URL('../../node_modules/pyodide/', import.meta.url).pathname });
}, 60_000);

/** Plays the original game with the given lines typed in, and returns everything it printed. */
async function play(lines: string[]): Promise<string> {
  let output = '';
  const decoder = new TextDecoder();
  pyodide.setStdout({ write: (b: Uint8Array) => ((output += decoder.decode(b, { stream: true })), b.length) });
  pyodide.globals.set('GO_SOURCE', goSource);
  const queue = [...lines];
  pyodide.globals.set('read_line', async () => {
    const next = queue.shift();
    if (next === undefined) throw new Error(`the game asked for more input than the test gave it:\n${output}`);
    return next;
  });
  await pyodide.runPythonAsync(runner, { filename: 'run.py' });
  return output;
}

describe('the classic (2023) Python game', () => {
  it('plays a whole game through input() and print()', async () => {
    const out = await play(['9', 'E5', 'P', 'P']);
    expect(out).toContain('Enter the size of the Goban (9, 13, or 19): 9\n');
    expect(out).toContain("Write down an intersection or 'P' to pass the turn [X]:E5\n");
    // Black's one stone owns the whole empty board once both players pass
    expect(out.trimEnd()).toMatch(/White \(O\) has 0 points\nBlack \(X\) has 81 points\n[\s\S]*X[\s\S]*$/);
  }, 60_000);

  it('asks again after an invalid size or an illegal move', async () => {
    const out = await play(['10', '9', 'Z9', 'E5', 'E5', 'P', 'P']);
    expect(out).toContain('Invalid size. Please choose a size 9, 13, or 19.');
    // Black: Z9 is off the board, so black is asked again and plays E5. White: E5 is taken, so white is
    // asked again and passes. Black passes. That's 3 prompts for black and 2 for white.
    expect(out.match(/pass the turn \[X\]:/g)?.length).toBe(3);
    expect(out.match(/pass the turn \[O\]:/g)?.length).toBe(2);
  }, 60_000);
});
