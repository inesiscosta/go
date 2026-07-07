# Go

This is the board game Go free for you to play in your browser: against a Monte Carlo Tree Search bot, a friend on the same screen, or a friend online.

Go has been played for over 2,500 years: two players take turns placing black and white stones on a grid, each trying to surround more territory than the other. The rules fit on a napkin, but the strategy is famously deep.

## Why?
This started as a text-based Python game for my first-year Foundations of Programming course (2023/24), where the goal was to learn and practise abstract data types. That version is kept, untouched, in the [`original`](../../tree/original) branch and you can still [play it](https://go.inesiscosta.com/?classic), unchanged, in your browser thanks to [Pyodide](https://pyodide.org). 

However to pay it a proper homage but make it more interactive I decided to give it a GUI with React. The rules engine was ported to TypeScript and rebuilt around a flat, padded board array so the bot can simulate thousands of games per second. 

To make sure nothing changed in translation, [`scripts/gen_fixtures.py`](scripts/gen_fixtures.py) loads the **original Python engine**, plays random games with it, and records every position's legal moves, board and score and the TypeScript engine has to reproduce all 2,538 positions exactly ([`engine.test.ts`](src/engine/engine.test.ts)).

## The Bot

[`src/bot/mcts.ts`](src/bot/mcts.ts) is a Monte Carlo Tree Search player, inspired by Petr Baudiš's [michi](https://github.com/pasky/michi). It plays out thousands of quick games from the current position (about 7,000 a second on 9×9), guided by basic Go sense: capture stones in atari, save your own, never fill your own eyes. RAVE lets each game teach it about every move played in it, so it learns fast. It's a solid opponent for beginners on 9×9 and plays a looser game on 19×19.

## Online play

Each room is a [Durable Object](https://developers.cloudflare.com/durable-objects/) ([`worker/room.ts`](worker/room.ts)), a small stateful server that both players connect to over WebSockets.

- **The server owns the game.** It checks every move with the same rules engine the browser uses, so a modified client can't cheat.
- **Your seat stays yours.** Joining gives you a secret token (only its hash is stored), so a refresh gets your seat back, and anyone else with the link just watches.
- **Fair endings.** Both players must agree on the dead stones before a game is scored, and the clocks run on server time.
- **Resilient and cheap.** It reconnects automatically, offers rematches, and lets idle rooms sleep without dropping connections.

## Running it

```sh
npm install
npm run dev       # the app, on http://localhost:5173
npm run dev:api   # in a second terminal: the Worker for online play
```

## Contributing

Found something missing or broken? Feel free to [open an issue](https://github.com/inesiscosta/Go/issues)
or, even better, a [pull request](https://github.com/inesiscosta/Go/pulls).
