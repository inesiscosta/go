import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { estimateDead } from '../bot/mcts';
import { BLACK, Board, PASS, WHITE, type Stone } from '../engine/board';
import type { GameView, Outcome, Scoring } from '../game/types';
import { toggleGroup } from '../game/useGame';
import {
  CLOSE_FULL,
  CLOSE_NOT_FOUND,
  type ClientMessage,
  type Color,
  type CreateRoomRequest,
  type CreateRoomResponse,
  type RoomState,
  type ServerMessage,
} from './protocol';

export type Connection = 'connecting' | 'open' | 'reconnecting' | 'not-found' | 'full';

const toStone = (c: Color): Stone => (c === 'black' ? BLACK : WHITE);

// Seat tokens live in localStorage so a refresh or a dropped connection
// gets you your seat back. Storage can be unavailable (private mode), so
// every access is guarded; without it you'd simply rejoin as a new player.
const tokenKey = (code: string) => `go:seat:${code}`;
function saveToken(code: string, token: string) {
  try {
    localStorage.setItem(tokenKey(code), token);
  } catch {}
}
function loadToken(code: string): string | undefined {
  try {
    return localStorage.getItem(tokenKey(code)) ?? undefined;
  } catch {
    return undefined;
  }
}

export async function createRoom(req: CreateRoomRequest): Promise<CreateRoomResponse> {
  const res = await fetch('/api/rooms', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(`Couldn't create a room (${res.status})`);
  const room = (await res.json()) as CreateRoomResponse;
  saveToken(room.code, room.token);
  return room;
}

function replay(state: RoomState): Board {
  const b = new Board(state.size);
  for (const m of state.moves) {
    const p = b.parseCoord(m);
    if (p === null || !b.isLegal(p)) break; // shouldn't happen: the server validated it
    b.play(p);
  }
  return b;
}

export interface OnlineGame {
  view: GameView | null;
  state: RoomState | null;
  connection: Connection;
  /** Your seat, or null if you're watching. Undefined until the server has greeted you. */
  color: Color | null | undefined;
  resign: () => void;
  rematch: () => void;
}

export function useOnlineGame(code: string): OnlineGame {
  const [state, setState] = useState<RoomState | null>(null);
  const [color, setColor] = useState<Color | null | undefined>(undefined);
  const [connection, setConnection] = useState<Connection>('connecting');
  const [error, setError] = useState<string | null>(null);
  const socket = useRef<WebSocket | null>(null);

  useEffect(() => {
    let stopped = false;
    let attempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let errorTimer: ReturnType<typeof setTimeout> | undefined;

    function connect() {
      const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${scheme}://${location.host}/api/rooms/${code}/ws`);
      socket.current = ws;

      ws.onopen = () => {
        attempt = 0;
        setConnection('open');
        ws.send(JSON.stringify({ type: 'hello', token: loadToken(code) } satisfies ClientMessage));
      };
      ws.onmessage = (e) => {
        let msg: ServerMessage;
        try {
          msg = JSON.parse(e.data);
        } catch {
          return;
        }
        if (msg.type === 'welcome') {
          if (msg.token) saveToken(code, msg.token);
          setColor(msg.color);
        } else if (msg.type === 'state') {
          setState(msg.state);
          setError(null);
        } else if (msg.type === 'error') {
          setError(msg.message);
          clearTimeout(errorTimer);
          errorTimer = setTimeout(() => setError(null), 4000);
        }
      };
      ws.onclose = (e) => {
        if (stopped) return;
        if (e.code === CLOSE_NOT_FOUND) {
          setConnection('not-found');
          return;
        }
        if (e.code === CLOSE_FULL) {
          setConnection('full');
          return;
        }
        setConnection('reconnecting');
        retryTimer = setTimeout(connect, Math.min(500 * 2 ** attempt++, 10_000));
      };
    }

    connect();
    return () => {
      stopped = true;
      clearTimeout(retryTimer);
      clearTimeout(errorTimer);
      socket.current?.close();
    };
  }, [code]);

  const send = useCallback((msg: ClientMessage) => {
    if (socket.current?.readyState === WebSocket.OPEN) socket.current.send(JSON.stringify(msg));
  }, []);

  const board = useMemo(() => (state ? replay(state) : null), [state]);

  const myStone = color ? toStone(color) : null;
  const opponentHere = color ? state?.players[color === 'black' ? 'white' : 'black'] !== 'empty' : false;
  const isMyTurn =
    connection === 'open' && !!board && !!state && !state.result && myStone === board.toPlay && opponentHere;

  // Let the tab title tell you when it's your move.
  useEffect(() => {
    document.title = isMyTurn ? 'Your move · Go' : 'Go';
    return () => {
      document.title = 'Go';
    };
  }, [isMyTurn]);

  const play = useCallback(
    (p: number) => {
      if (!board || !state || !isMyTurn) return;
      send({ type: 'move', move: board.coord(p), at: state.moves.length });
    },
    [board, state, isMyTurn, send],
  );

  let outcome: Outcome | null = null;
  if (board && state?.result) {
    const { black, white } = board.score();
    const r = state.result;
    outcome = {
      winner: r.winner ? toStone(r.winner) : null,
      reason: r.reason,
      black: r.black ?? black,
      white: r.white ?? white + state.komi,
      dead: state.dead ? new Set(state.dead.map((s) => board.point(s))) : undefined,
    };
  }

  // Scoring: both passed and there's no result yet.
  const inScoring = !!board && !!state && board.isOver && !state.result;
  const dead = useMemo(
    () => new Set(board && state?.dead ? state.dead.map((s) => board.point(s)) : []),
    [board, state?.dead],
  );

  // Someone has to propose the first marks: black, or white if black isn't
  // here. The estimate is seeded, so if both do it they send the same marks.
  const proposeFirst =
    inScoring && state!.dead === null && !!color && (color === 'black' || state!.players.black !== 'online');
  useEffect(() => {
    if (!proposeFirst || !board) return;
    send({ type: 'dead', stones: estimateDead(board).map((p) => board.coord(p)) });
  }, [proposeFirst, board, send]);

  let scoring: Scoring | null = null;
  if (inScoring && board && state) {
    const opp = color === 'black' ? 'white' : 'black';
    const me = color ? state.accepted[color] : false;
    scoring = {
      dead,
      toggle: color
        ? (p) => send({ type: 'dead', stones: [...toggleGroup(board, dead, p)].map((q) => board.coord(q)) })
        : undefined,
      accept: color && !me && state.dead !== null ? () => send({ type: 'accept', version: state.markVersion }) : undefined,
      accepted: color ? { me, them: state.accepted[opp] } : undefined,
    };
  }

  const view: GameView | null = board
    ? {
        board,
        // Spectators see the board like a local game, with colours instead of "you".
        myColor: myStone,
        opponentName: 'Opponent',
        isMyTurn,
        thinking: false,
        confidence: null,
        error,
        outcome,
        scoring,
        play,
        pass: () => play(PASS),
        canUndo: false,
        status: color && !opponentHere ? 'Waiting for your opponent' : undefined,
      }
    : null;

  return {
    view,
    state,
    connection,
    color,
    resign: () => send({ type: 'resign' }),
    rematch: () => send({ type: 'rematch' }),
  };
}
