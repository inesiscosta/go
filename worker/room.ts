import { DurableObject } from 'cloudflare:workers';
import { BLACK, Board, type Stone } from '../src/engine/board';
import {
  CLOSE_FULL,
  CLOSE_NOT_FOUND,
  type BoardSize,
  type ClientMessage,
  type Color,
  type Presence,
  type Result,
  type RoomState,
  type ServerMessage,
} from '../src/online/protocol';

/** Rooms are deleted after this long without any activity. */
const EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_MESSAGE_BYTES = 1024;
/** Two players plus spectators; stops one link from being used to flood a room. */
const MAX_CONNECTIONS = 50;

interface Stored {
  code: string;
  size: BoardSize;
  komi: number;
  /** SHA-256 of each seat's token; the tokens themselves are never stored. */
  seats: Record<Color, string | null>;
  moves: string[];
  result: Result | null;
  rematch: Record<Color, boolean>;
}

interface Attachment {
  /** null until the client says hello, 'pending' while seating it, 'spectator' if both seats are taken. */
  color: Color | 'spectator' | 'pending' | null;
}

const toStone = (c: Color): Stone => (c === 'black' ? BLACK : 2);
const other = (c: Color): Color => (c === 'black' ? 'white' : 'black');

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, (c) => ({ '+': '-', '/': '_', '=': '' })[c]!);
}

/**
 * One game room. Holds the authoritative game, assigns seats, validates every
 * move with the shared rules engine, and broadcasts the new state.
 *
 * Uses the WebSocket Hibernation API, so an idle room costs nothing: the
 * object can be evicted from memory while sockets stay connected.
 */
