# Go

Play the board game Go in your browser: against a Monte Carlo Tree Search bot, a friend on the same screen, or a friend online.

- **Click to play** on a 9×9, 13×13 or 19×19 board (also playable with the keyboard: arrow keys and Enter)
- **A bot that runs entirely in your browser**, in a Web Worker, with three difficulty levels
- **Online play** with room codes and invite links, on Cloudflare Workers and Durable Objects
- Captures, suicide and ko rules, area scoring and komi
- **Dead-stone marking** when both players pass: the engine suggests which stones are dead, you adjust and accept (online, both players must agree)
- Undo, a live score preview and a territory overlay

## From coursework to web app

This started as a text-based Python game for my first-year Foundations of Programming course (2023/24), where the goal was to practise abstract data types. That version is kept, untouched, on the [`original`](../../tree/original) branch, along with the assignment and the course's 218 tests.

The rules engine was ported to TypeScript and rebuilt around a flat, padded board array so the bot can simulate thousands of games per second. To make sure nothing changed in translation, [`scripts/gen_fixtures.py`](scripts/gen_fixtures.py) loads the **original Python engine straight from that branch**, plays random games with it, and records every position's legal moves, board and score. The TypeScript engine has to reproduce all 2,538 positions exactly ([`engine.test.ts`](src/engine/engine.test.ts)).

## The bot

[`src/bot/mcts.ts`](src/bot/mcts.ts) is a Monte Carlo Tree Search player, inspired by Petr Baudiš's [michi](https://github.com/pasky/michi):

- **Playouts**: each iteration finishes the game with fast, semi-random moves that still follow basic Go sense: capture the stone just played if it's in atari, rescue a group the last move put in atari, never fill your own eyes, avoid self-atari.
- **RAVE** (all-moves-as-first): one playout updates the statistics of every move played anywhere in it, so the search learns much faster than plain UCT.
- **Priors**: new moves start with a head start or a handicap based on Go knowledge, such as captures, escaping atari, playing near the last move, avoiding the first line in open areas and favouring the third.
- **Passing**: it passes when you pass and it's already ahead, or when nothing useful is left to play. It never passes first while there's still something to gain.

Speed on an M-series Mac, single thread: about 7,000 playouts/s on 9×9, 3,000 on 13×13 and 1,400 on 19×19. More time makes it measurably stronger: the 1-second version beat the 0.1-second version in 6 of 6 games. It's a solid opponent for beginners on 9×9 and plays a looser game on 19×19.

## Online play

Each room is a [Durable Object](https://developers.cloudflare.com/durable-objects/) ([`worker/room.ts`](worker/room.ts)): a small stateful server with its own storage that both players connect to over WebSockets.

- **The server owns the game.** Clients only send the move they want, e.g. `{ "type": "move", "move": "D4", "at": 12 }`. The room checks the turn and legality with the same rules engine the browser uses, then broadcasts the new state. A modified client can't make an illegal move or play for the other side.
- **Room codes identify a game; tokens prove who you are.** Joining gives you a random seat token, which your browser keeps and sends in the first WebSocket message, never in a URL. Only its SHA-256 hash is stored. Refreshing or reconnecting gets your seat back; anyone else with the link can only watch.
- **`at` is the move number the client expects**, so double clicks and stale tabs can't play twice.
- **Both players agree on the score.** After two passes, either player can mark or unmark dead stones; any change clears both acceptances, and an acceptance names the version of the marks it saw, so nobody accepts marks they haven't seen. The room computes the result once both accept.
- **Resilient**: automatic reconnection with backoff, opponent presence (online or disconnected), rematches with colours swapped, and rooms expire after a week without activity.
- **Cheap to run**: the WebSocket Hibernation API lets idle rooms leave memory without dropping connections.

The protocol is defined in [`src/online/protocol.ts`](src/online/protocol.ts), shared by browser and server. [`scripts/online-smoke.ts`](scripts/online-smoke.ts) tests a running server end to end over real WebSockets, 45 checks in all, including:
- out-of-turn, illegal and malformed moves
- spectators
- reconnecting with the right or a wrong token
- resign, and rematch with swapped colours
- unknown rooms and cross-origin room creation

## Running it

```sh
npm install
npm run dev          # the app, on http://localhost:5173
npm run dev:api      # in a second terminal: the Worker for online play (Vite proxies /api to it)
npm test             # engine + bot tests
npm run test:online  # online end-to-end test (needs dev:api running)
npx vite-node scripts/bench.ts   # bot speed and head-to-head matches
npm run deploy       # build and deploy to Cloudflare
```

Regenerating the reference games needs Python 3 and the `original` branch:

```sh
python3 scripts/gen_fixtures.py > src/engine/fixtures.json
```

## Project structure

```
src/engine/board.ts      rules: moves, captures, ko, suicide, scoring
src/engine/engine.test   differential tests against the original Python engine
src/bot/mcts.ts          Monte Carlo Tree Search with RAVE and priors
src/bot/worker.ts        runs the bot off the main thread
src/game/useGame.ts      local/bot games: state, history/undo, talking to the bot
src/online/              protocol and the online game hook (WebSocket, reconnection)
src/components/          SVG board, game screen, menu screens
worker/index.ts          Cloudflare Worker: static files + room API
worker/room.ts           Durable Object: one authoritative game room
```

## Roadmap

- Undo requests in online games (the opponent approves)
- Resuming play from the scoring phase when players disagree about which stones are dead
- Game records (SGF) export
