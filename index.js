import admin from "firebase-admin";
import serviceAccount from "./firebase-service-account.json" assert { type: "json" };

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

import { GameEngine } from "./gameEngine.js";

const activeGames = new Map();
const roomCountdowns = new Map();

// ===== Матчмейкинг =====
// matchmakingQueue = Map<arenaId, Map<bet, Array<{ws, userId, joinedAt}>>>
const matchmakingQueue = new Map();
// Track which users are in the queue: userId -> {arenaId, bet}
const userInQueue = new Map();
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

    // ===== ЕСЛИ ПОЛЬЗОВАТЕЛЯ НЕТ =====
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

        // случайный дефолтный скин
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

        // создаём кастомизацию
        await client.query(`
          INSERT INTO user_customization
          (user_id, skin_id, effect_id, animation_hit_id, animation_miss_id, animation_win_id, animation_lose_id)
          VALUES (
            $1,
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

      // ===== ПОЛЬЗОВАТЕЛЬ УЖЕ ЕСТЬ =====
      user = userResult.rows[0];

    }

    // ===== СОЗДАЁМ JWT =====
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
// ===== HTTP: Проверка сервера =====
app.get("/", (req, res) => {
  res.send("Server is running 🚀");
});
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
      (user_id, skin_id, effect_id, animation_hit_id, animation_miss_id, animation_win_id, animation_lose_id)
      VALUES (
        $1,
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
async function finishGame(roomId, winnerId) {

  const game = activeGames.get(roomId);
  if (!game) return;

  game.phase = "finished";

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

    // Determine loserId
    const playerIds = Object.keys(game.players).map(Number);
    const loserId = playerIds.find(id => id !== Number(winnerId));

    await client.query(
      "UPDATE users SET balance = balance + $1 WHERE id = $2",
      [totalPrize, winnerId]
    );

    await client.query(
      "DELETE FROM rooms WHERE id = $1",
      [roomId]
    );

    await client.query("COMMIT");

    // Build finish animations
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

    broadcast(roomId, {
      type: "game_finished",
      payload
    });

  } catch (err) {
    await client.query("ROLLBACK");
    console.error("finishGame error:", err);
  } finally {
    client.release();
  }
}
function broadcast(roomId, data) {
  wss.clients.forEach(client => {
    if (client.roomId === roomId && client.readyState === 1) {
      client.send(JSON.stringify(data));
    }
  });
}
function startBombsTimer(roomId) {

  const game = activeGames.get(roomId);
  if (!game) return;

  if (game.bombsTimer) return; // защита

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

    for (let i = 0; i < 12; i++) {
      if (!opponent.revealed.has(i)) {
        available.push(i);
      }
    }

    if (available.length === 0) return;

    const randomCell =
      available[Math.floor(Math.random() * available.length)];

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
function finishBombsPhase(roomId) {

  const game = activeGames.get(roomId);
  if (!game) return;

  // если кто-то не поставил все бомбы
  Object.entries(game.players).forEach(([playerId, player]) => {

    if (player.bombs.length < 3) {

      const available = [];

      for (let i = 0; i < 12; i++) {
        if (!player.bombs.includes(i)) {
          available.push(i);
        }
      }

      while (player.bombs.length < 3) {
        const rand = available.splice(
          Math.floor(Math.random() * available.length), 1
        )[0];

        player.bombs.push(rand);
      }
    }
  });

  broadcast(roomId, {
    type: "bombs_phase_finished"
  });

  startMoveTimer(roomId);
}
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

      await launchGame(roomId);
    }

  }, 1000);

  roomCountdowns.set(roomId, interval);
}
// ===== Matchmaking functions =====

function getQueueCounts() {
  const counts = [];
  for (const [arenaId, betMap] of matchmakingQueue) {
    let total = 0;
    for (const players of betMap.values()) {
      total += players.length;
    }
    counts.push({ arenaId, players_in_queue: total });
  }
  return counts;
}

function broadcastArenaQueueUpdate() {
  if (arenaQueueBroadcastTimer) return; // debounce: max once per 2 seconds
  arenaQueueBroadcastTimer = setTimeout(() => {
    arenaQueueBroadcastTimer = null;

    const counts = getQueueCounts();
    const msg = JSON.stringify({
      type: "arena_queue_update",
      payload: counts
    });

    wss.clients.forEach(client => {
      if (client.readyState === 1 && !client.roomId && !userInQueue.has(client.user?.id)) {
        client.send(msg);
      }
    });
  }, 2000);
}

function removeFromQueue(userId) {
  const info = userInQueue.get(userId);
  if (!info) return null;

  const { arenaId, bet } = info;
  const betMap = matchmakingQueue.get(arenaId);
  if (betMap) {
    const players = betMap.get(bet);
    if (players) {
      const idx = players.findIndex(p => p.userId === userId);
      if (idx !== -1) {
        players.splice(idx, 1);
        if (players.length === 0) betMap.delete(bet);
        if (betMap.size === 0) matchmakingQueue.delete(arenaId);
      }
    }
  }

  userInQueue.delete(userId);
  broadcastArenaQueueUpdate();
  return info;
}

async function loadPlayerCustomization(playerId) {
  const result = await pool.query(`
    SELECT
      s_skin.code as skin_code,
      s_effect.code as effect_code,
      s_hit.code as animation_hit_code,
      s_miss.code as animation_miss_code,
      s_win.code as animation_win_code,
      s_lose.code as animation_lose_code
    FROM user_customization uc
    LEFT JOIN shop_items s_skin ON uc.skin_id = s_skin.id
    LEFT JOIN shop_items s_effect ON uc.effect_id = s_effect.id
    LEFT JOIN shop_items s_hit ON uc.animation_hit_id = s_hit.id
    LEFT JOIN shop_items s_miss ON uc.animation_miss_id = s_miss.id
    LEFT JOIN shop_items s_win ON uc.animation_win_id = s_win.id
    LEFT JOIN shop_items s_lose ON uc.animation_lose_id = s_lose.id
    WHERE uc.user_id = $1
  `, [playerId]);

  return result.rows[0] || {
    skin_code: "default_skin1",
    effect_code: "default_effect",
    animation_hit_code: "default_anim",
    animation_miss_code: "default_anim_miss",
    animation_win_code: "default_anim_win",
    animation_lose_code: "default_anim_lose"
  };
}

async function createMatchRoom(player1, player2, arenaId, bet) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const roomResult = await client.query(
      `INSERT INTO rooms (host_id, guest_id, bet, status, host_ready, guest_ready, arena_id)
       VALUES ($1, $2, $3, 'playing', true, true, $4)
       RETURNING id`,
      [player1.userId, player2.userId, bet, arenaId]
    );

    await client.query("COMMIT");

    const roomId = roomResult.rows[0].id;

    // Set roomId on both WS connections
    player1.ws.roomId = roomId;
    player2.ws.roomId = roomId;

    // Load customization for both players
    const [custom1, custom2] = await Promise.all([
      loadPlayerCustomization(player1.userId),
      loadPlayerCustomization(player2.userId)
    ]);

    // Get arena info
    const arenaResult = await pool.query(
      "SELECT code, name FROM arenas WHERE id = $1",
      [arenaId]
    );
    const arena = arenaResult.rows[0];

    // Send match_found to both
    player1.ws.send(JSON.stringify({
      type: "match_found",
      payload: {
        roomId,
        arenaId,
        arenaCode: arena.code,
        bet,
        opponent: {
          id: player2.userId,
          nickname: player2.ws.user.nickname,
          skin_code: custom2.skin_code,
          animation_code: custom2.animation_hit_code,
          effect_code: custom2.effect_code
        }
      }
    }));

    player2.ws.send(JSON.stringify({
      type: "match_found",
      payload: {
        roomId,
        arenaId,
        arenaCode: arena.code,
        bet,
        opponent: {
          id: player1.userId,
          nickname: player1.ws.user.nickname,
          skin_code: custom1.skin_code,
          animation_code: custom1.animation_hit_code,
          effect_code: custom1.effect_code
        }
      }
    }));

    // Create game engine and set customization
    const game = new GameEngine(roomId, player1.userId, player2.userId);
    game.setCustomization(player1.userId, custom1);
    game.setCustomization(player2.userId, custom2);
    activeGames.set(roomId, game);

    // Auto-start countdown (no ready phase needed)
    startGameCountdown(roomId);

    broadcastArenaQueueUpdate();

  } catch (err) {
    await client.query("ROLLBACK");
    console.error("createMatchRoom error:", err);

    // Refund both players on error
    try {
      await pool.query("UPDATE users SET balance = balance + $1 WHERE id = $2", [bet, player1.userId]);
      await pool.query("UPDATE users SET balance = balance + $1 WHERE id = $2", [bet, player2.userId]);
    } catch (refundErr) {
      console.error("Refund error:", refundErr);
    }

    const errorMsg = JSON.stringify({ type: "error", message: "Failed to create match" });
    if (player1.ws.readyState === 1) player1.ws.send(errorMsg);
    if (player2.ws.readyState === 1) player2.ws.send(errorMsg);
  } finally {
    client.release();
  }
}

async function launchGame(roomId) {

  const roomResult = await pool.query(
    "SELECT * FROM rooms WHERE id = $1",
    [roomId]
  );

  if (roomResult.rows.length === 0) return;

  const room = roomResult.rows[0];

  // ЗАЩИТА №1 — должны быть оба игрока
  if (!room.host_id || !room.guest_id) return;

  // For matchmaking rooms (arena_id set), skip ready check — already playing
  if (room.arena_id) {
    // Matchmaking rooms are already set to 'playing' and have game engine created
    // This is called from countdown, just start the game phase
    const game = activeGames.get(roomId);
    if (!game) return;

    broadcast(roomId, { type: "game_started" });
    broadcast(roomId, { type: "request_bombs" });
    startBombsTimer(roomId);
    return;
  }

  // ЗАЩИТА №2 — оба должны быть ready (only for private rooms)
  if (!room.host_ready || !room.guest_ready) return;

  // ЗАЩИТА №3 — не запускать повторно
  if (room.status === "playing") return;

  await pool.query(
    "UPDATE rooms SET status = 'playing' WHERE id = $1",
    [roomId]
  );

  const game = new GameEngine(
    roomId,
    room.host_id,
    room.guest_id
  );

  // Load customization for private room players too
  const [custom1, custom2] = await Promise.all([
    loadPlayerCustomization(room.host_id),
    loadPlayerCustomization(room.guest_id)
  ]);
  game.setCustomization(room.host_id, custom1);
  game.setCustomization(room.guest_id, custom2);

  activeGames.set(roomId, game);

  broadcast(roomId, { type: "game_started" });
  broadcast(roomId, { type: "request_bombs" });

  startBombsTimer(roomId);
}
function startMoveTimer(roomId) {

  const game = activeGames.get(roomId);
  if (!game) return;

  if (game.moveTimer) return; // защита

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

  wss.clients.forEach(client => {

    if (client.roomId !== roomId) return;

    const opponentId = Object.keys(game.players)
      .map(Number)
      .find(id => id !== client.user.id);

    const player = game.players[client.user.id];
    const opponent = game.players[opponentId];

    const availableCells = [];

    for (let i = 0; i < 12; i++) {
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
}
async function broadcastRoomInfo(roomId) {
  const result = await pool.query(`
    SELECT 
      r.id,
      r.status,
      r.bet,
      h.id as host_id,
      r.host_ready,
      r.password_hash,
      r.guest_ready,
      h.nickname as host_nickname,
      g.id as guest_id,
      g.nickname as guest_nickname
    FROM rooms r
    LEFT JOIN users h ON r.host_id = h.id
    LEFT JOIN users g ON r.guest_id = g.id
    WHERE r.id = $1
  `, [roomId]);

  if (result.rows.length === 0) return;

  const room = result.rows[0];

  const payload = {
    type: "room_info",
    payload: {
      id: room.id,
      status: room.status,
      bet: room.bet,
      isPrivate: !!room.password_hash,
      host: room.host_id ? {
        id: room.host_id,
        nickname: room.host_nickname,
        ready: room.host_ready
      } : null,
      guest: room.guest_id ? {
        id: room.guest_id,
        nickname: room.guest_nickname,
        ready: room.guest_ready
      } : null
    }
  };

  // отправляем всем подключённым клиентам этой комнаты
  wss.clients.forEach(client => {
    if (client.roomId === roomId && client.readyState === 1) {
      client.send(JSON.stringify(payload));
    }
  });
}
// ===== WebSocket =====
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
    // ✅ ОТПРАВЛЯЕМ УСПЕШНУЮ АВТОРИЗАЦИЮ
      ws.send(JSON.stringify({
        type: "authSuccess",
        payload: {
          userId: ws.user.id,
          balance: balance,
          nickname: ws.user.nickname
        }
      }));
    // Отправляем кастомизацию игроку (6 слотов)
    const customizationResult = await pool.query(`
    SELECT
      uc.skin_id,
      uc.effect_id,
      uc.animation_hit_id,
      uc.animation_miss_id,
      uc.animation_win_id,
      uc.animation_lose_id,

      s_skin.code as skin_code,
      s_effect.code as effect_code,
      s_hit.code as animation_hit_code,
      s_miss.code as animation_miss_code,
      s_win.code as animation_win_code,
      s_lose.code as animation_lose_code,

      (
        SELECT COUNT(*)
        FROM shop_items
        WHERE type='skin' AND id <= uc.skin_id
      ) as skin_index,

      (
        SELECT COUNT(*)
        FROM shop_items
        WHERE type='effect' AND id <= uc.effect_id
      ) as effect_index

    FROM user_customization uc
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


  ws.on("message", async (message) => {
  try {
    const data = JSON.parse(message);

    // ===== Запрос user_stats =====
    if (data.type === "get_user_stats") {

      const result = await pool.query(
        "SELECT id, email, nickname, created_at FROM users WHERE id = $1",
        [ws.user.id]
      );

      if (result.rows.length === 0) {
        ws.send(JSON.stringify({
          type: "error",
          message: "User not found"
        }));
        return;
      }

      ws.send(JSON.stringify({
        type: "user_stats",
        payload: result.rows[0]
      }));
    }

    // ===== Арены =====
    if (data.type === "get_arenas") {
      try {
        const result = await pool.query(
          "SELECT id, code, name, min_bet, max_bet FROM arenas WHERE is_active = true ORDER BY sort_order"
        );

        const arenas = result.rows.map(arena => {
          let playersInQueue = 0;
          const betMap = matchmakingQueue.get(arena.id);
          if (betMap) {
            for (const players of betMap.values()) {
              playersInQueue += players.length;
            }
          }
          return {
            ...arena,
            players_in_queue: playersInQueue
          };
        });

        ws.send(JSON.stringify({
          type: "arenas_list",
          payload: arenas
        }));
      } catch (err) {
        console.error(err);
        ws.send(JSON.stringify({ type: "error", message: "Failed to fetch arenas" }));
      }
    }

    // ===== Матчмейкинг: Найти игру =====
    if (data.type === "find_match") {
      try {
        const { arenaId, bet } = data;

        // Validate bet is integer >= 0
        if (bet == null || typeof bet !== "number" || !Number.isInteger(bet) || bet < 0) {
          return ws.send(JSON.stringify({ type: "error", message: "Invalid bet amount" }));
        }

        // Check not already in queue
        if (userInQueue.has(ws.user.id)) {
          return ws.send(JSON.stringify({ type: "error", message: "Already in queue" }));
        }

        // Check not already in a room
        if (ws.roomId) {
          return ws.send(JSON.stringify({ type: "error", message: "Already in a room" }));
        }

        // Validate arena
        const arenaResult = await pool.query(
          "SELECT * FROM arenas WHERE id = $1 AND is_active = true",
          [arenaId]
        );

        if (arenaResult.rows.length === 0) {
          return ws.send(JSON.stringify({ type: "error", message: "Arena not found" }));
        }

        const arena = arenaResult.rows[0];

        // Validate bet range
        if (bet < arena.min_bet || bet > arena.max_bet) {
          return ws.send(JSON.stringify({
            type: "error",
            message: `Bet must be between ${arena.min_bet} and ${arena.max_bet}`
          }));
        }

        // Check balance and deduct atomically
        const client = await pool.connect();
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

          if (bet > 0) {
            await client.query(
              "UPDATE users SET balance = balance - $1 WHERE id = $2",
              [bet, ws.user.id]
            );
          }

          await client.query("COMMIT");
        } catch (err) {
          await client.query("ROLLBACK");
          throw err;
        } finally {
          client.release();
        }

        // Add to queue
        if (!matchmakingQueue.has(arenaId)) {
          matchmakingQueue.set(arenaId, new Map());
        }
        const betMap = matchmakingQueue.get(arenaId);
        if (!betMap.has(bet)) {
          betMap.set(bet, []);
        }

        const playerEntry = {
          ws,
          userId: ws.user.id,
          joinedAt: Date.now()
        };

        betMap.get(bet).push(playerEntry);
        userInQueue.set(ws.user.id, { arenaId, bet });

        // Check for match
        const queueForBet = betMap.get(bet);
        if (queueForBet.length >= 2) {
          const player1 = queueForBet.shift();
          const player2 = queueForBet.shift();

          userInQueue.delete(player1.userId);
          userInQueue.delete(player2.userId);

          // Clean up empty entries
          if (queueForBet.length === 0) betMap.delete(bet);
          if (betMap.size === 0) matchmakingQueue.delete(arenaId);

          // Clear search timers
          if (player1.searchInterval) clearInterval(player1.searchInterval);
          if (player2.searchInterval) clearInterval(player2.searchInterval);
          if (player1.timeoutTimer) clearTimeout(player1.timeoutTimer);
          if (player2.timeoutTimer) clearTimeout(player2.timeoutTimer);

          await createMatchRoom(player1, player2, arenaId, bet);
        } else {
          // No match yet — send searching status
          ws.send(JSON.stringify({
            type: "match_searching",
            payload: {
              arenaId,
              bet,
              position: queueForBet.length
            }
          }));

          // Periodic updates every 10 seconds
          playerEntry.searchInterval = setInterval(() => {
            if (ws.readyState !== 1) {
              clearInterval(playerEntry.searchInterval);
              return;
            }
            const timeElapsed = Math.round((Date.now() - playerEntry.joinedAt) / 1000);
            ws.send(JSON.stringify({
              type: "match_searching",
              payload: { arenaId, bet, timeElapsed }
            }));
          }, 10000);

          // 60 second timeout
          playerEntry.timeoutTimer = setTimeout(async () => {
            if (playerEntry.searchInterval) clearInterval(playerEntry.searchInterval);

            const removed = removeFromQueue(ws.user.id);
            if (!removed) return;

            // Refund bet
            if (bet > 0) {
              try {
                await pool.query(
                  "UPDATE users SET balance = balance + $1 WHERE id = $2",
                  [bet, ws.user.id]
                );
              } catch (err) {
                console.error("Refund error on timeout:", err);
              }
            }

            if (ws.readyState === 1) {
              ws.send(JSON.stringify({
                type: "match_timeout",
                payload: { arenaId, bet, refunded: true }
              }));
            }
          }, 60000);
        }

        broadcastArenaQueueUpdate();

      } catch (err) {
        console.error("find_match error:", err);
        ws.send(JSON.stringify({ type: "error", message: "Matchmaking error" }));
      }
    }

    // ===== Матчмейкинг: Отменить поиск =====
    if (data.type === "cancel_match") {
      const info = userInQueue.get(ws.user.id);

      if (!info) {
        return ws.send(JSON.stringify({ type: "error", message: "Not in queue" }));
      }

      // Find and clear timers
      const betMap = matchmakingQueue.get(info.arenaId);
      if (betMap) {
        const players = betMap.get(info.bet);
        if (players) {
          const entry = players.find(p => p.userId === ws.user.id);
          if (entry) {
            if (entry.searchInterval) clearInterval(entry.searchInterval);
            if (entry.timeoutTimer) clearTimeout(entry.timeoutTimer);
          }
        }
      }

      removeFromQueue(ws.user.id);

      // Refund bet
      if (info.bet > 0) {
        try {
          await pool.query(
            "UPDATE users SET balance = balance + $1 WHERE id = $2",
            [info.bet, ws.user.id]
          );
        } catch (err) {
          console.error("Refund error on cancel:", err);
        }
      }

      ws.send(JSON.stringify({
        type: "match_cancelled",
        payload: { refunded: true }
      }));
    }

    if (data.type === "create_room") {
  // Проверка: уже в очереди?
  if (userInQueue.has(ws.user.id)) {
    return ws.send(JSON.stringify({
      type: "error",
      message: "Cannot create room while searching for match"
    }));
  }

  // Проверка: уже в комнате?
  if (ws.roomId) {
    return ws.send(JSON.stringify({
      type: "error",
      message: "You are already in a room"
    }));
  }

  const client = await pool.connect();
  try {
    const { bet, password } = data;

    if (!bet || typeof bet !== "number" || !Number.isFinite(bet) || bet <= 0 || !Number.isInteger(bet)) {
      client.release();
      return ws.send(JSON.stringify({
        type: "error",
        message: "Invalid bet amount"
      }));
    }

    await client.query("BEGIN");

    // проверяем и списываем баланс атомарно
    const userResult = await client.query(
      "SELECT balance FROM users WHERE id = $1 FOR UPDATE",
      [ws.user.id]
    );

    const balance = userResult.rows[0].balance;

    if (balance < bet) {
      await client.query("ROLLBACK");
      client.release();
      return ws.send(JSON.stringify({
        type: "error",
        message: "Not enough balance"
      }));
    }

    await client.query(
      "UPDATE users SET balance = balance - $1 WHERE id = $2",
      [bet, ws.user.id]
    );

    let passwordHash = null;
    if (password) {
      passwordHash = await bcrypt.hash(password, 10);
    }

    const result = await client.query(
      "INSERT INTO rooms (host_id, bet, host_ready, guest_ready, password_hash) VALUES ($1,$2,false,false,$3) RETURNING id, host_id, bet, status, host_ready, guest_ready, created_at",
      [ws.user.id, bet, passwordHash]
    );

    await client.query("COMMIT");

    const room = result.rows[0];
    ws.roomId = room.id;

    ws.send(JSON.stringify({
      type: "room_created",
      payload: room
    }));

    await broadcastRoomInfo(room.id);

  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    ws.send(JSON.stringify({
      type: "error",
      message: "Failed to create room"
    }));
  } finally {
    client.release();
  }
}

  if (data.type === "join_room") {
  // Проверка: уже в комнате?
  if (ws.roomId) {
    return ws.send(JSON.stringify({
      type: "error",
      message: "You are already in a room"
    }));
  }

  const client = await pool.connect();
  try {
    const { roomId, password } = data;

    const roomResult = await pool.query(
      "SELECT * FROM rooms WHERE id = $1",
      [roomId]
    );

    if (roomResult.rows.length === 0) {
      client.release();
      return ws.send(JSON.stringify({
        type: "error",
        message: "Room not found"
      }));
    }

    const room = roomResult.rows[0];

    // Проверка пароля
    if (room.password_hash) {
      if (!password) {
        client.release();
        return ws.send(JSON.stringify({
          type: "error",
          message: "Room requires password"
        }));
      }

      const validPassword = await bcrypt.compare(password, room.password_hash);
      if (!validPassword) {
        client.release();
        return ws.send(JSON.stringify({
          type: "error",
          message: "Wrong password"
        }));
      }
    }

    // анти-дубль
    if (room.host_id === ws.user.id || room.guest_id === ws.user.id) {
      ws.roomId = roomId;
      client.release();
      return ws.send(JSON.stringify({
        type: "error",
        message: "You are already in this room"
      }));
    }

    await client.query("BEGIN");

    // проверяем и списываем баланс атомарно
    const userResult = await client.query(
      "SELECT balance FROM users WHERE id = $1 FOR UPDATE",
      [ws.user.id]
    );

    const balance = userResult.rows[0].balance;

    if (balance < room.bet) {
      await client.query("ROLLBACK");
      client.release();
      return ws.send(JSON.stringify({
        type: "error",
        message: "Not enough balance"
      }));
    }

    // атомарно пробуем занять слот
    const updateResult = await client.query(
      `UPDATE rooms
       SET guest_id = $1,
           status = 'waiting',
           host_ready = false,
           guest_ready = false
       WHERE id = $2 AND guest_id IS NULL
       RETURNING *`,
      [ws.user.id, roomId]
    );

    if (updateResult.rows.length === 0) {
      await client.query("ROLLBACK");
      client.release();
      return ws.send(JSON.stringify({
        type: "error",
        message: "Room is full"
      }));
    }

    // списываем деньги внутри той же транзакции
    await client.query(
      "UPDATE users SET balance = balance - $1 WHERE id = $2",
      [room.bet, ws.user.id]
    );

    await client.query("COMMIT");

    ws.roomId = roomId;

    ws.send(JSON.stringify({
      type: "room_joined",
      payload: { roomId }
    }));

    await broadcastRoomInfo(roomId);

    if (updateResult.rows[0].guest_id) {
      broadcast(roomId, {
        type: "play_request"
      });
    }
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    ws.send(JSON.stringify({
      type: "error",
      message: "Failed to join room"
    }));
  } finally {
    client.release();
  }
}
if (data.type === "get_rooms_list") {
  try {
    const result = await pool.query(`
      SELECT 
        r.id,
        r.bet,
        r.status,
        u.id as host_id,
        u.nickname as host_nickname
      FROM rooms r
      JOIN users u ON r.host_id = u.id
      WHERE r.status = 'waiting'
        AND r.guest_id IS NULL  
      ORDER BY r.created_at DESC
    `);

    ws.send(JSON.stringify({
      type: "rooms_list",
      payload: result.rows
    }));

  } catch (err) {
    console.error(err);
    ws.send(JSON.stringify({
      type: "error",
      message: "Failed to fetch rooms"
    }));
  }
}


  if (data.type === "get_room_info") {
    try {
      if (!ws.roomId) {
        return ws.send(JSON.stringify({
          type: "error",
          message: "You are not in a room"
        }));
      }

      const result = await pool.query(`
        SELECT 
          r.id,
          r.status,
          h.id as host_id,
          h.nickname as host_nickname,
          g.id as guest_id,
          r.bet,
          r.host_ready,
          r.guest_ready,
          g.nickname as guest_nickname
        FROM rooms r
        LEFT JOIN users h ON r.host_id = h.id
        LEFT JOIN users g ON r.guest_id = g.id
        WHERE r.id = $1
      `, [ws.roomId]);

      if (result.rows.length === 0) {
        return ws.send(JSON.stringify({
          type: "error",
          message: "Room not found"
        }));
      }

      const room = result.rows[0];

      ws.send(JSON.stringify({
        type: "room_info",
        payload: {
          id: room.id,
          status: room.status,
          bet: room.bet,
          host: room.host_id ? {
            id: room.host_id,
            nickname: room.host_nickname,
            ready: room.host_ready
          } : null,
          guest: room.guest_id ? {
            id: room.guest_id,
            nickname: room.guest_nickname,
            ready: room.guest_ready
          } : null
        }
      }));

    } catch (err) {
      console.error(err);
      ws.send(JSON.stringify({
        type: "error",
        message: "Failed to fetch room info"
      }));
    }
  }
  if (data.type === "equip_item") {

  const { itemId } = data;

  const itemResult = await pool.query(
    "SELECT * FROM shop_items WHERE id = $1",
    [itemId]
  );

  if (itemResult.rows.length === 0) {
    return ws.send(JSON.stringify({
      type: "error",
      message: "Item not found"
    }));
  }

  const item = itemResult.rows[0];

  // Проверяем владеет ли игрок
  const ownership = await pool.query(
    "SELECT * FROM user_items WHERE user_id = $1 AND item_id = $2",
    [ws.user.id, itemId]
  );

  if (ownership.rows.length === 0 && item.price > 0) {
    return ws.send(JSON.stringify({
      type: "error",
      message: "You do not own this item"
    }));
  }

  // определяем колонку
  const allowedColumns = {
    skin: "skin_id",
    effect: "effect_id",
    animation_hit: "animation_hit_id",
    animation_miss: "animation_miss_id",
    animation_win: "animation_win_id",
    animation_lose: "animation_lose_id"
  };

  const column = allowedColumns[item.type];

  if (!column) {
    return ws.send(JSON.stringify({
      type: "error",
      message: "Invalid item type"
    }));
  }

  await pool.query(
    `UPDATE user_customization 
     SET ${column} = $1, updated_at = NOW()
     WHERE user_id = $2`,
    [itemId, ws.user.id]
  );

  ws.send(JSON.stringify({
    type: "equip_success",
    payload: { itemId }
  }));
}
if (data.type === "buy_item") {

  const { itemId } = data;

  const itemResult = await pool.query(
    "SELECT * FROM shop_items WHERE id = $1",
    [itemId]
  );

  if (itemResult.rows.length === 0) return;

  const item = itemResult.rows[0];

  if (item.price <= 0) {
    return ws.send(JSON.stringify({
      type: "error",
      message: "Item is free"
    }));
  }

  // Проверка: уже куплен?
  const alreadyOwned = await pool.query(
    "SELECT 1 FROM user_items WHERE user_id = $1 AND item_id = $2",
    [ws.user.id, itemId]
  );

  if (alreadyOwned.rows.length > 0) {
    return ws.send(JSON.stringify({
      type: "error",
      message: "Item already owned"
    }));
  }

  const client = await pool.connect();

  try {

    await client.query("BEGIN");

    const userResult = await client.query(
      "SELECT balance FROM users WHERE id = $1 FOR UPDATE",
      [ws.user.id]
    );

    const balance = userResult.rows[0].balance;

    if (balance < item.price) {
      await client.query("ROLLBACK");
      return ws.send(JSON.stringify({
        type: "error",
        message: "Not enough balance"
      }));
    }

    await client.query(
      "UPDATE users SET balance = balance - $1 WHERE id = $2",
      [item.price, ws.user.id]
    );

    await client.query(
      "INSERT INTO user_items (user_id, item_id) VALUES ($1,$2) ON CONFLICT DO NOTHING",
      [ws.user.id, itemId]
    );

    await client.query("COMMIT");

    ws.send(JSON.stringify({
      type: "purchase_success",
      payload: { itemId }
    }));

  } catch (err) {

    await client.query("ROLLBACK");
    console.error(err);

    ws.send(JSON.stringify({
      type: "error",
      message: "Purchase failed"
    }));

  } finally {
    client.release();
  }
}
if (data.type === "send_friend_request") {

  const targetId = Number(data.userId);

  if (targetId === ws.user.id) return;

  const existing = await pool.query(
    `SELECT * FROM friends 
     WHERE requester_id = $1 AND addressee_id = $2`,
    [ws.user.id, targetId]
  );

  if (existing.rows.length > 0) {
    return ws.send(JSON.stringify({
      type: "error",
      message: "Request already sent"
    }));
  }

  const result = await pool.query(
    `INSERT INTO friends (requester_id, addressee_id, status)
     VALUES ($1,$2,'pending')
     RETURNING *`,
    [ws.user.id, targetId]
  );

  // уведомляем получателя если онлайн
  wss.clients.forEach(client => {
    if (client.user?.id === targetId) {
      client.send(JSON.stringify({
        type: "friend_request_received",
        payload: result.rows[0]
      }));
    }
  });

  ws.send(JSON.stringify({
    type: "friend_request_sent"
  }));
}
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

  ws.send(JSON.stringify({
    type: "reconnect_ok",
    payload: {
      inRoom: true,
      roomId: room.id
    }
  }));

  await broadcastRoomInfo(room.id);

  if (activeGames.has(room.id)) {

    const game = activeGames.get(room.id);

    // 🔥 ВАЖНО
    if (game.disconnected) {
  delete game.disconnected[ws.user.id];
}
    ws.send(JSON.stringify({
      type: "game_state_restore",
      payload: {
        phase: game.phase,
        turn: game.turn,
        bombsTimeLeft: game.bombsTimeLeft,
        moveTimeLeft: game.moveTimeLeft
      }
    }));
    sendTurnState(room.id);
  }
}
if (data.type === "accept_friend_request") {

  const requestId = data.requestId;

  const result = await pool.query(
    `UPDATE friends
     SET status = 'accepted'
     WHERE id = $1 AND addressee_id = $2
     RETURNING *`,
    [requestId, ws.user.id]
  );

  if (result.rows.length === 0) return;

  const request = result.rows[0];

  // уведомляем второго игрока
  wss.clients.forEach(client => {
    if (client.user?.id === request.requester_id) {
      client.send(JSON.stringify({
        type: "friend_request_accepted"
      }));
    }
  });

  ws.send(JSON.stringify({
    type: "friend_added"
  }));
}
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
if (data.type === "invite_to_room") {

  if (!ws.roomId) return;

  const friendId = Number(data.friendId);

  const result = await pool.query(
    `INSERT INTO game_invites (from_user_id, to_user_id, room_id)
     VALUES ($1,$2,$3)
     RETURNING *`,
    [ws.user.id, friendId, ws.roomId]
  );

  wss.clients.forEach(client => {
    if (client.user?.id === friendId) {
      client.send(JSON.stringify({
        type: "game_invite_received",
        payload: {
          roomId: ws.roomId,
          from: ws.user.nickname
        }
      }));
    }
  });
}
  if (data.type === "leave_room") {
  try {
    if (!ws.roomId) {
      return ws.send(JSON.stringify({
        type: "error",
        message: "You are not in a room"
      }));
    }

    const roomResult = await pool.query(
      "SELECT * FROM rooms WHERE id = $1",
      [ws.roomId]
    );

    if (roomResult.rows.length === 0) {
      ws.roomId = null;
      return;
    }

    const room = roomResult.rows[0];
    const roomId = room.id;

    // ===== ЕСЛИ ИГРА УЖЕ ИДЁТ =====
    if (room.status === "playing") {

      const winnerId =
        room.host_id === ws.user.id
          ? room.guest_id
          : room.host_id;

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        if (winnerId) {
          await client.query(
            "UPDATE users SET balance = balance + $1 WHERE id = $2",
            [room.bet * 2, winnerId]
          );
        }

        await client.query(
          "DELETE FROM rooms WHERE id = $1",
          [roomId]
        );

        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }

      // уведомляем победителя
      wss.clients.forEach(c => {
        if (c.readyState === 1 && c.user?.id === winnerId) {
          c.send(JSON.stringify({
            type: "game_finished",
            payload: {
              winnerId,
              reason: "opponent_left"
            }
          }));
          c.roomId = null;
        }
      });

      if (roomCountdowns.has(roomId)) {
        clearInterval(roomCountdowns.get(roomId));
        roomCountdowns.delete(roomId);
        broadcast(roomId, { type: "countdown_cancelled" });
      }

      ws.roomId = null;
      cleanupGame(roomId);
      return ws.send(JSON.stringify({
        type: "left_room"
      }));
    }

    // ===== ЕСЛИ ИГРА НЕ НАЧАЛАСЬ =====
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // возвращаем деньги вышедшему
      await client.query(
        "UPDATE users SET balance = balance + $1 WHERE id = $2",
        [room.bet, ws.user.id]
      );

      if (room.host_id === ws.user.id) {
        if (room.guest_id) {
          await client.query(
            "UPDATE rooms SET host_id = $1, guest_id = NULL, status = 'waiting' WHERE id = $2",
            [room.guest_id, roomId]
          );
        } else {
          await client.query(
            "DELETE FROM rooms WHERE id = $1",
            [roomId]
          );
        }
      } else if (room.guest_id === ws.user.id) {
        await client.query(
          "UPDATE rooms SET guest_id = NULL, status = 'waiting' WHERE id = $1",
          [roomId]
        );
      }

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    ws.roomId = null;

    await broadcastRoomInfo(roomId);

    ws.send(JSON.stringify({
      type: "left_room"
    }));

  } catch (err) {
    console.error(err);
    ws.send(JSON.stringify({
      type: "error",
      message: "Failed to leave room"
    }));
  }
}
if (data.type === "get_shop_items") {

  // получаем все предметы
  const itemsResult = await pool.query(`
    SELECT id, code, name, type, price, currency
    FROM shop_items
    ORDER BY type, price
  `);

  // получаем купленные предметы игрока
  const ownedResult = await pool.query(
    "SELECT item_id FROM user_items WHERE user_id = $1",
    [ws.user.id]
  );

  const ownedIds = new Set(
    ownedResult.rows.map(r => r.item_id)
  );

  // получаем активную кастомизацию
  const customizationResult = await pool.query(`
    SELECT skin_id, effect_id, animation_hit_id, animation_miss_id, animation_win_id, animation_lose_id
    FROM user_customization
    WHERE user_id = $1
  `, [ws.user.id]);

  const active = customizationResult.rows[0] || {};

  const typeToColumn = {
    skin: "skin_id",
    effect: "effect_id",
    animation_hit: "animation_hit_id",
    animation_miss: "animation_miss_id",
    animation_win: "animation_win_id",
    animation_lose: "animation_lose_id"
  };

  const items = itemsResult.rows.map(item => {

    const isOwned =
      item.price === 0 || ownedIds.has(item.id);

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
if (data.type === "kick_player") {

  if (!ws.roomId) return;

  const roomResult = await pool.query(
    "SELECT * FROM rooms WHERE id = $1",
    [ws.roomId]
  );

  if (roomResult.rows.length === 0) return;

  const room = roomResult.rows[0];

  // Только хост может кикать
  if (room.host_id !== ws.user.id) {
    return ws.send(JSON.stringify({
      type: "error",
      message: "Only host can kick"
    }));
  }

  const targetId = Number(data.playerId);

  // Можно кикать только гостя
  if (room.guest_id !== targetId) {
    return ws.send(JSON.stringify({
      type: "error",
      message: "Invalid target"
    }));
  }

  // ❌ Нельзя кикать во время игры
  if (room.status === "playing") {
    return ws.send(JSON.stringify({
      type: "error",
      message: "Cannot kick during game"
    }));
  }

  // Возвращаем деньги гостю
  await pool.query(
    "UPDATE users SET balance = balance + $1 WHERE id = $2",
    [room.bet, targetId]
  );

  // Удаляем гостя из комнаты
  await pool.query(
    `UPDATE rooms 
     SET guest_id = NULL, 
         guest_ready = false,
         status = 'waiting'
     WHERE id = $1`,
    [ws.roomId]
  );

  // Сбрасываем комнату у кикнутого
  wss.clients.forEach(client => {
    if (client.user?.id === targetId) {
      client.roomId = null;

      client.send(JSON.stringify({
        type: "kicked_from_room"
      }));
    }
  });

  // 🔥 Вот самое важное
  // Отправляем ОБНОВЛЕНИЕ КОМНАТЫ всем
  await broadcastRoomInfo(ws.roomId);
}
  if (data.type === "player_ready") {
  try {
    if (!ws.roomId) return;

    const { ready } = data;

    const roomResult = await pool.query(
      "SELECT * FROM rooms WHERE id = $1",
      [ws.roomId]
    );

    if (roomResult.rows.length === 0) return;

    const room = roomResult.rows[0];

    // обновляем ready
    if (room.host_id === ws.user.id) {
      await pool.query(
        "UPDATE rooms SET host_ready = $1 WHERE id = $2",
        [ready, ws.roomId]
      );
    } else if (room.guest_id === ws.user.id) {
      await pool.query(
        "UPDATE rooms SET guest_ready = $1 WHERE id = $2",
        [ready, ws.roomId]
      );
    }

    // получаем обновлённую комнату
    const updated = await pool.query(
      "SELECT * FROM rooms WHERE id = $1",
      [ws.roomId]
    );

    const updatedRoom = updated.rows[0];

    // если оба готовы — старт
    
    if (!updatedRoom.host_ready || !updatedRoom.guest_ready) {
  if (roomCountdowns.has(ws.roomId)) {
    clearInterval(roomCountdowns.get(ws.roomId));
    roomCountdowns.delete(ws.roomId);

    broadcast(ws.roomId, {
      type: "countdown_cancelled"
    });
  }
}  
    
      if (updatedRoom.host_ready && updatedRoom.guest_ready) {
        startGameCountdown(ws.roomId);
      }
      await broadcastRoomInfo(ws.roomId);
  } catch (err) {
    console.error(err);
  }
}
if (data.type === "place_bombs") {

  if (!Array.isArray(data.bombs) || data.bombs.length !== 3
      || !data.bombs.every(b => Number.isInteger(b) && b >= 0 && b <= 11)) {
    return ws.send(JSON.stringify({
      type: "error",
      message: "Invalid bombs: must be 3 integers 0-11"
    }));
  }

  const game = activeGames.get(ws.roomId);
  if (!game) return;

  const result = game.placeBombs(ws.user.id, data.bombs);

  if (result.error) {
    return ws.send(JSON.stringify({
      type: "error",
      message: result.error
    }));
  }

  // Если оба расставили — начинается фаза игры
  if (result.gameStarted) {
    clearInterval(game.bombsTimer);
    game.bombsTimer = null;
    broadcast(ws.roomId, {
      type: "bombs_placed"
    });
    finishBombsPhase(ws.roomId);
  }
}
// if (data.type === "play_confirm") {

//   const { accept } = data;

//   const roomResult = await pool.query(
//     "SELECT * FROM rooms WHERE id = $1",
//     [ws.roomId]
//   );

//   if (roomResult.rows.length === 0) return;

//   const room = roomResult.rows[0];

//   // 🔥 используем отдельную Map
//   if (!playConfirmations.has(ws.roomId)) {
//     playConfirmations.set(ws.roomId, {});
//   }

//   const confirmations = playConfirmations.get(ws.roomId);

//   confirmations[ws.user.id] = accept;

//   // если кто-то отказался
//   if (!accept) {
//     broadcast(ws.roomId, { type: "play_declined" });
//     playConfirmations.delete(ws.roomId);
//     return;
//   }

//   const players = [room.host_id, room.guest_id];

//   const allAccepted = players.every(id => confirmations[id] === true);

//   if (!allAccepted) return;

//   // ✅ все подтвердили
//   playConfirmations.delete(ws.roomId);

//   await pool.query(
//     "UPDATE rooms SET status = 'playing' WHERE id = $1",
//     [ws.roomId]
//   );

//   const game = new GameEngine(
//     ws.roomId,
//     room.host_id,
//     room.guest_id
//   );

//   activeGames.set(ws.roomId, game);

//   broadcast(ws.roomId, { type: "game_started" });
//   broadcast(ws.roomId, { type: "request_bombs" });

//   startBombsTimer(ws.roomId);
// }
if (data.type === "make_move") {

  const cell = Number(data.cell);
  if (!Number.isInteger(cell) || cell < 0 || cell > 11) {
    return ws.send(JSON.stringify({
      type: "error",
      message: "Invalid cell"
    }));
  }

  const game = activeGames.get(ws.roomId);
  if (!game) return;

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
  } catch (err) {
    ws.send(JSON.stringify({ type: "error", message: "Invalid JSON" }));
  }
});

  ws.on("close", async () => {

  // Handle disconnect from matchmaking queue
  if (userInQueue.has(ws.user.id)) {
    const info = userInQueue.get(ws.user.id);

    // Clear timers
    const betMap = matchmakingQueue.get(info.arenaId);
    if (betMap) {
      const players = betMap.get(info.bet);
      if (players) {
        const entry = players.find(p => p.userId === ws.user.id);
        if (entry) {
          if (entry.searchInterval) clearInterval(entry.searchInterval);
          if (entry.timeoutTimer) clearTimeout(entry.timeoutTimer);
        }
      }
    }

    removeFromQueue(ws.user.id);

    // Refund bet
    if (info.bet > 0) {
      try {
        await pool.query(
          "UPDATE users SET balance = balance + $1 WHERE id = $2",
          [info.bet, ws.user.id]
        );
      } catch (err) {
        console.error("Refund error on disconnect:", err);
      }
    }
  }

  const roomId = ws.roomId;
  if (!roomId) return;

  // отменяем countdown если он был
  if (roomCountdowns.has(roomId)) {
    clearInterval(roomCountdowns.get(roomId));
    roomCountdowns.delete(roomId);
    broadcast(roomId, { type: "countdown_cancelled" });
  }

  const game = activeGames.get(roomId);

  // ===== Дисконнект из WAITING-комнаты (нет активной игры) =====
  if (!game) {
    try {
      const roomResult = await pool.query(
        "SELECT * FROM rooms WHERE id = $1",
        [roomId]
      );

      if (roomResult.rows.length === 0) return;

      const room = roomResult.rows[0];

      // Если статус уже playing — не трогаем (игра управляется через activeGames)
      if (room.status === "playing") return;

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        // Возвращаем ставку отключившемуся
        await client.query(
          "UPDATE users SET balance = balance + $1 WHERE id = $2",
          [room.bet, ws.user.id]
        );

        if (room.host_id === ws.user.id) {
          if (room.guest_id) {
            // Гость становится хостом
            await client.query(
              "UPDATE rooms SET host_id = $1, guest_id = NULL, host_ready = false, guest_ready = false, status = 'waiting' WHERE id = $2",
              [room.guest_id, roomId]
            );
          } else {
            // Комната пуста — удаляем
            await client.query("DELETE FROM rooms WHERE id = $1", [roomId]);
          }
        } else if (room.guest_id === ws.user.id) {
          await client.query(
            "UPDATE rooms SET guest_id = NULL, guest_ready = false, status = 'waiting' WHERE id = $1",
            [roomId]
          );
        }

        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        console.error("disconnect from waiting room error:", err);
      } finally {
        client.release();
      }

      await broadcastRoomInfo(roomId);
    } catch (err) {
      console.error("disconnect handler error:", err);
    }
    return;
  }

  // ===== Дисконнект из АКТИВНОЙ ИГРЫ =====
  if (!game.disconnected) {
    game.disconnected = {};
  }

  game.disconnected[ws.user.id] = Date.now();

  setTimeout(() => {

    if (!activeGames.has(roomId)) return;

    const currentGame = activeGames.get(roomId);
    if (!currentGame.disconnected) return;

    const stillDisconnected = currentGame.disconnected[ws.user.id];

    if (stillDisconnected) {
      const opponentId = Object.keys(currentGame.players)
        .map(Number)
        .find(id => id !== ws.user.id);

      finishGame(roomId, opponentId);
      cleanupGame(roomId);
    }

  }, 30000);
});
});

// ===== Запуск =====
server.listen(process.env.PORT, () => {
  console.log("Server started on port", process.env.PORT);
});