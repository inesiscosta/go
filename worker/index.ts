/**
 * Cloudflare Worker: serves the app's static files and the online-play API.
 *
 *   POST /api/rooms              create a room → { code, token, color }
 *   GET  /api/rooms/:code/ws     WebSocket into that room's Durable Object
 */
import {
  CODE_ALPHABET,
  CODE_LENGTH,
  normalizeCode,
  type Color,
  type CreateRoomRequest,
  type CreateRoomResponse,
} from '../src/online/protocol';

export { Room } from './room';

function randomCode(): string {
  // Rejection sampling keeps every character equally likely.
  let code = '';
  const limit = 256 - (256 % CODE_ALPHABET.length);
  while (code.length < CODE_LENGTH) {
    for (const b of crypto.getRandomValues(new Uint8Array(16))) {
      if (b < limit && code.length < CODE_LENGTH) code += CODE_ALPHABET[b % CODE_ALPHABET.length];
    }
  }
  return code;
}

function parseCreate(body: unknown): { size: 9 | 13 | 19; komi: number; color: Color } | null {
  if (typeof body !== 'object' || body === null) return null;
  const { size, komi, color } = body as Partial<CreateRoomRequest>;
  if (size !== 9 && size !== 13 && size !== 19) return null;
  if (typeof komi !== 'number' || !Number.isFinite(komi) || komi < 0 || komi > 20 || (komi * 2) % 1 !== 0)
    return null;
  if (color !== 'black' && color !== 'white' && color !== 'random') return null;
  const resolved: Color = color === 'random' ? (Math.random() < 0.5 ? 'black' : 'white') : color;
  return { size, komi, color: resolved };
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/api/rooms' && request.method === 'POST') {
      // Browsers send Origin on cross-site POSTs; only accept our own.
      const origin = request.headers.get('Origin');
      if (origin && origin !== url.origin) return json({ error: 'Forbidden' }, 403);

      let settings;
      try {
        settings = parseCreate(await request.json());
      } catch {
        settings = null;
      }
      if (!settings) return json({ error: 'Invalid room settings' }, 400);

      for (let attempt = 0; attempt < 5; attempt++) {
        const code = randomCode();
        const room = env.ROOMS.get(env.ROOMS.idFromName(code));
        const created = await room.init(code, settings.size, settings.komi, settings.color);
        if (created)
          return json({ code, token: created.token, color: settings.color } satisfies CreateRoomResponse, 201);
      }
      return json({ error: 'Could not create a room, please try again' }, 503);
    }

    const ws = /^\/api\/rooms\/([^/]+)\/ws$/.exec(url.pathname);
    if (ws) {
      const code = normalizeCode(ws[1]);
      if (!code) return json({ error: 'Invalid room code' }, 400);
      if (request.headers.get('Upgrade') !== 'websocket') return json({ error: 'Expected a WebSocket' }, 426);
      return env.ROOMS.get(env.ROOMS.idFromName(code)).fetch(request);
    }

    if (url.pathname.startsWith('/api/')) return json({ error: 'Not found' }, 404);
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
