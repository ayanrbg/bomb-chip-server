import admin from "firebase-admin";
import serviceAccount from "./bomb-chip-75701-firebase-adminsdk-fbsvc-bdb95a9e4d.json" with { type: "json" };

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

import { GameEngine } from "./gameEngine.js";
import { createBot, botPlaceBombs, botChooseCell } from "./botPlayer.js";

const activeGames = new Map();
const roomCountdowns = new Map();

// ===== Grid defaults =====
const DEFAULT_GRID_ROWS = 3;
const DEFAULT_GRID_COLS = 5;
const DEFAULT_BOMB_COUNT = 3;

// ===== Новая Matchmaking система =====
// roomState: roomId -> { status, arenaId, bet, player1Id, player1Ws, isPrivate, inviteTimer, botTimer, gridRows, gridCols, bombCount }
// status: 'invite_window' | 'private_waiting' | 'searching' | 'matched' | 'playing'
const roomState = new Map();

// waitingRooms: key(`${arenaId}_${bet}`) -> Array<roomId>
const waitingRooms = new Map();

// activeBots: roomId -> bot object
const activeBots = new Map();

// Debounce timer for arena_queue_update broadcast
let arenaQueueBroadcastTimer = null;

import express from "express";
import http from "http";
import { WebSocketServer } from "ws";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import dotenv from "dotenv";
dotenv.config();
import pkg from "pg";
const { Pool } = pkg;

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME
});

const app = express();
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// ===== HTTP: Firebase Login =====
app.post("/firebase-login", async (req, res) => {
  const { idToken } = req.body;

  if (!idToken) {
    return res.status(400).json({ error: "Missing idToken" });
  }

  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const firebaseUid = decodedToken.uid;
    const email = decodedToken.email;
    const name = decodedToken.name || "Player";

    let userResult = await pool.query(
      "SELECT * FROM users WHERE firebase_uid = $1",
      [firebaseUid]
    );

    let user;

    if (userResult.rows.length === 0) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        const insert = await client.query(
          `INSERT INTO users (email, nickname, firebase_uid, balance)
           VALUES ($1, $2, $3, 1000)
           RETURNING id, nickname`,
          [email, name, firebaseUid]
        );

        user = insert.rows[0];

        const randomSkinResult = await client.query(`
          SELECT id FROM shop_items
          WHERE code IN ('default_skin1','default_skin2','default_skin3')
          ORDER BY RANDOM()
          LIMIT 1
        `);

        if (randomSkinResult.rows.length === 0) {
          throw new Error("No default skins found");
        }

        const randomSkinId = randomSkinResult.rows[0].id;

        await client.query(`
          INSERT INTO user_customization
          (user_id, model_id, item_model_id, skin_id, effect_id, animation_hit_id, animation_miss_id, animation_win_id, animation_lose_id)
          VALUES (
            $1,
            (SELECT id FROM shop_items WHERE code = 'character_default' LIMIT 1),
            (SELECT id FROM shop_items WHERE code = 'default_chip' LIMIT 1),
            $2,
            (SELECT id FROM shop_items WHERE code = 'default_effect'),
            (SELECT id FROM shop_items WHERE code = 'default_anim' LIMIT 1),
            (SELECT id FROM shop_items WHERE code = 'default_anim_miss' LIMIT 1),
            (SELECT id FROM shop_items WHERE code = 'default_anim_win' LIMIT 1),
            (SELECT id FROM shop_items WHERE code = 'default_anim_lose' LIMIT 1)
          )
        `, [user.id, randomSkinId]);

        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    } else {
      user = userResult.rows[0];
    }

    const token = jwt.sign(
      { id: user.id, nickname: user.nickname },
      process.env.JWT_SECRET,
      { expiresIn: "1d" }
    );

    res.json({ token });
  } catch (err) {
    console.error(err);
    res.status(401).json({ error: "Invalid Firebase token" });
  }
});

// ===== HTTP: Health Check =====
app.get("/", (req, res) => {
  res.send("Server is running");
});

// ===== HTTP: Register =====
app.post("/register", async (req, res) => {
  const client = await pool.connect();

  try {
    const { email, password, nickname } = req.body;

    if (!email || typeof email !== "string" || !email.includes("@") || email.length > 255) {
      client.release();
      return res.status(400).json({ error: "Invalid email" });
    }

    if (!password || typeof password !== "string" || password.length < 6 || password.length > 128) {
      client.release();
      return res.status(400).json({ error: "Password must be 6-128 characters" });
    }

    if (!nickname || typeof nickname !== "string" || nickname.trim().length < 1 || nickname.length > 30) {
      client.release();
      return res.status(400).json({ error: "Nickname must be 1-30 characters" });
    }

    await client.query("BEGIN");

    const existing = await client.query(
      "SELECT id FROM users WHERE email = $1",
      [email]
    );

    if (existing.rows.length > 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Email already exists" });
    }

    const hashed = await bcrypt.hash(password, 10);

    const result = await client.query(
      `INSERT INTO users (email, password, nickname, balance)
       VALUES ($1,$2,$3,1000)
       RETURNING id,nickname`,
      [email, hashed, nickname]
    );

    const user = result.rows[0];

    const skinResult = await client.query(`
      SELECT id FROM shop_items
      WHERE code IN ('default_skin1','default_skin2','default_skin3')
      ORDER BY RANDOM()
      LIMIT 1
    `);

    const skinId = skinResult.rows[0].id;

    await client.query(`
      INSERT INTO user_customization
      (user_id, model_id, item_model_id, skin_id, effect_id, animation_hit_id, animation_miss_id, animation_win_id, animation_lose_id)
      VALUES (
        $1,
        (SELECT id FROM shop_items WHERE code = 'character_default' LIMIT 1),
        (SELECT id FROM shop_items WHERE code = 'default_chip' LIMIT 1),
        $2,
        (SELECT id FROM shop_items WHERE code = 'default_effect'),
        (SELECT id FROM shop_items WHERE code = 'default_anim' LIMIT 1),
        (SELECT id FROM shop_items WHERE code = 'default_anim_miss' LIMIT 1),
        (SELECT id FROM shop_items WHERE code = 'default_anim_win' LIMIT 1),
        (SELECT id FROM shop_items WHERE code = 'default_anim_lose' LIMIT 1)
      )
    `, [user.id, skinId]);

    await client.query("COMMIT");

    const token = jwt.sign(
      { id: user.id, nickname: user.nickname },
      process.env.JWT_SECRET,
      { expiresIn: "1d" }
    );

    res.json({ token });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: "Server error" });
  } finally {
    client.release();
  }
});

