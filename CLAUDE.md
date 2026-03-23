# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Bomb Chip — multiplayer game server (Node.js, ESM). Two players place bombs on a 3×5 grid, then take turns guessing opponent's bomb positions. Written primarily in Russian (comments, docs, variable context).

## Commands

```bash
npm install          # Install dependencies
node index.js        # Start the server (PORT from .env, default 3000)
```

No test runner configured. `test_fixes.js` is a manual test/fix script, not part of a test suite.

## Architecture

**Monolithic server** — nearly all logic lives in `index.js` (~2500 lines):
- **HTTP endpoints**: `/register`, `/login`, `/firebase-login`, `/` (health check)
- **WebSocket server**: All game communication — matchmaking, gameplay, shop, friends, reconnect
- **Database**: PostgreSQL via `pg.Pool`, connection config from `.env`
- **Auth**: Firebase Admin SDK (Google sign-in) + email/password with bcrypt. JWT tokens (`1d` expiry) for sessions.

**`gameEngine.js`** — Pure game logic class (`GameEngine`). Phases: `placing_bombs` → `playing` → `finished`. Handles bomb placement validation, move resolution, turn management, animations. No I/O — all side effects happen in `index.js`.

**`botPlayer.js`** — Bot opponent: random name, random bomb placement, random cell selection. Bot IDs are negative numbers (decremented counter).

## Key Data Structures (in-memory, index.js)

- `activeGames: Map<roomId, GameEngine>` — active game instances
- `roomState: Map<roomId, {status, arenaId, bet, player1Id, ...}>` — room lifecycle tracking. Statuses: `invite_window` → `searching` → `matched` → `playing` → `rematch_countdown`
- `waitingRooms: Map<"arenaId_bet", roomId[]>` — matchmaking queue grouped by arena+bet
- `activeBots: Map<roomId, botObject>` — bot instances per room

## Database Schema

Tables (inferred from queries + migrations): `users`, `rooms`, `arenas`, `shop_items`, `user_items`, `user_customization`, `friendships`, `friend_requests`.

Customization slots: `model_id`, `item_model_id`, `skin_id`, `effect_id`, `animation_hit_id`, `animation_miss_id`, `animation_win_id`, `animation_lose_id` — all reference `shop_items(id)`.

Migrations are plain SQL files in root: `migration_001_arenas.sql`, `migration_002_animations.sql`. Run manually against PostgreSQL.

## WebSocket Protocol

All messages are JSON with `{type, payload}` structure. Client sends actions like `find_game`, `place_bombs`, `make_move`, `buy_item`, `equip_item`, `send_friend_request`, etc. Server responds with typed messages. Full protocol documented in `Bomb_Chip.md`.

## Important Patterns

- All player IDs are coerced to `Number()` at boundaries (GameEngine constructor, methods, WebSocket handlers) to avoid string/number mismatches.
- Game timers: 20s for bomb placement, 15s per move, 5s rematch countdown. Managed via `setInterval`/`setTimeout` in `index.js`.
- Bets are deducted at room creation; winner receives `bet * 2`. Balance checks happen before rematch.
- `broadcast(roomId, data)` sends to all WebSocket clients with matching `roomId`.
- Reconnect: clients can rejoin via `reconnect` message type; `GameEngine.getStateForPlayer()` provides state recovery.

## Environment

Configured via `.env`: `PORT`, `JWT_SECRET`, `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`. Firebase service account JSON in root (gitignored).