export class Room extends DurableObject<Env> {
  private room: Stored | null = null;
  private board: Board | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.room = (await ctx.storage.get<Stored>('room')) ?? null;
      if (this.room) this.board = this.replay(this.room);
    });
  }

  private replay(room: Stored): Board {
    const b = new Board(room.size);
    for (const m of room.moves) b.play(b.point(m));
    return b;
  }

  /** Called by the Worker when creating a room. Returns null if the code is already taken. */
  async init(
    code: string,
    size: BoardSize,
    komi: number,
    color: Color,
  ): Promise<{ token: string } | null> {
    if (this.room) return null;
    const token = newToken();
    this.room = {
      code,
      size,
      komi,
      seats: { black: null, white: null, [color]: await sha256(token) } as Record<Color, string | null>,
      moves: [],
      result: null,
      rematch: { black: false, white: false },
    };
    this.board = new Board(size);
    await this.save();
    return { token };
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket')
      return new Response('Expected a WebSocket', { status: 426 });

    const { 0: client, 1: server } = new WebSocketPair();
    if (!this.room) {
      // Unknown room: a plain (non-hibernating) socket closed straight away with
      // a dedicated code, so the client can tell "no such room" from a network error.
      server.accept();
      server.close(CLOSE_NOT_FOUND, 'Room not found');
      return new Response(null, { status: 101, webSocket: client });
    }
    if (this.ctx.getWebSockets().length >= MAX_CONNECTIONS) {
      server.accept();
      server.close(CLOSE_FULL, 'Room is full');
      return new Response(null, { status: 101, webSocket: client });
    }
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ color: null } satisfies Attachment);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, data: string | ArrayBuffer): Promise<void> {
    if (!this.room || !this.board) return;
    if (typeof data !== 'string' || data.length > MAX_MESSAGE_BYTES) return;
    let msg: ClientMessage;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    if (typeof msg !== 'object' || msg === null) return;

    const att = ws.deserializeAttachment() as Attachment;
    if (msg.type === 'hello') return this.hello(ws, att, msg.token);
    if (att.color === null || att.color === 'pending') return; // must say hello first
    if (att.color === 'spectator') return this.send(ws, { type: 'error', message: "You're watching this game." });

    const me = att.color;
    if (msg.type === 'move') return this.move(ws, me, msg.move, msg.at);
    if (msg.type === 'resign') {
      if (this.room.result) return;
      this.room.result = { winner: other(me), reason: 'resign' };
      return this.commit();
    }
    if (msg.type === 'rematch') {
      if (!this.room.result) return;
      this.room.rematch[me] = true;
      if (this.room.rematch.black && this.room.rematch.white) {
        // New game in the same room, with colours swapped.
        const { black, white } = this.room.seats;
        this.room.seats = { black: white, white: black };
        this.room.moves = [];
        this.room.result = null;
        this.room.rematch = { black: false, white: false };
        this.board = new Board(this.room.size);
        for (const s of this.ctx.getWebSockets()) {
          const a = s.deserializeAttachment() as Attachment;
          if (a.color === 'black' || a.color === 'white') {
            const swapped: Attachment = { color: other(a.color) };
            s.serializeAttachment(swapped);
            this.send(s, { type: 'welcome', color: swapped.color as Color });
          }
        }
      }
      return this.commit();
    }
  }

  private async hello(ws: WebSocket, att: Attachment, token: unknown): Promise<void> {
    if (att.color !== null || !this.room) return; // already greeted (or greeting)
    // Mark the socket before awaiting anything, so a second hello is ignored.
    ws.serializeAttachment({ color: 'pending' } satisfies Attachment);

    // Do all the async work (hashing) first…
    const fresh = newToken();
    const [hash, freshHash] = await Promise.all([
      typeof token === 'string' && token.length <= 64 ? sha256(token) : null,
      sha256(fresh),
    ]);

    // …then decide and claim the seat with no awaits in between. Other
    // messages can be delivered while this object awaits, so checking for a
    // free seat and taking it must happen in one synchronous step, or two
    // people joining at the same moment could both get it.
    const room = this.room;
    let color: Color | 'spectator' = 'spectator';
    let issued: string | undefined;
    if (hash && room.seats.black === hash) color = 'black';
    else if (hash && room.seats.white === hash) color = 'white';
    else {
      const free = (['black', 'white'] as const).find((c) => room.seats[c] === null);
      if (free) {
        room.seats[free] = freshHash;
        issued = fresh;
        color = free;
      }
    }
    ws.serializeAttachment({ color } satisfies Attachment);
    if (issued) await this.save();

    this.send(ws, { type: 'welcome', color: color === 'spectator' ? null : color, token: issued });
    this.broadcast();
  }

  private async move(ws: WebSocket, me: Color, move: unknown, at: unknown): Promise<void> {
    const room = this.room!;
    const board = this.board!;
    if (room.result) return this.send(ws, { type: 'error', message: 'The game is over.' });
    if (at !== room.moves.length) return; // stale or duplicate; the client will get fresh state
    if (board.toPlay !== toStone(me)) return this.send(ws, { type: 'error', message: "It's not your turn." });
    if (this.presence(other(me)) === 'empty')
      return this.send(ws, { type: 'error', message: 'Wait for your opponent to join.' });

    const p = typeof move === 'string' ? board.parseCoord(move) : null;
    if (p === null || !board.isLegal(p)) return this.send(ws, { type: 'error', message: "That move isn't allowed." });

    board.play(p);
    room.moves.push(board.coord(p));
    if (board.isOver) {
      const { black, white } = board.score();
      const w = white + room.komi;
      room.result = { winner: black === w ? null : black > w ? 'black' : 'white', reason: 'score', black, white: w };
    }
    await this.commit();
  }

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    ws.serializeAttachment({ color: null } satisfies Attachment);
    try {
      ws.close(code === 1005 ? 1000 : code, 'Closing'); // complete the closing handshake
    } catch {}
    this.broadcast();
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws, 1011);
  }

  async alarm(): Promise<void> {
    if (this.ctx.getWebSockets().length > 0) {
      await this.ctx.storage.setAlarm(Date.now() + EXPIRY_MS);
      return;
    }
    await this.ctx.storage.deleteAll();
    this.room = null;
    this.board = null;
  }

  private presence(c: Color): Presence {
    if (!this.room?.seats[c]) return 'empty';
    for (const s of this.ctx.getWebSockets()) {
      if (s.readyState !== WebSocket.OPEN) continue;
      if ((s.deserializeAttachment() as Attachment).color === c) return 'online';
    }
    return 'offline';
  }

  private state(): RoomState {
    const r = this.room!;
    return {
      code: r.code,
      size: r.size,
      komi: r.komi,
      moves: r.moves,
      result: r.result,
      players: { black: this.presence('black'), white: this.presence('white') },
      rematch: r.rematch,
    };
  }

  private send(ws: WebSocket, msg: ServerMessage): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {}
  }

  private broadcast(): void {
    if (!this.room) return;
    const msg = JSON.stringify({ type: 'state', state: this.state() } satisfies ServerMessage);
    for (const s of this.ctx.getWebSockets()) {
      const c = (s.deserializeAttachment() as Attachment).color;
      if (c === null || c === 'pending') continue;
      try {
        s.send(msg);
      } catch {}
    }
  }

  private async save(): Promise<void> {
    await this.ctx.storage.put('room', this.room);
    await this.ctx.storage.setAlarm(Date.now() + EXPIRY_MS);
  }

  private async commit(): Promise<void> {
    await this.save();
    this.broadcast();
  }
}