// ===== HTTP: Login =====
app.post("/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || typeof email !== "string" || !password || typeof password !== "string") {
    return res.status(400).json({ error: "Email and password required" });
  }

  try {
    const result = await pool.query(
      "SELECT * FROM users WHERE email = $1",
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: "User not found" });
    }

    const user = result.rows[0];

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(401).json({ error: "Wrong password" });
    }

    const token = jwt.sign(
      { id: user.id, nickname: user.nickname },
      process.env.JWT_SECRET,
      { expiresIn: "1d" }
    );

    res.json({ token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// ====================================================
// ===== GAME HELPER FUNCTIONS =====
// ====================================================

function broadcast(roomId, data) {
  wss.clients.forEach(client => {
    if (client.roomId === roomId && client.readyState === 1) {
      client.send(JSON.stringify(data));
    }
  });
}

function findWsByUserId(userId) {
  for (const client of wss.clients) {
    if (client.user?.id === userId && client.readyState === 1) {
      return client;
    }
  }
  return null;
}

async function finishGame(roomId, winnerId) {
  const game = activeGames.get(roomId);
  if (!game) return;

  game.phase = "finished";

  const bot = activeBots.get(roomId);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const roomResult = await client.query(
      "SELECT r.*, a.code as arena_code FROM rooms r LEFT JOIN arenas a ON r.arena_id = a.id WHERE r.id = $1 FOR UPDATE",
      [roomId]
    );

    if (roomResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return;
    }

    const room = roomResult.rows[0];
    const totalPrize = room.bet * 2;

    const playerIds = Object.keys(game.players).map(Number);
    const loserId = playerIds.find(id => id !== Number(winnerId));

    // Только реальный игрок получает приз
    let winnerNewBalance = null;
    if (!bot || Number(winnerId) !== bot.id) {
      const balResult = await client.query(
        "UPDATE users SET balance = balance + $1 WHERE id = $2 RETURNING balance",
        [totalPrize, winnerId]
      );
      winnerNewBalance = balResult.rows[0].balance;
    }

    await client.query(
      "DELETE FROM rooms WHERE id = $1",
      [roomId]
    );

    await client.query("COMMIT");

    const animations = game.getFinishAnimations(winnerId, loserId);

    const payload = {
      winnerId,
      loserId,
      prize: totalPrize,
      animations
    };

    if (room.arena_id) {
      payload.arenaId = room.arena_id;
      payload.arenaCode = room.arena_code;
    }

    // Send newBalance individually to winner and clear roomId
    wss.clients.forEach(c => {
      if (c.roomId !== roomId || !c.user) return;
      const msg = { type: "game_finished", payload: { ...payload } };
      if (c.user.id === Number(winnerId) && winnerNewBalance !== null) {
        msg.payload.newBalance = winnerNewBalance;
      }
      c.send(JSON.stringify(msg));
      c.roomId = null;
    });

  } catch (err) {
    await client.query("ROLLBACK");
    console.error("finishGame error:", err);
  } finally {
    client.release();
  }

  // Cleanup bot
  if (bot) activeBots.delete(roomId);
  roomState.delete(roomId);
}

function cleanupGame(roomId) {
  const game = activeGames.get(roomId);
  if (!game) return;

  if (game.moveTimer) {
    clearInterval(game.moveTimer);
    game.moveTimer = null;
  }

  if (game.bombsTimer) {
    clearInterval(game.bombsTimer);
    game.bombsTimer = null;
  }

  activeGames.delete(roomId);
}

function startBombsTimer(roomId) {
  const game = activeGames.get(roomId);
  if (!game) return;
  if (game.bombsTimer) return;

  game.bombsTimeLeft = 20;

  game.bombsTimer = setInterval(() => {
    if (game.phase === "finished") {
      clearInterval(game.bombsTimer);
      game.bombsTimer = null;
      return;
    }

    game.bombsTimeLeft = Math.max(0, game.bombsTimeLeft - 2);

    broadcast(roomId, {
      type: "bombs_phase_update",
      payload: { timeLeft: game.bombsTimeLeft }
    });

    if (game.bombsTimeLeft === 0) {
      clearInterval(game.bombsTimer);
      game.bombsTimer = null;
      finishBombsPhase(roomId);
    }
  }, 2000);
}

function finishBombsPhase(roomId) {
  const game = activeGames.get(roomId);
  if (!game) return;

  // Авто-расстановка для тех кто не поставил (включая ботов — на случай если таймер сработал раньше)
  Object.entries(game.players).forEach(([playerId, player]) => {
    if (player.bombs.length < game.bombCount) {
      const available = [];
      for (let i = 0; i < game.totalCells; i++) {
        if (!player.bombs.includes(i)) {
          available.push(i);
        }
      }

      while (player.bombs.length < game.bombCount) {
        const rand = available.splice(
          Math.floor(Math.random() * available.length), 1
        )[0];
        player.bombs.push(rand);
      }
    }
  });

  game.phase = "playing";
  broadcast(roomId, { type: "bombs_phase_finished" });
  startMoveTimer(roomId);
}

async function autoMove(roomId) {
  const game = activeGames.get(roomId);
  if (!game) return;

  if (game.processingMove) return;
  game.processingMove = true;

  try {
    clearInterval(game.moveTimer);
    game.moveTimer = null;

    const opponentId = Object.keys(game.players)
      .map(Number)
      .find(id => id !== game.turn);

    const opponent = game.players[opponentId];

    const available = [];
    for (let i = 0; i < game.totalCells; i++) {
      if (!opponent.revealed.has(i)) {
        available.push(i);
      }
    }

    if (available.length === 0) return;

    const randomCell = available[Math.floor(Math.random() * available.length)];

    const movingPlayerId = game.turn;
    const result = game.makeMove(movingPlayerId, randomCell);

    broadcast(roomId, {
      type: "move_result",
      payload: result
    });

    if (result.winner) {
      await finishGame(roomId, result.winner);
      cleanupGame(roomId);
    } else {
      startMoveTimer(roomId);
    }
  } finally {
    game.processingMove = false;
  }
}

function startMoveTimer(roomId) {
  const game = activeGames.get(roomId);
  if (!game) return;
  if (game.moveTimer) return;

  game.moveTimeLeft = 15;

  game.moveTimer = setInterval(() => {
    if (game.phase === "finished") {
      clearInterval(game.moveTimer);
      game.moveTimer = null;
      return;
    }

    game.moveTimeLeft = Math.max(0, game.moveTimeLeft - 2);

    broadcast(roomId, {
      type: "move_timer_update",
      payload: {
        timeLeft: game.moveTimeLeft,
        currentTurn: game.turn
      }
    });

    if (game.moveTimeLeft === 0) {
      clearInterval(game.moveTimer);
      game.moveTimer = null;
      autoMove(roomId);
    }
  }, 2000);

  sendTurnState(roomId);
}

function sendTurnState(roomId) {
  const game = activeGames.get(roomId);
  if (!game) return;

  const bot = activeBots.get(roomId);

  wss.clients.forEach(client => {
    if (client.roomId !== roomId) return;
    if (!client.user) return;

    const opponentId = Object.keys(game.players)
      .map(Number)
      .find(id => id !== client.user.id);

    const player = game.players[client.user.id];
    const opponent = game.players[opponentId];

    if (!player || !opponent) return;

    const availableCells = [];
    for (let i = 0; i < game.totalCells; i++) {
      if (!opponent.revealed.has(i)) {
        availableCells.push(i);
      }
    }

    if (game.turn === client.user.id) {
      client.send(JSON.stringify({
        type: "request_move",
        payload: {
          lives: {
            you: player.lives,
            opponent: opponent.lives
          },
          availableCells,
          timeLeft: game.moveTimeLeft
        }
      }));
    } else {
      client.send(JSON.stringify({
        type: "opponent_move",
        payload: {
          opponentId: game.turn,
          lives: {
            you: player.lives,
            opponent: opponent.lives
          },
          timeLeft: game.moveTimeLeft
        }
      }));
    }
  });

  // Если ход бота — планируем его ход
  if (bot && game.turn === bot.id) {
    scheduleBotMove(roomId);
  }
}

async function loadPlayerCustomization(playerId) {
  const result = await pool.query(`
    SELECT
      s_model.code as model_code,
      s_item_model.code as item_model_code,
      s_skin.code as skin_code,
      s_effect.code as effect_code,
      s_hit.code as animation_hit_code,
      s_miss.code as animation_miss_code,
      s_win.code as animation_win_code,
      s_lose.code as animation_lose_code
    FROM user_customization uc
    LEFT JOIN shop_items s_model ON uc.model_id = s_model.id
    LEFT JOIN shop_items s_item_model ON uc.item_model_id = s_item_model.id
    LEFT JOIN shop_items s_skin ON uc.skin_id = s_skin.id
    LEFT JOIN shop_items s_effect ON uc.effect_id = s_effect.id
    LEFT JOIN shop_items s_hit ON uc.animation_hit_id = s_hit.id
    LEFT JOIN shop_items s_miss ON uc.animation_miss_id = s_miss.id
    LEFT JOIN shop_items s_win ON uc.animation_win_id = s_win.id
    LEFT JOIN shop_items s_lose ON uc.animation_lose_id = s_lose.id
    WHERE uc.user_id = $1
  `, [playerId]);

  return result.rows[0] || {
    model_code: "character_default",
    item_model_code: "default_chip",
    skin_code: "default_skin1",
    effect_code: "default_effect",
    animation_hit_code: "default_anim",
    animation_miss_code: "default_anim_miss",
    animation_win_code: "default_anim_win",
    animation_lose_code: "default_anim_lose"
  };
}

// ====================================================
// ===== BOT ACTIONS =====
// ====================================================

function scheduleBotBombs(roomId) {
  const bot = activeBots.get(roomId);
  if (!bot) return;

  const delay = 2000 + Math.random() * 2000; // 2-4 сек
  setTimeout(() => {
    const game = activeGames.get(roomId);
    if (!game || game.phase !== "placing_bombs") return;

    // Если бот уже поставил бомбы, пропускаем
    if (game.players[bot.id]?.bombs?.length === game.bombCount) return;

    const bombs = botPlaceBombs(game.bombCount, game.totalCells);
    const result = game.placeBombs(bot.id, bombs);

    if (result.gameStarted) {
      clearInterval(game.bombsTimer);
      game.bombsTimer = null;
      broadcast(roomId, { type: "bombs_placed" });
      finishBombsPhase(roomId);
    }
  }, delay);
}

function scheduleBotMove(roomId) {
  const bot = activeBots.get(roomId);
  if (!bot) return;

  const delay = 1000 + Math.random() * 2000; // 1-3 сек
  setTimeout(async () => {
    const game = activeGames.get(roomId);
    if (!game || game.phase !== "playing") return;
    if (game.turn !== bot.id) return;

    if (game.processingMove) return;
    game.processingMove = true;

    try {
      const opponentId = Object.keys(game.players)
        .map(Number)
        .find(id => id !== bot.id);

      const opponent = game.players[opponentId];
      const cell = botChooseCell(opponent.revealed, game.totalCells);
      if (cell === null) return;

      const result = game.makeMove(bot.id, cell);

      broadcast(roomId, {
        type: "move_result",
        payload: result
      });

      if (result.winner) {
        await finishGame(roomId, result.winner);
        cleanupGame(roomId);
      } else {
        clearInterval(game.moveTimer);
        game.moveTimer = null;
        startMoveTimer(roomId);
      }
    } finally {
      game.processingMove = false;
    }
  }, delay);
}

// ====================================================
// ===== MATCHMAKING FUNCTIONS =====
// ====================================================

function addToWaitingQueue(roomId, arenaId, bet) {
  const key = `${arenaId}_${bet}`;
  if (!waitingRooms.has(key)) waitingRooms.set(key, []);
  waitingRooms.get(key).push(roomId);
}

function removeFromWaitingQueue(roomId, arenaId, bet) {
  const key = `${arenaId}_${bet}`;
  const rooms = waitingRooms.get(key);
  if (!rooms) return;

  const idx = rooms.indexOf(roomId);
  if (idx !== -1) rooms.splice(idx, 1);
  if (rooms.length === 0) waitingRooms.delete(key);
}

function getQueueCounts() {
  const counts = new Map();
  for (const [key, rooms] of waitingRooms) {
    const arenaId = parseInt(key.split("_")[0]);
    counts.set(arenaId, (counts.get(arenaId) || 0) + rooms.length);
  }
  // Также считаем комнаты в invite_window как "в поиске" (searching уже в waitingRooms)
  for (const [, state] of roomState) {
    if (state.status === "invite_window") {
      const arenaId = state.arenaId;
      counts.set(arenaId, (counts.get(arenaId) || 0) + 1);
    }
  }

  const result = [];
  for (const [arenaId, total] of counts) {
    result.push({ arenaId, players_in_queue: total });
  }
  return result;
}

function broadcastArenaQueueUpdate() {
  if (arenaQueueBroadcastTimer) return;
  arenaQueueBroadcastTimer = setTimeout(() => {
    arenaQueueBroadcastTimer = null;

    const counts = getQueueCounts();
    const msg = JSON.stringify({
      type: "arena_queue_update",
      payload: counts
    });

    wss.clients.forEach(client => {
      if (client.readyState === 1 && !client.roomId) {
        client.send(msg);
      }
    });
  }, 2000);
}

// Попытаться найти оппонента в очереди или встать в очередь
async function tryMatchOrQueue(roomId) {
  const state = roomState.get(roomId);
  if (!state || state.status !== "searching") return;

  const { arenaId, bet } = state;
  const key = `${arenaId}_${bet}`;

  // Ищем другую комнату в очереди
  const waitingList = waitingRooms.get(key);
  if (waitingList && waitingList.length > 0) {
    const otherRoomId = waitingList.shift();
    if (waitingList.length === 0) waitingRooms.delete(key);

    const otherState = roomState.get(otherRoomId);
    if (!otherState || otherState.status !== "searching") {
      // Другая комната уже не актуальна — пробуем снова
      return tryMatchOrQueue(roomId);
    }

    // Отменяем таймер бота у другой комнаты
    if (otherState.botTimer) {
      clearTimeout(otherState.botTimer);
      otherState.botTimer = null;
    }

    // Перемещаем текущего игрока в другую (уже ожидающую) комнату
    const currentPlayerWs = state.player1Ws;
    const currentPlayerId = state.player1Id;

    try {
      // Обновляем другую комнату — добавляем гостя
      await pool.query(
        "UPDATE rooms SET guest_id = $1 WHERE id = $2",
        [currentPlayerId, otherRoomId]
      );

      // Удаляем текущую комнату из БД
      await pool.query("DELETE FROM rooms WHERE id = $1", [roomId]);

      // Обновляем WS
      currentPlayerWs.roomId = otherRoomId;

      // Удаляем state текущей комнаты
      roomState.delete(roomId);

      // Подключаем игроков
      await matchPlayers(otherRoomId, otherState, currentPlayerWs, currentPlayerId);

    } catch (err) {
      console.error("tryMatchOrQueue error:", err);
    }

    broadcastArenaQueueUpdate();
    return;
  }

  // Нет матча — встаём в очередь
  addToWaitingQueue(roomId, arenaId, bet);

  // Запускаем таймер бота (5 секунд)
  state.botTimer = setTimeout(async () => {
    const currentState = roomState.get(roomId);
    if (!currentState || currentState.status !== "searching") return;

    // Убираем из очереди
    removeFromWaitingQueue(roomId, arenaId, bet);

    // Подключаем бота
    await connectBot(roomId);
  }, 5000);

  broadcastArenaQueueUpdate();
}

// Подключить двух реальных игроков
async function matchPlayers(roomId, state, opponentWs, opponentId) {
  state.status = "matched";

  const hostWs = state.player1Ws;
  const hostId = state.player1Id;

  // Загружаем кастомизацию обоих
  const [custom1, custom2] = await Promise.all([
    loadPlayerCustomization(hostId),
    loadPlayerCustomization(opponentId)
  ]);

  // Получаем инфо об арене
  const arenaResult = await pool.query(
    "SELECT code, name FROM arenas WHERE id = $1",
    [state.arenaId]
  );
  const arena = arenaResult.rows[0];

  // Никнейм оппонента
  const opponentNickResult = await pool.query(
    "SELECT nickname FROM users WHERE id = $1",
    [opponentId]
  );
  const opponentNickname = opponentNickResult.rows[0]?.nickname || "Player";

  const hostNickname = hostWs.user?.nickname || "Player";

  const gridRows = state.gridRows || DEFAULT_GRID_ROWS;
  const gridCols = state.gridCols || DEFAULT_GRID_COLS;
  const bombCount = state.bombCount || DEFAULT_BOMB_COUNT;

  // Уведомляем обоих
  if (hostWs.readyState === 1) {
    hostWs.send(JSON.stringify({
      type: "opponent_joined",
      payload: {
        roomId,
        arenaId: state.arenaId,
        arenaCode: arena?.code,
        bet: state.bet,
        opponent: {
          id: opponentId,
          nickname: opponentNickname,
          model_code: custom2.model_code || "character_default",
          item_model_code: custom2.item_model_code || "default_chip",
          skin_code: custom2.skin_code,
          effect_code: custom2.effect_code
        },
        gridRows,
        gridCols,
        bombCount
      }
    }));
  }

  if (opponentWs.readyState === 1) {
    opponentWs.send(JSON.stringify({
      type: "opponent_joined",
      payload: {
        roomId,
        arenaId: state.arenaId,
        arenaCode: arena?.code,
        bet: state.bet,
        opponent: {
          id: hostId,
          nickname: hostNickname,
          model_code: custom1.model_code || "character_default",
          item_model_code: custom1.item_model_code || "default_chip",
          skin_code: custom1.skin_code,
          effect_code: custom1.effect_code
        },
        gridRows,
        gridCols,
        bombCount
      }
    }));
  }

  startGameCountdown(roomId);
}

// Подключить бота
async function connectBot(roomId) {
  const state = roomState.get(roomId);
  if (!state) return;

  const bot = createBot();
  activeBots.set(roomId, bot);
  state.status = "matched";

  const hostWs = state.player1Ws;

  // Загружаем кастомизацию игрока
  const custom1 = await loadPlayerCustomization(state.player1Id);

  // Получаем инфо об арене
  const arenaResult = await pool.query(
    "SELECT code, name FROM arenas WHERE id = $1",
    [state.arenaId]
  );
  const arena = arenaResult.rows[0];

  const gridRows = state.gridRows || DEFAULT_GRID_ROWS;
  const gridCols = state.gridCols || DEFAULT_GRID_COLS;
  const bombCount = state.bombCount || DEFAULT_BOMB_COUNT;

  if (hostWs.readyState === 1) {
    hostWs.send(JSON.stringify({
      type: "opponent_joined",
      payload: {
        roomId,
        arenaId: state.arenaId,
        arenaCode: arena?.code,
        bet: state.bet,
        opponent: {
          id: bot.id,
          nickname: bot.nickname,
          model_code: bot.customization.model_code,
          item_model_code: bot.customization.item_model_code,
          skin_code: bot.customization.skin_code,
          effect_code: bot.customization.effect_code
        },
        gridRows,
        gridCols,
        bombCount
      }
    }));
  }

  startGameCountdown(roomId);
  broadcastArenaQueueUpdate();
}

// ===== Countdown к старту игры =====
function startGameCountdown(roomId) {
  if (roomCountdowns.has(roomId)) return;

  let timeLeft = 5;

  broadcast(roomId, {
    type: "game_countdown",
    payload: { timeLeft }
  });

  const interval = setInterval(async () => {
    timeLeft--;

    broadcast(roomId, {
      type: "game_countdown",
      payload: { timeLeft }
    });

    if (timeLeft <= 0) {
      clearInterval(interval);
      roomCountdowns.delete(roomId);
      try {
        await launchGame(roomId);
      } catch (err) {
        console.error("launchGame error for room", roomId, err);
      }
    }
  }, 1000);

  roomCountdowns.set(roomId, interval);
}

// ===== Запуск игры после countdown =====
async function launchGame(roomId) {
  console.log("[launchGame] starting for room", roomId);
  const state = roomState.get(roomId);
  if (!state) { console.log("[launchGame] no state for room", roomId); return; }

  const roomResult = await pool.query(
    "SELECT * FROM rooms WHERE id = $1",
    [roomId]
  );

  if (roomResult.rows.length === 0) { console.log("[launchGame] room not found in DB", roomId); return; }

  const room = roomResult.rows[0];
  const bot = activeBots.get(roomId);

  const player1Id = room.host_id;
  const player2Id = bot ? bot.id : room.guest_id;

  if (!player1Id || !player2Id) { console.log("[launchGame] missing player ids", { player1Id, player2Id, roomId }); return; }

  // Обновляем статус
  await pool.query(
    "UPDATE rooms SET status = 'playing' WHERE id = $1",
    [roomId]
  );
  state.status = "playing";

  // Рандомно выбираем кто ходит первым
  const ids = Math.random() < 0.5
    ? [player1Id, player2Id]
    : [player2Id, player1Id];

  const gridRows = state.gridRows || DEFAULT_GRID_ROWS;
  const gridCols = state.gridCols || DEFAULT_GRID_COLS;
  const bombCount = state.bombCount || DEFAULT_BOMB_COUNT;

  const game = new GameEngine(roomId, ids[0], ids[1], gridRows, gridCols, bombCount);

  // Загружаем кастомизацию
  const custom1 = await loadPlayerCustomization(player1Id);
  game.setCustomization(player1Id, custom1);

  if (bot) {
    game.setCustomization(bot.id, bot.customization);
  } else {
    const custom2 = await loadPlayerCustomization(player2Id);
    game.setCustomization(player2Id, custom2);
  }

  activeGames.set(roomId, game);

  console.log("[launchGame] broadcasting game_started for room", roomId);
  broadcast(roomId, { type: "game_started" });
  broadcast(roomId, {
    type: "request_bombs",
    payload: {
      gridRows: game.gridRows,
      gridCols: game.gridCols,
      bombCount: game.bombCount,
      timeLeft: game.bombsTimeLeft
    }
  });

  startBombsTimer(roomId);

  // Бот ставит бомбы
  if (bot) {
    scheduleBotBombs(roomId);
  }
}

// ===== Очистка комнаты (все таймеры, стейт) =====
function cleanupRoomState(roomId) {
  const state = roomState.get(roomId);
  if (!state) return;

  if (state.inviteTimer) {
    clearTimeout(state.inviteTimer);
    state.inviteTimer = null;
  }
  if (state.botTimer) {
    clearTimeout(state.botTimer);
    state.botTimer = null;
  }

  // Убираем из очереди если есть
  removeFromWaitingQueue(roomId, state.arenaId, state.bet);

  roomState.delete(roomId);
}

// Полная очистка комнаты: стейт + countdown + game + bot
function fullRoomCleanup(roomId) {
  if (roomCountdowns.has(roomId)) {
    clearInterval(roomCountdowns.get(roomId));
    roomCountdowns.delete(roomId);
  }

  cleanupGame(roomId);
  cleanupRoomState(roomId);

  if (activeBots.has(roomId)) {
    activeBots.delete(roomId);
  }
}

// ===== broadcastRoomInfo (для get_room_info и других) =====
async function broadcastRoomInfo(roomId) {
  const result = await pool.query(`
    SELECT
      r.id,
      r.status,
      r.bet,
      r.arena_id,
      p1.id as player1_id,
      p1.nickname as player1_nickname,
      p2.id as player2_id,
      p2.nickname as player2_nickname
    FROM rooms r
    LEFT JOIN users p1 ON r.host_id = p1.id
    LEFT JOIN users p2 ON r.guest_id = p2.id
    WHERE r.id = $1
  `, [roomId]);

  if (result.rows.length === 0) return;

  const room = result.rows[0];
  const state = roomState.get(roomId);
  const bot = activeBots.get(roomId);

  // Загружаем кастомизацию для model_code и item_model_code
  let p1Custom = null, p2Custom = null;
  if (room.player1_id) {
    p1Custom = await loadPlayerCustomization(room.player1_id);
  }
  if (room.player2_id) {
    p2Custom = await loadPlayerCustomization(room.player2_id);
  }

  const gridRows = state?.gridRows || DEFAULT_GRID_ROWS;
  const gridCols = state?.gridCols || DEFAULT_GRID_COLS;
  const bombCount = state?.bombCount || DEFAULT_BOMB_COUNT;

  const payload = {
    type: "room_info",
    payload: {
      id: room.id,
      status: state?.status || room.status,
      bet: room.bet,
      arenaId: room.arena_id,
      gridRows,
      gridCols,
      bombCount,
      player1: room.player1_id ? {
        id: room.player1_id,
        nickname: room.player1_nickname,
        model_code: p1Custom?.model_code || "character_default",
        item_model_code: p1Custom?.item_model_code || "default_chip"
      } : null,
      player2: bot ? {
        id: bot.id,
        nickname: bot.nickname,
        model_code: bot.customization.model_code,
        item_model_code: bot.customization.item_model_code,
        isBot: true
      } : (room.player2_id ? {
        id: room.player2_id,
        nickname: room.player2_nickname,
        model_code: p2Custom?.model_code || "character_default",
        item_model_code: p2Custom?.item_model_code || "default_chip"
      } : null)
    }
  };

  wss.clients.forEach(client => {
    if (client.roomId === roomId && client.readyState === 1) {
      client.send(JSON.stringify(payload));
    }
  });
}

// ====================================================
// ===== WebSocket =====
// ====================================================
wss.on("connection", async (ws, req) => {
  const url = new URL(req.url, "http://localhost");
  const token = url.searchParams.get("token");

  if (!token) {
    ws.close();
    return;
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    ws.user = {
      id: decoded.id,
      nickname: decoded.nickname
    };

    const balanceResult = await pool.query(
      "SELECT balance FROM users WHERE id = $1",
      [ws.user.id]
    );

    if (balanceResult.rows.length === 0) {
      ws.close();
      return;
    }

    const balance = balanceResult.rows[0].balance;

    ws.send(JSON.stringify({
      type: "authSuccess",
      payload: {
        userId: ws.user.id,
        balance: balance,
        nickname: ws.user.nickname
      }
    }));

    // Отправляем кастомизацию игроку
    const customizationResult = await pool.query(`
      SELECT
        s_model.code as model_code,
        s_item_model.code as item_model_code,
        uc.skin_id,
        s_skin.code as skin_code,
        (SELECT COUNT(*) FROM shop_items WHERE type='skin' AND id <= uc.skin_id) as skin_index,
        uc.effect_id,
        s_effect.code as effect_code,
        (SELECT COUNT(*) FROM shop_items WHERE type='effect' AND id <= uc.effect_id) as effect_index,
        uc.animation_hit_id,
        s_hit.code as animation_hit_code,
        uc.animation_miss_id,
        s_miss.code as animation_miss_code,
        uc.animation_win_id,
        s_win.code as animation_win_code,
        uc.animation_lose_id,
        s_lose.code as animation_lose_code
      FROM user_customization uc
      LEFT JOIN shop_items s_model ON uc.model_id = s_model.id
      LEFT JOIN shop_items s_item_model ON uc.item_model_id = s_item_model.id
      LEFT JOIN shop_items s_skin ON uc.skin_id = s_skin.id
      LEFT JOIN shop_items s_effect ON uc.effect_id = s_effect.id
      LEFT JOIN shop_items s_hit ON uc.animation_hit_id = s_hit.id
      LEFT JOIN shop_items s_miss ON uc.animation_miss_id = s_miss.id
      LEFT JOIN shop_items s_win ON uc.animation_win_id = s_win.id
      LEFT JOIN shop_items s_lose ON uc.animation_lose_id = s_lose.id
      WHERE uc.user_id = $1
    `, [ws.user.id]);

    ws.send(JSON.stringify({
      type: "user_customization",
      payload: customizationResult.rows[0]
    }));

    console.log("Connected:", ws.user.nickname);

  } catch (err) {
    ws.close();
    return;
  }

  // ====================================================
  // ===== MESSAGE HANDLERS =====
  // ====================================================
  ws.on("message", async (message) => {
    try {
      const data = JSON.parse(message);

      // ===== get_user_stats =====
      if (data.type === "get_user_stats") {
        const result = await pool.query(
          "SELECT id, email, nickname, created_at FROM users WHERE id = $1",
          [ws.user.id]
        );

        if (result.rows.length === 0) {
          ws.send(JSON.stringify({ type: "error", message: "User not found" }));
          return;
        }

        ws.send(JSON.stringify({
          type: "user_stats",
          payload: result.rows[0]
        }));
      }

      // ===== get_arenas =====
      if (data.type === "get_arenas") {
        try {
          const result = await pool.query(
            "SELECT id, code, name, min_bet, max_bet FROM arenas WHERE is_active = true ORDER BY sort_order"
          );

          const counts = getQueueCounts();
          const countMap = {};
          counts.forEach(c => { countMap[c.arenaId] = c.players_in_queue; });

          const arenas = result.rows.map(arena => ({
            ...arena,
            players_in_queue: countMap[arena.id] || 0
          }));

          ws.send(JSON.stringify({
            type: "arenas_list",
            payload: arenas
          }));
        } catch (err) {
          console.error(err);
          ws.send(JSON.stringify({ type: "error", message: "Failed to fetch arenas" }));
        }
      }

      // ====================================================
      // ===== PLAY — Главная кнопка "Играть" =====
      // ====================================================
      if (data.type === "play") {
        try {
          const { arenaId, bet } = data;

          // Валидация ставки
          if (bet == null || typeof bet !== "number" || !Number.isInteger(bet) || bet < 0) {
            return ws.send(JSON.stringify({ type: "error", message: "Invalid bet amount" }));
          }

          // Уже в комнате?
          if (ws.roomId) {
            return ws.send(JSON.stringify({ type: "error", message: "Already in a room" }));
          }

          // Валидация арены
          const arenaResult = await pool.query(
            "SELECT * FROM arenas WHERE id = $1 AND is_active = true",
            [arenaId]
          );

          if (arenaResult.rows.length === 0) {
            return ws.send(JSON.stringify({ type: "error", message: "Arena not found" }));
          }

          const arena = arenaResult.rows[0];

          if (bet < arena.min_bet || bet > arena.max_bet) {
            return ws.send(JSON.stringify({
              type: "error",
              message: `Bet must be between ${arena.min_bet} and ${arena.max_bet}`
            }));
          }

          // Списываем ставку атомарно
          const client = await pool.connect();
          let roomId;
          let newBalance;
          try {
            await client.query("BEGIN");

            const userResult = await client.query(
              "SELECT balance FROM users WHERE id = $1 FOR UPDATE",
              [ws.user.id]
            );

            if (userResult.rows[0].balance < bet) {
              await client.query("ROLLBACK");
              return ws.send(JSON.stringify({ type: "error", message: "Not enough balance" }));
            }

            newBalance = userResult.rows[0].balance;
            if (bet > 0) {
              const balResult = await client.query(
                "UPDATE users SET balance = balance - $1 WHERE id = $2 RETURNING balance",
                [bet, ws.user.id]
              );
              newBalance = balResult.rows[0].balance;
            }

            // Создаём комнату
            const roomResult = await client.query(
              `INSERT INTO rooms (host_id, bet, status, host_ready, guest_ready, arena_id)
               VALUES ($1, $2, 'waiting', false, false, $3)
               RETURNING id`,
              [ws.user.id, bet, arenaId]
            );

            roomId = roomResult.rows[0].id;

            await client.query("COMMIT");
          } catch (err) {
            await client.query("ROLLBACK");
            throw err;
          } finally {
            client.release();
          }

          ws.roomId = roomId;

          // Создаём state для комнаты
          const state = {
            status: "invite_window",
            arenaId,
            bet,
            player1Id: ws.user.id,
            player1Ws: ws,
            isPrivate: false,
            inviteTimer: null,
            botTimer: null,
            gridRows: DEFAULT_GRID_ROWS,
            gridCols: DEFAULT_GRID_COLS,
            bombCount: DEFAULT_BOMB_COUNT
          };

          roomState.set(roomId, state);

          // Отправляем клиенту
          ws.send(JSON.stringify({
            type: "room_created",
            payload: { roomId, arenaId, bet, newBalance }
          }));

          ws.send(JSON.stringify({
            type: "invite_window_start",
            payload: { seconds: 5 }
          }));

          // Таймер окна приглашений (5 сек)
          state.inviteTimer = setTimeout(async () => {
            const currentState = roomState.get(roomId);
            if (!currentState || currentState.status !== "invite_window") return;

            if (currentState.isPrivate) {
              // Приватная комната — ждём друга
              currentState.status = "private_waiting";

              ws.send(JSON.stringify({
                type: "invite_window_end",
                payload: { status: "private_waiting" }
              }));
            } else {
              // Публичная комната — переходим в поиск
              currentState.status = "searching";

              ws.send(JSON.stringify({
                type: "invite_window_end",
                payload: { status: "searching" }
              }));

              ws.send(JSON.stringify({
                type: "searching_opponent"
              }));

              // Ищем оппонента
              await tryMatchOrQueue(roomId);
            }
          }, 5000);

          broadcastArenaQueueUpdate();

        } catch (err) {
          console.error("play error:", err);
          ws.send(JSON.stringify({ type: "error", message: "Failed to start game" }));
        }
      }

      // ===== make_private — Сделать комнату приватной =====
      if (data.type === "make_private") {
        if (!ws.roomId) {
          return ws.send(JSON.stringify({ type: "error", message: "Not in a room" }));
        }

        const state = roomState.get(ws.roomId);
        if (!state || state.status !== "invite_window") {
          return ws.send(JSON.stringify({ type: "error", message: "Can only make private during invite window" }));
        }

        state.isPrivate = true;

        ws.send(JSON.stringify({
          type: "room_updated",
          payload: { isPrivate: true }
        }));
      }

      // ===== invite_friend — Пригласить друга =====
      if (data.type === "invite_friend") {
        if (!ws.roomId) {
          return ws.send(JSON.stringify({ type: "error", message: "Not in a room" }));
        }

        const state = roomState.get(ws.roomId);
        if (!state || (state.status !== "invite_window" && state.status !== "private_waiting")) {
          return ws.send(JSON.stringify({ type: "error", message: "Cannot invite now" }));
        }

        const friendId = Number(data.friendId);
        if (!friendId || friendId === ws.user.id) {
          return ws.send(JSON.stringify({ type: "error", message: "Invalid friend" }));
        }

        // Проверяем дружбу
        const friendCheck = await pool.query(`
          SELECT 1 FROM friends
          WHERE status = 'accepted'
            AND ((requester_id = $1 AND addressee_id = $2)
              OR (requester_id = $2 AND addressee_id = $1))
        `, [ws.user.id, friendId]);

        if (friendCheck.rows.length === 0) {
          return ws.send(JSON.stringify({ type: "error", message: "Not your friend" }));
        }

        // Сохраняем инвайт в БД
        await pool.query(
          `INSERT INTO game_invites (from_user_id, to_user_id, room_id)
           VALUES ($1, $2, $3)
           ON CONFLICT DO NOTHING`,
          [ws.user.id, friendId, ws.roomId]
        );

        // Уведомляем друга
        wss.clients.forEach(client => {
          if (client.user?.id === friendId && client.readyState === 1) {
            client.send(JSON.stringify({
              type: "game_invite_received",
              payload: {
                roomId: ws.roomId,
                from: ws.user.nickname,
                fromId: ws.user.id,
                bet: state.bet,
                arenaId: state.arenaId
              }
            }));
          }
        });

        ws.send(JSON.stringify({ type: "invite_sent" }));
      }

      // ===== accept_invite — Принять инвайт от друга =====
      if (data.type === "accept_invite") {
        const { roomId: inviteRoomId } = data;

        if (ws.roomId) {
          return ws.send(JSON.stringify({ type: "error", message: "Already in a room" }));
        }

        const state = roomState.get(inviteRoomId);
        if (!state || (state.status !== "invite_window" && state.status !== "private_waiting")) {
          return ws.send(JSON.stringify({ type: "error", message: "Room not available" }));
        }

        // Проверяем что есть инвайт
        const inviteCheck = await pool.query(
          "SELECT 1 FROM game_invites WHERE to_user_id = $1 AND room_id = $2",
          [ws.user.id, inviteRoomId]
        );

        if (inviteCheck.rows.length === 0) {
          return ws.send(JSON.stringify({ type: "error", message: "No invite for this room" }));
        }

        // Списываем ставку у друга
        let inviteNewBalance = null;
        const client = await pool.connect();
        try {
          await client.query("BEGIN");

          const userResult = await client.query(
            "SELECT balance FROM users WHERE id = $1 FOR UPDATE",
            [ws.user.id]
          );

          if (userResult.rows[0].balance < state.bet) {
            await client.query("ROLLBACK");
            return ws.send(JSON.stringify({ type: "error", message: "Not enough balance" }));
          }

          inviteNewBalance = userResult.rows[0].balance;
          if (state.bet > 0) {
            const balResult = await client.query(
              "UPDATE users SET balance = balance - $1 WHERE id = $2 RETURNING balance",
              [state.bet, ws.user.id]
            );
            inviteNewBalance = balResult.rows[0].balance;
          }

          // Добавляем в комнату
          await client.query(
            "UPDATE rooms SET guest_id = $1 WHERE id = $2",
            [ws.user.id, inviteRoomId]
          );

          // Удаляем инвайты
          await client.query(
            "DELETE FROM game_invites WHERE room_id = $1",
            [inviteRoomId]
          );

          await client.query("COMMIT");
        } catch (err) {
          await client.query("ROLLBACK");
          throw err;
        } finally {
          client.release();
        }

        // Отправляем newBalance принявшему инвайт
        ws.send(JSON.stringify({
          type: "balance_update",
          payload: { newBalance: inviteNewBalance }
        }));

        ws.roomId = inviteRoomId;

        // Отменяем invite timer
        if (state.inviteTimer) {
          clearTimeout(state.inviteTimer);
          state.inviteTimer = null;
        }

        // Подключаем игроков
        await matchPlayers(inviteRoomId, state, ws, ws.user.id);
      }

      // ===== cancel_play — Отменить поиск / выйти до игры =====
      if (data.type === "cancel_play") {
        if (!ws.roomId) {
          return ws.send(JSON.stringify({ type: "error", message: "Not in a room" }));
        }

        const roomId = ws.roomId;
        const state = roomState.get(roomId);

        if (!state) {
          return ws.send(JSON.stringify({ type: "error", message: "No room state" }));
        }

        // Нельзя отменить во время игры
        if (state.status === "playing") {
          return ws.send(JSON.stringify({ type: "error", message: "Game already started" }));
        }

        // Рефанд ставки
        let cancelNewBalance = null;
        const roomResult = await pool.query("SELECT bet FROM rooms WHERE id = $1", [roomId]);
        if (roomResult.rows.length > 0) {
          const bet = roomResult.rows[0].bet;
          if (bet > 0) {
            const balResult = await pool.query(
              "UPDATE users SET balance = balance + $1 WHERE id = $2 RETURNING balance",
              [bet, ws.user.id]
            );
            cancelNewBalance = balResult.rows[0].balance;
          } else {
            const balResult = await pool.query("SELECT balance FROM users WHERE id = $1", [ws.user.id]);
            cancelNewBalance = balResult.rows[0].balance;
          }
        }

        // Удаляем комнату
        await pool.query("DELETE FROM rooms WHERE id = $1", [roomId]);

        // Полная очистка
        fullRoomCleanup(roomId);

        ws.roomId = null;

        ws.send(JSON.stringify({
          type: "play_cancelled",
          payload: { refunded: true, newBalance: cancelNewBalance }
        }));

        broadcastArenaQueueUpdate();
      }

      // ===== leave_room — Выход из комнаты =====
      if (data.type === "leave_room") {
        try {
          if (!ws.roomId) {
            return ws.send(JSON.stringify({ type: "error", message: "You are not in a room" }));
          }

          const roomId = ws.roomId;
          const state = roomState.get(roomId);

          const roomResult = await pool.query("SELECT * FROM rooms WHERE id = $1", [roomId]);
          if (roomResult.rows.length === 0) {
            ws.roomId = null;
            return;
          }

          const room = roomResult.rows[0];
          const bot = activeBots.get(roomId);

          // ===== ВО ВРЕМЯ ИГРЫ =====
          if (state?.status === "playing" || room.status === "playing") {
            // Определяем победителя
            let winnerId;
            if (bot) {
              winnerId = bot.id;
            } else {
              winnerId = room.host_id === ws.user.id ? room.guest_id : room.host_id;
            }

            if (winnerId && !bot) {
              // Реальный оппонент — он побеждает
              const totalPrize = room.bet * 2;
              const client = await pool.connect();
              let winnerNewBalance = null;
              try {
                await client.query("BEGIN");
                const balResult = await client.query(
                  "UPDATE users SET balance = balance + $1 WHERE id = $2 RETURNING balance",
                  [totalPrize, winnerId]
                );
                winnerNewBalance = balResult.rows[0].balance;
                await client.query("DELETE FROM rooms WHERE id = $1", [roomId]);
                await client.query("COMMIT");
              } catch (err) {
                await client.query("ROLLBACK");
                throw err;
              } finally {
                client.release();
              }

              // Получаем arenaCode
              const arenaResult = await pool.query(
                "SELECT code FROM arenas WHERE id = $1", [room.arena_id]
              );
              const arenaCode = arenaResult.rows[0]?.code || null;

              // Уведомляем оппонента с полным payload
              const loserId = ws.user.id;
              wss.clients.forEach(c => {
                if (c.readyState === 1 && c.user?.id === winnerId) {
                  const finishPayload = {
                    winnerId,
                    loserId,
                    prize: totalPrize,
                    reason: "opponent_left",
                    newBalance: winnerNewBalance
                  };
                  if (room.arena_id) {
                    finishPayload.arenaId = room.arena_id;
                    finishPayload.arenaCode = arenaCode;
                  }
                  c.send(JSON.stringify({
                    type: "game_finished",
                    payload: finishPayload
                  }));
                  c.roomId = null;
                }
              });
            } else if (bot) {
              // Против бота — игрок проиграл (ставка уже списана)
              await pool.query("DELETE FROM rooms WHERE id = $1", [roomId]);
            }

            fullRoomCleanup(roomId);
            ws.roomId = null;

            return ws.send(JSON.stringify({ type: "left_room" }));
          }

          // ===== ВО ВРЕМЯ COUNTDOWN (matched) =====
          if (state?.status === "matched") {
            // Отменяем countdown
            if (roomCountdowns.has(roomId)) {
              clearInterval(roomCountdowns.get(roomId));
              roomCountdowns.delete(roomId);
            }

            // Очищаем game engine если создан
            cleanupGame(roomId);

            // Рефанд уходящему
            let countdownNewBalance = null;
            if (room.bet > 0) {
              const balResult = await pool.query(
                "UPDATE users SET balance = balance + $1 WHERE id = $2 RETURNING balance",
                [room.bet, ws.user.id]
              );
              countdownNewBalance = balResult.rows[0].balance;
            } else {
              const balResult = await pool.query("SELECT balance FROM users WHERE id = $1", [ws.user.id]);
              countdownNewBalance = balResult.rows[0].balance;
            }

            if (bot) {
              // Оппонент был бот — просто удаляем всё
              await pool.query("DELETE FROM rooms WHERE id = $1", [roomId]);
              fullRoomCleanup(roomId);
              ws.roomId = null;
              return ws.send(JSON.stringify({ type: "left_room", payload: { newBalance: countdownNewBalance } }));
            }

            // Оппонент реальный — он остаётся, комната переходит в поиск
            const remainingId = room.host_id === ws.user.id ? room.guest_id : room.host_id;

            if (remainingId) {
              // Обновляем комнату: оставшийся становится host
              await pool.query(
                "UPDATE rooms SET host_id = $1, guest_id = NULL WHERE id = $2",
                [remainingId, roomId]
              );

              // Обновляем state
              const remainingWs = findWsByUserId(remainingId);
              state.player1Id = remainingId;
              state.player1Ws = remainingWs;
              state.status = "searching";

              // Уведомляем оставшегося
              broadcast(roomId, {
                type: "countdown_cancelled",
                payload: { reason: "opponent_left" }
              });

              broadcast(roomId, {
                type: "searching_opponent"
              });

              // Снова ищем оппонента
              await tryMatchOrQueue(roomId);
            } else {
              await pool.query("DELETE FROM rooms WHERE id = $1", [roomId]);
              fullRoomCleanup(roomId);
            }

            ws.roomId = null;
            return ws.send(JSON.stringify({ type: "left_room", payload: { newBalance: countdownNewBalance } }));
          }

          // ===== ДО МАТЧА (invite_window / searching / private_waiting) =====
          // Рефанд
          let preMatchNewBalance = null;
          if (room.bet > 0) {
            const balResult = await pool.query(
              "UPDATE users SET balance = balance + $1 WHERE id = $2 RETURNING balance",
              [room.bet, ws.user.id]
            );
            preMatchNewBalance = balResult.rows[0].balance;
          } else {
            const balResult = await pool.query("SELECT balance FROM users WHERE id = $1", [ws.user.id]);
            preMatchNewBalance = balResult.rows[0].balance;
          }

          await pool.query("DELETE FROM rooms WHERE id = $1", [roomId]);
          fullRoomCleanup(roomId);

          ws.roomId = null;

          ws.send(JSON.stringify({ type: "left_room", payload: { newBalance: preMatchNewBalance } }));
          broadcastArenaQueueUpdate();

        } catch (err) {
          console.error(err);
          ws.send(JSON.stringify({ type: "error", message: "Failed to leave room" }));
        }
      }

      // ===== get_room_info =====
      if (data.type === "get_room_info") {
        try {
          if (!ws.roomId) {
            return ws.send(JSON.stringify({ type: "error", message: "You are not in a room" }));
          }

          await broadcastRoomInfo(ws.roomId);
        } catch (err) {
          console.error(err);
          ws.send(JSON.stringify({ type: "error", message: "Failed to fetch room info" }));
        }
      }

      // ===== place_bombs =====
      if (data.type === "place_bombs") {
        const game = activeGames.get(ws.roomId);
        if (!game) return;

        const maxCell = game.totalCells - 1;
        if (!Array.isArray(data.bombs) || data.bombs.length !== game.bombCount
            || !data.bombs.every(b => Number.isInteger(b) && b >= 0 && b <= maxCell)) {
          return ws.send(JSON.stringify({
            type: "error",
            message: `Invalid bombs: must be ${game.bombCount} integers 0-${maxCell}`
          }));
        }

        const result = game.placeBombs(ws.user.id, data.bombs);

        if (result.error) {
          return ws.send(JSON.stringify({
            type: "error",
            message: result.error
          }));
        }

        if (result.gameStarted) {
          clearInterval(game.bombsTimer);
          game.bombsTimer = null;
          broadcast(ws.roomId, { type: "bombs_placed" });
          finishBombsPhase(ws.roomId);
        }
      }

      // ===== make_move =====
      if (data.type === "make_move") {
        const game = activeGames.get(ws.roomId);
        if (!game) return;

        const cell = Number(data.cell);
        if (!Number.isInteger(cell) || cell < 0 || cell >= game.totalCells) {
          return ws.send(JSON.stringify({
            type: "error",
            message: "Invalid cell"
          }));
        }

        if (game.processingMove) return;
        game.processingMove = true;

        try {
          const result = game.makeMove(ws.user.id, cell);

          if (result.error) {
            ws.send(JSON.stringify({
              type: "error",
              message: result.error
            }));
            return;
          }

          broadcast(ws.roomId, {
            type: "move_result",
            payload: result
          });

          if (result.winner) {
            await finishGame(ws.roomId, result.winner);
            cleanupGame(ws.roomId);
            return;
          }

          clearInterval(game.moveTimer);
          game.moveTimer = null;
          startMoveTimer(ws.roomId);
        } finally {
          game.processingMove = false;
        }
      }

      // ===== reconnect =====
      if (data.type === "reconnect") {
        const roomResult = await pool.query(
          "SELECT * FROM rooms WHERE host_id = $1 OR guest_id = $1",
          [ws.user.id]
        );

        if (roomResult.rows.length === 0) {
          return ws.send(JSON.stringify({
            type: "reconnect_ok",
            payload: { inRoom: false }
          }));
        }

        const room = roomResult.rows[0];
        ws.roomId = room.id;

        // Обновляем ws в roomState
        const state = roomState.get(room.id);
        if (state && state.player1Id === ws.user.id) {
          state.player1Ws = ws;
        }

        ws.send(JSON.stringify({
          type: "reconnect_ok",
          payload: {
            inRoom: true,
            roomId: room.id,
            status: state?.status || room.status
          }
        }));

        await broadcastRoomInfo(room.id);

        if (activeGames.has(room.id)) {
          const game = activeGames.get(room.id);

          if (game.disconnected) {
            delete game.disconnected[ws.user.id];
          }

          const boardState = game.getStateForPlayer(ws.user.id);

          // Получаем данные оппонента для восстановления
          const opponentId = Object.keys(game.players)
            .map(Number)
            .find(id => id !== ws.user.id);

          let opponentData = null;
          const reconnectBot = activeBots.get(room.id);
          if (reconnectBot && reconnectBot.id === opponentId) {
            opponentData = {
              id: reconnectBot.id,
              nickname: reconnectBot.nickname,
              model_code: reconnectBot.customization.model_code,
              item_model_code: reconnectBot.customization.item_model_code,
              skin_code: reconnectBot.customization.skin_code,
              effect_code: reconnectBot.customization.effect_code
            };
          } else if (opponentId) {
            const oppResult = await pool.query("SELECT nickname FROM users WHERE id = $1", [opponentId]);
            const oppCustom = await loadPlayerCustomization(opponentId);
            opponentData = {
              id: opponentId,
              nickname: oppResult.rows[0]?.nickname || "Player",
              model_code: oppCustom.model_code || "character_default",
              item_model_code: oppCustom.item_model_code || "default_chip",
              skin_code: oppCustom.skin_code,
              effect_code: oppCustom.effect_code
            };
          }

          ws.send(JSON.stringify({
            type: "game_state_restore",
            payload: {
              phase: game.phase,
              turn: game.turn,
              bombsTimeLeft: game.bombsTimeLeft,
              moveTimeLeft: game.moveTimeLeft,
              gridRows: game.gridRows,
              gridCols: game.gridCols,
              bombCount: game.bombCount,
              opponent: opponentData,
              board: boardState
            }
          }));

          sendTurnState(room.id);
        }
      }

      // ===== SHOP: equip_item =====
      if (data.type === "equip_item") {
        const { itemId } = data;

        const itemResult = await pool.query(
          "SELECT * FROM shop_items WHERE id = $1",
          [itemId]
        );

        if (itemResult.rows.length === 0) {
          return ws.send(JSON.stringify({ type: "error", message: "Item not found" }));
        }

        const item = itemResult.rows[0];

        const ownership = await pool.query(
          "SELECT * FROM user_items WHERE user_id = $1 AND item_id = $2",
          [ws.user.id, itemId]
        );

        if (ownership.rows.length === 0 && item.price > 0) {
          return ws.send(JSON.stringify({ type: "error", message: "You do not own this item" }));
        }

        const allowedColumns = {
          model: "model_id",
          item_model: "item_model_id",
          skin: "skin_id",
          effect: "effect_id",
          animation_hit: "animation_hit_id",
          animation_miss: "animation_miss_id",
          animation_win: "animation_win_id",
          animation_lose: "animation_lose_id"
        };

        const column = allowedColumns[item.type];
        if (!column) {
          return ws.send(JSON.stringify({ type: "error", message: "Invalid item type" }));
        }

        await pool.query(
          `UPDATE user_customization SET ${column} = $1, updated_at = NOW() WHERE user_id = $2`,
          [itemId, ws.user.id]
        );

        ws.send(JSON.stringify({
          type: "equip_success",
          payload: { itemId }
        }));
      }

      // ===== SHOP: buy_item =====
      if (data.type === "buy_item") {
        const { itemId } = data;

        const itemResult = await pool.query(
          "SELECT * FROM shop_items WHERE id = $1",
          [itemId]
        );

        if (itemResult.rows.length === 0) return;

        const item = itemResult.rows[0];

        if (item.price <= 0) {
          return ws.send(JSON.stringify({ type: "error", message: "Item is free" }));
        }

        const alreadyOwned = await pool.query(
          "SELECT 1 FROM user_items WHERE user_id = $1 AND item_id = $2",
          [ws.user.id, itemId]
        );

        if (alreadyOwned.rows.length > 0) {
          return ws.send(JSON.stringify({ type: "error", message: "Item already owned" }));
        }

        const client = await pool.connect();
        try {
          await client.query("BEGIN");

          const userResult = await client.query(
            "SELECT balance FROM users WHERE id = $1 FOR UPDATE",
            [ws.user.id]
          );

          if (userResult.rows[0].balance < item.price) {
            await client.query("ROLLBACK");
            return ws.send(JSON.stringify({ type: "error", message: "Not enough balance" }));
          }

          const balResult = await client.query(
            "UPDATE users SET balance = balance - $1 WHERE id = $2 RETURNING balance",
            [item.price, ws.user.id]
          );

          await client.query(
            "INSERT INTO user_items (user_id, item_id) VALUES ($1,$2) ON CONFLICT DO NOTHING",
            [ws.user.id, itemId]
          );

          await client.query("COMMIT");

          ws.send(JSON.stringify({
            type: "purchase_success",
            payload: { itemId, newBalance: balResult.rows[0].balance }
          }));
        } catch (err) {
          await client.query("ROLLBACK");
          console.error(err);
          ws.send(JSON.stringify({ type: "error", message: "Purchase failed" }));
        } finally {
          client.release();
        }
      }

      // ===== SHOP: get_shop_items =====
      if (data.type === "get_shop_items") {
        const itemsResult = await pool.query(`
          SELECT id, code, name, type, price, currency
          FROM shop_items
          ORDER BY type, price
        `);

        const ownedResult = await pool.query(
          "SELECT item_id FROM user_items WHERE user_id = $1",
          [ws.user.id]
        );

        const ownedIds = new Set(ownedResult.rows.map(r => r.item_id));

        const customizationResult = await pool.query(`
          SELECT model_id, item_model_id, skin_id, effect_id, animation_hit_id, animation_miss_id, animation_win_id, animation_lose_id
          FROM user_customization
          WHERE user_id = $1
        `, [ws.user.id]);

        const active = customizationResult.rows[0] || {};

        const typeToColumn = {
          model: "model_id",
          item_model: "item_model_id",
          skin: "skin_id",
          effect: "effect_id",
          animation_hit: "animation_hit_id",
          animation_miss: "animation_miss_id",
          animation_win: "animation_win_id",
          animation_lose: "animation_lose_id"
        };

        const items = itemsResult.rows.map(item => {
          const isOwned = item.price === 0 || ownedIds.has(item.id);
          const col = typeToColumn[item.type];
          const isActive = col ? active[col] === item.id : false;

          return {
            id: item.id,
            code: item.code,
            name: item.name,
            type: item.type,
            price: item.price,
            currency: item.currency,
            owned: isOwned,
            active: isActive
          };
        });

        ws.send(JSON.stringify({
          type: "shop_items",
          payload: items
        }));
      }

      // ===== FRIENDS: send_friend_request =====
      if (data.type === "send_friend_request") {
        const targetId = Number(data.userId);
        if (targetId === ws.user.id) return;

        const existing = await pool.query(
          `SELECT * FROM friends WHERE requester_id = $1 AND addressee_id = $2`,
          [ws.user.id, targetId]
        );

        if (existing.rows.length > 0) {
          return ws.send(JSON.stringify({ type: "error", message: "Request already sent" }));
        }

        const result = await pool.query(
          `INSERT INTO friends (requester_id, addressee_id, status)
           VALUES ($1,$2,'pending')
           RETURNING *`,
          [ws.user.id, targetId]
        );

        wss.clients.forEach(client => {
          if (client.user?.id === targetId) {
            client.send(JSON.stringify({
              type: "friend_request_received",
              payload: result.rows[0]
            }));
          }
        });

        ws.send(JSON.stringify({ type: "friend_request_sent" }));
      }

      // ===== FRIENDS: accept_friend_request =====
      if (data.type === "accept_friend_request") {
        const requestId = data.requestId;

        const result = await pool.query(
          `UPDATE friends SET status = 'accepted'
           WHERE id = $1 AND addressee_id = $2
           RETURNING *`,
          [requestId, ws.user.id]
        );

        if (result.rows.length === 0) return;

        const request = result.rows[0];

        wss.clients.forEach(client => {
          if (client.user?.id === request.requester_id) {
            client.send(JSON.stringify({ type: "friend_request_accepted" }));
          }
        });

        ws.send(JSON.stringify({ type: "friend_added" }));
      }

      // ===== FRIENDS: get_friends =====
      if (data.type === "get_friends") {
        const result = await pool.query(`
          SELECT u.id, u.nickname
          FROM friends f
          JOIN users u
            ON (u.id = f.requester_id AND f.addressee_id = $1)
            OR (u.id = f.addressee_id AND f.requester_id = $1)
          WHERE f.status = 'accepted'
        `, [ws.user.id]);

        ws.send(JSON.stringify({
          type: "friends_list",
          payload: result.rows
        }));
      }

    } catch (err) {
      ws.send(JSON.stringify({ type: "error", message: "Invalid JSON" }));
    }
  });

  // ====================================================
  // ===== DISCONNECT HANDLER =====
  // ====================================================
  ws.on("close", async () => {
    const roomId = ws.roomId;
    if (!roomId) return;

    const state = roomState.get(roomId);

    // ===== Дисконнект до матча (invite_window / searching / private_waiting) =====
    if (state && (state.status === "invite_window" || state.status === "searching" || state.status === "private_waiting")) {
      try {
        const roomResult = await pool.query("SELECT bet FROM rooms WHERE id = $1", [roomId]);
        if (roomResult.rows.length > 0) {
          const bet = roomResult.rows[0].bet;
          if (bet > 0) {
            await pool.query(
              "UPDATE users SET balance = balance + $1 WHERE id = $2",
              [bet, ws.user.id]
            );
          }
        }

        await pool.query("DELETE FROM rooms WHERE id = $1", [roomId]);
        fullRoomCleanup(roomId);
        broadcastArenaQueueUpdate();
      } catch (err) {
        console.error("disconnect pre-match error:", err);
      }
      return;
    }

    // ===== Дисконнект во время countdown (matched) =====
    if (state?.status === "matched") {
      try {
        if (roomCountdowns.has(roomId)) {
          clearInterval(roomCountdowns.get(roomId));
          roomCountdowns.delete(roomId);
        }

        cleanupGame(roomId);

        const roomResult = await pool.query("SELECT * FROM rooms WHERE id = $1", [roomId]);
        if (roomResult.rows.length === 0) {
          fullRoomCleanup(roomId);
          return;
        }

        const room = roomResult.rows[0];
        const bot = activeBots.get(roomId);

        // Рефанд отключившемуся
        if (room.bet > 0) {
          await pool.query(
            "UPDATE users SET balance = balance + $1 WHERE id = $2",
            [room.bet, ws.user.id]
          );
        }

        if (bot) {
          // Оппонент бот — удаляем всё
          await pool.query("DELETE FROM rooms WHERE id = $1", [roomId]);
          fullRoomCleanup(roomId);
        } else {
          // Реальный оппонент — он остаётся
          const remainingId = room.host_id === ws.user.id ? room.guest_id : room.host_id;

          if (remainingId) {
            await pool.query(
              "UPDATE rooms SET host_id = $1, guest_id = NULL WHERE id = $2",
              [remainingId, roomId]
            );

            const remainingWs = findWsByUserId(remainingId);
            state.player1Id = remainingId;
            state.player1Ws = remainingWs;
            state.status = "searching";

            broadcast(roomId, {
              type: "countdown_cancelled",
              payload: { reason: "opponent_left" }
            });

            broadcast(roomId, { type: "searching_opponent" });

            await tryMatchOrQueue(roomId);
          } else {
            await pool.query("DELETE FROM rooms WHERE id = $1", [roomId]);
            fullRoomCleanup(roomId);
          }
        }

        broadcastArenaQueueUpdate();
      } catch (err) {
        console.error("disconnect during countdown error:", err);
      }
      return;
    }

    // ===== Дисконнект из АКТИВНОЙ ИГРЫ =====
    const game = activeGames.get(roomId);

    if (!game) {
      // Нет активной игры — простая очистка
      try {
        const roomResult = await pool.query("SELECT * FROM rooms WHERE id = $1", [roomId]);
        if (roomResult.rows.length === 0) return;

        const room = roomResult.rows[0];
        if (room.status === "playing") return;

        if (room.bet > 0) {
          await pool.query(
            "UPDATE users SET balance = balance + $1 WHERE id = $2",
            [room.bet, ws.user.id]
          );
        }

        const remainingId = room.host_id === ws.user.id ? room.guest_id : room.host_id;
        if (remainingId) {
          await pool.query(
            "UPDATE rooms SET host_id = $1, guest_id = NULL WHERE id = $2",
            [remainingId, roomId]
          );
        } else {
          await pool.query("DELETE FROM rooms WHERE id = $1", [roomId]);
        }

        await broadcastRoomInfo(roomId);
      } catch (err) {
        console.error("disconnect handler error:", err);
      }
      return;
    }

    // Активная игра — grace period 30 сек
    if (!game.disconnected) {
      game.disconnected = {};
    }

    game.disconnected[ws.user.id] = Date.now();

    const bot = activeBots.get(roomId);

    // Если играем против бота — мгновенный проигрыш
    if (bot) {
      await finishGame(roomId, bot.id);
      cleanupGame(roomId);
      return;
    }

    // Против реального игрока — 30 сек grace period
    setTimeout(async () => {
      if (!activeGames.has(roomId)) return;

      const currentGame = activeGames.get(roomId);
      if (!currentGame.disconnected) return;

      const stillDisconnected = currentGame.disconnected[ws.user.id];

      if (stillDisconnected) {
        const opponentId = Object.keys(currentGame.players)
          .map(Number)
          .find(id => id !== ws.user.id);

        await finishGame(roomId, opponentId);
        cleanupGame(roomId);
      }
    }, 30000);
  });
});

// ===== Запуск =====
server.listen(process.env.PORT, () => {
  console.log("Server started on port", process.env.PORT);
});
