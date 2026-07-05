/**
 * End-to-end test of online play against a running Worker.
 *   npm run dev:api            (in another terminal)
 *   npx vite-node scripts/online-smoke.ts [http://localhost:8787]
 */
import type { ClientMessage, CreateRoomResponse, RoomState, ServerMessage } from '../src/online/protocol';

const BASE = process.argv[2] ?? 'http://localhost:8787';
const WS_BASE = BASE.replace(/^http/, 'ws');

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? '✓' : '✗'} ${name}${ok || detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`);
  if (!ok) failures++;
}

class Client {
  messages: ServerMessage[] = [];
  closed: { code: number } | null = null;
  ws: WebSocket;
  private waiters: (() => void)[] = [];

  constructor(code: string) {
    this.ws = new WebSocket(`${WS_BASE}/api/rooms/${code}/ws`);
    this.ws.onmessage = (e) => {
      this.messages.push(JSON.parse(String(e.data)));
      this.waiters.forEach((w) => w());
    };
    this.ws.onclose = (e) => {
      this.closed = { code: e.code };
      this.waiters.forEach((w) => w());
    };
  }

  open() {
    return new Promise<void>((resolve, reject) => {
      if (this.ws.readyState === WebSocket.OPEN) return resolve();
      this.ws.onopen = () => resolve();
      this.ws.onerror = () => reject(new Error('socket error'));
    });
  }

  send(msg: ClientMessage | string) {
    this.ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }

  /** Waits for a message after index `from` that matches. */
  wait<T extends ServerMessage>(pred: (m: ServerMessage) => m is T, from = 0, ms = 3000): Promise<T | null> {
    return new Promise((resolve) => {
      const tryFind = () => {
        const found = this.messages.slice(from).find(pred);
        if (found) {
          clearTimeout(timer);
          resolve(found);
          return true;
        }
        return false;
      };
      const timer = setTimeout(() => resolve(null), ms);
      if (!tryFind()) this.waiters.push(() => void tryFind());
    });
  }

  latestState(): RoomState | null {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const m = this.messages[i];
      if (m.type === 'state') return m.state;
    }
    return null;
  }

  mark() {
    return this.messages.length;
  }

  closeNow() {
    this.ws.close();
  }
}

const isWelcome = (m: ServerMessage): m is Extract<ServerMessage, { type: 'welcome' }> => m.type === 'welcome';
const isState = (m: ServerMessage): m is Extract<ServerMessage, { type: 'state' }> => m.type === 'state';
const isError = (m: ServerMessage): m is Extract<ServerMessage, { type: 'error' }> => m.type === 'error';
const stateWhere = (f: (s: RoomState) => boolean) => (m: ServerMessage): m is Extract<ServerMessage, { type: 'state' }> =>
  m.type === 'state' && f(m.state);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const bad = await fetch(`${BASE}/api/rooms`, { method: 'POST', body: JSON.stringify({ size: 10 }) });
  check('rejects invalid room settings', bad.status === 400, bad.status);

  const cross = await fetch(`${BASE}/api/rooms`, {
    method: 'POST',
    headers: { Origin: 'https://evil.example' },
    body: JSON.stringify({ size: 9, komi: 7.5, color: 'black' }),
  });
  check('rejects cross-origin room creation', cross.status === 403, cross.status);

  const res = await fetch(`${BASE}/api/rooms`, {
    method: 'POST',
    body: JSON.stringify({ size: 9, komi: 7.5, color: 'black' }),
  });
  const room = (await res.json()) as CreateRoomResponse;
  check('creates a room', res.status === 201 && /^[A-Z0-9]{6}$/.test(room.code), room);

  const a = new Client(room.code);
  await a.open();
  a.send({ type: 'hello', token: room.token });
  const aWelcome = await a.wait(isWelcome);
  check('creator gets their chosen seat', aWelcome?.color === 'black', aWelcome);
  const s0 = await a.wait(isState);
  check('white seat starts empty', s0?.state.players.white === 'empty', s0?.state.players);

  let m = a.mark();
  a.send({ type: 'move', move: 'D4', at: 0 });
  check('cannot move before the opponent joins', !!(await a.wait(isError, m)));

  const b = new Client(room.code);
  await b.open();
  b.send({ type: 'hello' });
  const bWelcome = await b.wait(isWelcome);
  check('second player gets the other seat and a token', bWelcome?.color === 'white' && !!bWelcome.token, bWelcome);
  const bToken = bWelcome!.token!;
  check('creator sees the opponent arrive', !!(await a.wait(stateWhere((s) => s.players.white === 'online'))));

  m = b.mark();
  b.send({ type: 'move', move: 'D4', at: 0 });
  check("can't play out of turn", (await b.wait(isError, m))?.message.includes('turn') ?? false);

  m = b.mark();
  a.send({ type: 'move', move: 'D4', at: 0 });
  const afterD4 = await b.wait(stateWhere((s) => s.moves.length === 1), m);
  check('a legal move is broadcast to both players', afterD4?.state.moves[0] === 'D4', afterD4?.state.moves);

  m = a.mark();
  a.send({ type: 'move', move: 'E5', at: 0 }); // stale double click
  await sleep(300);
  check('stale/duplicate moves are ignored', a.latestState()?.moves.length === 1, a.latestState()?.moves);

  for (const [label, msg] of [
    ['occupied point', { type: 'move', move: 'D4', at: 1 }],
    ['off-board point', { type: 'move', move: 'Z99', at: 1 }],
    ['column I (skipped)', { type: 'move', move: 'I5', at: 1 }],
    ['non-string move', { type: 'move', move: 42, at: 1 }],
  ] as const) {
    m = b.mark();
    b.send(msg as unknown as ClientMessage);
    check(`rejects ${label}`, !!(await b.wait(isError, m)));
  }
  b.send('not json{');
  b.send('x'.repeat(5000));
  await sleep(200);
  check('ignores malformed messages', b.latestState()?.moves.length === 1);

  m = a.mark();
  b.send({ type: 'move', move: 'E5', at: 1 });
  check('white moves', !!(await a.wait(stateWhere((s) => s.moves.join() === 'D4,E5'), m)));

  const c = new Client(room.code);
  await c.open();
  c.send({ type: 'hello' });
  check('a third visitor watches', (await c.wait(isWelcome))?.color === null);
  check('spectators see the game', (await c.wait(isState))?.state.moves.length === 2);
  m = c.mark();
  c.send({ type: 'move', move: 'F6', at: 2 });
  check("spectators can't move", !!(await c.wait(isError, m)));

  m = b.mark();
  a.closeNow();
  check('opponent sees a disconnect', !!(await b.wait(stateWhere((s) => s.players.black === 'offline'), m)));
  const a2 = new Client(room.code);
  await a2.open();
  a2.send({ type: 'hello', token: room.token });
  check('reconnecting with the token restores the seat', (await a2.wait(isWelcome))?.color === 'black');
  check('…and the game', (await a2.wait(isState))?.state.moves.length === 2);

  const thief = new Client(room.code);
  await thief.open();
  thief.send({ type: 'hello', token: 'guessed-token' });
  check('a wrong token gets no seat', (await thief.wait(isWelcome))?.color === null);
  thief.closeNow();

  m = b.mark();
  a2.send({ type: 'resign' });
  const resigned = await b.wait(stateWhere((s) => s.result !== null), m);
  check('resigning ends the game', resigned?.state.result?.winner === 'white' && resigned.state.result.reason === 'resign');

  m = a2.mark();
  a2.send({ type: 'move', move: 'F6', at: 2 });
  check('no moves after the game ends', !!(await a2.wait(isError, m)));

  m = a2.mark();
  const mb = b.mark();
  a2.send({ type: 'rematch' });
  b.send({ type: 'rematch' });
  const aSwap = await a2.wait(isWelcome, m);
  const bSwap = await b.wait(isWelcome, mb);
  check('rematch swaps colours', aSwap?.color === 'white' && bSwap?.color === 'black', [aSwap, bSwap]);
  check('rematch starts a fresh board', !!(await a2.wait(stateWhere((s) => s.moves.length === 0 && !s.result), m)));

  // The swap must survive reconnecting: B's token now owns black.
  b.closeNow();
  const b2 = new Client(room.code);
  await b2.open();
  b2.send({ type: 'hello', token: bToken });
  check('swapped seats persist across reconnects', (await b2.wait(isWelcome))?.color === 'black');

  {
    const r = (await (
      await fetch(`${BASE}/api/rooms`, { method: 'POST', body: JSON.stringify({ size: 9, komi: 7.5, color: 'black' }) })
    ).json()) as CreateRoomResponse;
    const crowd = Array.from({ length: 8 }, () => new Client(r.code));
    await Promise.all(crowd.map((x) => x.open()));
    crowd.forEach((x) => x.send({ type: 'hello' })); // all at the same moment
    const welcomes = await Promise.all(crowd.map((x) => x.wait(isWelcome)));
    const seated = welcomes.filter((w) => w?.color === 'white').length;
    const watching = welcomes.filter((w) => w && w.color === null).length;
    check('8 simultaneous joiners: exactly one gets the free seat', seated === 1, { seated, watching });
    check('…and the other 7 watch', watching === 7, { seated, watching });
    check("…and nobody takes the absent creator's seat", welcomes.every((w) => w?.color !== 'black'));
    crowd.forEach((x) => x.closeNow());
  }

  {
    const r = (await (
      await fetch(`${BASE}/api/rooms`, { method: 'POST', body: JSON.stringify({ size: 9, komi: 7.5, color: 'white' }) })
    ).json()) as CreateRoomResponse;

    // The same browser in two tabs shares one token, so both tabs are that player.
    const tab1 = new Client(r.code);
    const tab2 = new Client(r.code);
    await Promise.all([tab1.open(), tab2.open()]);
    tab1.send({ type: 'hello', token: r.token });
    tab2.send({ type: 'hello', token: r.token });
    const [w1, w2] = await Promise.all([tab1.wait(isWelcome), tab2.wait(isWelcome)]);
    check('the same player in two tabs keeps one seat', w1?.color === 'white' && w2?.color === 'white', [w1, w2]);

    // Saying hello twice on one connection can't grab a second seat.
    const greedy = new Client(r.code);
    await greedy.open();
    greedy.send({ type: 'hello' });
    greedy.send({ type: 'hello' });
    await sleep(400);
    const greetings = greedy.messages.filter(isWelcome);
    check('a second hello is ignored', greetings.length === 1 && greetings[0].color === 'black', greetings);
    const another = new Client(r.code);
    await another.open();
    another.send({ type: 'hello' });
    check('…so the next visitor watches', (await another.wait(isWelcome))?.color === null);

    // A room stops accepting connections at its limit (4 already connected + 50 = 4 over).
    const flood: Client[] = [];
    for (let i = 0; i < 50; i++) flood.push(new Client(r.code));
    await Promise.all(flood.map((x) => x.open().catch(() => {})));
    await sleep(500);
    const refused = flood.filter((x) => x.closed?.code === 4029).length;
    check('connections beyond the limit are refused with 4029', refused === 4, { refused, expected: 4 });
    [tab1, tab2, greedy, another, ...flood].forEach((x) => x.closeNow());
  }

  const ghost = new Client('ZZZZZZ');
  await ghost.open().catch(() => {});
  await sleep(1000);
  check('unknown rooms close with 4004', ghost.closed?.code === 4004, ghost.closed);

  [a2, b2, c].forEach((x) => x.closeNow());
  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
