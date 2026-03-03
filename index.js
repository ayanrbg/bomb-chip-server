import admin from "firebase-admin";
import serviceAccount from "./firebase-service-account.json" assert { type: "json" };

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

import { GameEngine } from "./gameEngine.js";

const activeGames = new Map();
const roomCountdowns = new Map();
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

    if (userResult.rows.length === 0) {
      const insert = await pool.query(
        `INSERT INTO users (email, nickname, firebase_uid, balance)
         VALUES ($1, $2, $3, 1000)
         RETURNING id, nickname`,
        [email, name, firebaseUid]
      );
      
      user = insert.rows[0];

      // Получаем случайный дефолтный скин
const randomSkinResult = await pool.query(`
  SELECT id FROM shop_items
  WHERE code IN ('default_skin1','default_skin2','default_skin3')
  ORDER BY RANDOM()
  LIMIT 1
`);
if (randomSkinResult.rows.length === 0) {
  throw new Error("No default skins found in shop_items");
}
const randomSkinId = randomSkinResult.rows[0].id;

// Создаём кастомизацию с рандомным скином
await pool.query(`
  INSERT INTO user_customization 
  (user_id, skin_id, animation_id, effect_id)
  VALUES (
    $1,
    $2,
    (SELECT id FROM shop_items WHERE code = 'default_anim'),
    (SELECT id FROM shop_items WHERE code = 'deffault_effect')
  )
`, [user.id, randomSkinId]);
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
// ===== HTTP: Проверка сервера =====
app.get("/", (req, res) => {
  res.send("Server is running 🚀");
});
app.post("/register", async (req, res) => {
  const { email, password, nickname } = req.body;

  if (!email || !password || !nickname) {
    return res.status(400).json({ error: "Missing fields" });
  }

  try {
    const existing = await pool.query(
      "SELECT id FROM users WHERE email = $1",
      [email]
    );

    if (existing.rows.length > 0) {
      return res.status(400).json({ error: "Email already exists" });
    }

    const hashed = await bcrypt.hash(password, 10);

    const result = await pool.query(
      "INSERT INTO users (email, password, nickname) VALUES ($1,$2,$3) RETURNING id,nickname",
      [email, hashed, nickname]
    );

    const user = result.rows[0];
    // Получаем случайный дефолтный скин
const randomSkinResult = await pool.query(`
  SELECT id FROM shop_items
  WHERE code IN ('default_skin1','default_skin2','default_skin3')
  ORDER BY RANDOM()
  LIMIT 1
`);
if (randomSkinResult.rows.length === 0) {
  throw new Error("No default skins found in shop_items");
}
const randomSkinId = randomSkinResult.rows[0].id;

// Создаём кастомизацию
await pool.query(`
  INSERT INTO user_customization 
  (user_id, skin_id, animation_id, effect_id)
  VALUES (
    $1,
    $2,
    (SELECT id FROM shop_items WHERE code = 'default_anim'),
    (SELECT id FROM shop_items WHERE code = 'deffault_effect')
  )
`, [user.id, randomSkinId]);
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
app.post("/login", async (req, res) => {
  const { email, password } = req.body;

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
      "SELECT * FROM rooms WHERE id = $1 FOR UPDATE",
      [roomId]
    );

    if (roomResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return;
    }

    const room = roomResult.rows[0];
    const totalPrize = room.bet * 2;

    await client.query(
      "UPDATE users SET balance = balance + $1 WHERE id = $2",
      [totalPrize, winnerId]
    );

    await client.query(
      "DELETE FROM rooms WHERE id = $1",
      [roomId]
    );

    await client.query("COMMIT");

    broadcast(roomId, {
      type: "game_finished",
      payload: {
        winnerId,
        prize: totalPrize
      }
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
function autoMove(roomId) {

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

    const result = game.makeMove(game.turn, randomCell);

    broadcast(roomId, {
      type: "move_result",
      payload: result
    });

    if (!result.winner) {
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
async function launchGame(roomId) {

  const roomResult = await pool.query(
    "SELECT * FROM rooms WHERE id = $1",
    [roomId]
  );

  if (roomResult.rows.length === 0) return;

  const room = roomResult.rows[0];

  // ❗ ЗАЩИТА №1 — должны быть оба игрока
  if (!room.host_id || !room.guest_id) return;

  // ❗ ЗАЩИТА №2 — оба должны быть ready
  if (!room.host_ready || !room.guest_ready) return;

  // ❗ ЗАЩИТА №3 — не запускать повторно
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
    // 🔥 Отправляем кастомизацию игроку
    const customizationResult = await pool.query(`
      SELECT 
        uc.skin_id,
        uc.animation_id,
        uc.effect_id,
        s1.code as skin_code,
        s2.code as animation_code,
        s3.code as effect_code
      FROM user_customization uc
      LEFT JOIN shop_items s1 ON uc.skin_id = s1.id
      LEFT JOIN shop_items s2 ON uc.animation_id = s2.id
      LEFT JOIN shop_items s3 ON uc.effect_id = s3.id
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
    if (data.type === "create_room") {
  try {
    const { bet , password} = data;

    if (!bet || bet <= 0) {
      return ws.send(JSON.stringify({
        type: "error",
        message: "Invalid bet amount"
      }));
    }

    // проверяем баланс
    const userResult = await pool.query(
      "SELECT balance FROM users WHERE id = $1",
      [ws.user.id]
    );

    const balance = userResult.rows[0].balance;

    if (balance < bet) {
      return ws.send(JSON.stringify({
        type: "error",
        message: "Not enough balance"
      }));
    }

    // блокируем деньги (списываем)
    await pool.query(
      "UPDATE users SET balance = balance - $1 WHERE id = $2",
      [bet, ws.user.id]
    );
    let passwordHash = null;

  if (password) {
    passwordHash = await bcrypt.hash(password, 10);
  }
    // создаём комнату
    const result = await pool.query(
    "INSERT INTO rooms (host_id, bet, host_ready, guest_ready, password_hash) VALUES ($1,$2,false,false,$3) RETURNING *",
    [ws.user.id, bet, passwordHash]
  );


    const room = result.rows[0];
    ws.roomId = room.id;

    ws.send(JSON.stringify({
      type: "room_created",
      payload: room
    }));

    await broadcastRoomInfo(room.id);

  } catch (err) {
    console.error(err);
    ws.send(JSON.stringify({
      type: "error",
      message: "Failed to create room"
    }));
  }
}

  if (data.type === "join_room") {
  try {
    const { roomId , password} = data;

    const roomResult = await pool.query(
      "SELECT * FROM rooms WHERE id = $1",
      [roomId]
    );

    if (roomResult.rows.length === 0) {
      return ws.send(JSON.stringify({
        type: "error",
        message: "Room not found"
      }));
    }

    const room = roomResult.rows[0];
    // 🔐 Проверка пароля
if (room.password_hash) {

  if (!password) {
    return ws.send(JSON.stringify({
      type: "error",
      message: "Room requires password"
    }));
  }

  const validPassword = await bcrypt.compare(
    password,
    room.password_hash
  );

  if (!validPassword) {
    return ws.send(JSON.stringify({
      type: "error",
      message: "Wrong password"
    }));
  }
}
    // анти-дубль
    if (room.host_id === ws.user.id || room.guest_id === ws.user.id) {
      ws.roomId = roomId;
      return ws.send(JSON.stringify({
        type: "error",
        message: "You are already in this room"
      }));
    }

    // проверяем баланс
    const userResult = await pool.query(
      "SELECT balance FROM users WHERE id = $1",
      [ws.user.id]
    );

    const balance = userResult.rows[0].balance;

    if (balance < room.bet) {
      return ws.send(JSON.stringify({
        type: "error",
        message: "Not enough balance"
      }));
    }

    // атомарно пробуем занять слот
    const updateResult = await pool.query(
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
      return ws.send(JSON.stringify({
        type: "error",
        message: "Room is full"
      }));
    }

    // списываем деньги ТОЛЬКО если успешно заняли слот
    await pool.query(
      "UPDATE users SET balance = balance - $1 WHERE id = $2",
      [room.bet, ws.user.id]
    );

    ws.roomId = roomId;

    ws.send(JSON.stringify({
      type: "room_joined",
      payload: { roomId }
    }));

    await broadcastRoomInfo(roomId);
    // если теперь в комнате 2 игрока
    if (updateResult.rows[0].guest_id) {
      broadcast(roomId, {
        type: "play_request"
      });
    }
  } catch (err) {
    console.error(err);
    ws.send(JSON.stringify({
      type: "error",
      message: "Failed to join room"
    }));
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

  // Определяем куда записывать
  const allowedColumns = {
    skin: "skin_id",
    animation: "animation_id",
    effect: "effect_id"
  };

  const column = allowedColumns[item.type];

  if (!column) {
    return ws.send(JSON.stringify({
      type: "error",
      message: "Invalid item type"
    }));
  }

  if (!column) return;

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
      "INSERT INTO user_items (user_id, item_id) VALUES ($1,$2)",
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

      if (winnerId) {
        // начисляем победителю bet * 2
        await pool.query(
          "UPDATE users SET balance = balance + $1 WHERE id = $2",
          [room.bet * 2, winnerId]
        );
      }

      // удаляем комнату
      await pool.query(
        "DELETE FROM rooms WHERE id = $1",
        [roomId]
      );

      // уведомляем победителя
      wss.clients.forEach(client => {
        if (
          client.readyState === 1 &&
          client.user?.id === winnerId
        ) {
          client.send(JSON.stringify({
            type: "game_finished",
            payload: {
              winnerId,
              reason: "opponent_left"
            }
          }));

          client.roomId = null;
        }
      });
      if (roomCountdowns.has(roomId)) {
        clearInterval(roomCountdowns.get(roomId));
        roomCountdowns.delete(roomId);

        broadcast(roomId, {
          type: "countdown_cancelled"
        });
      }
      ws.roomId = null;
      cleanupGame(roomId);
      return ws.send(JSON.stringify({
        type: "left_room"
      }));
    }

    // ===== ЕСЛИ ИГРА НЕ НАЧАЛАСЬ =====

    // возвращаем деньги вышедшему
    await pool.query(
      "UPDATE users SET balance = balance + $1 WHERE id = $2",
      [room.bet, ws.user.id]
    );

    if (room.host_id === ws.user.id) {
      if (room.guest_id) {
        await pool.query(
          "UPDATE rooms SET host_id = $1, guest_id = NULL, status = 'waiting' WHERE id = $2",
          [room.guest_id, roomId]
        );
      } else {
        await pool.query(
          "DELETE FROM rooms WHERE id = $1",
          [roomId]
        );
      }
    } else if (room.guest_id === ws.user.id) {
      await pool.query(
        "UPDATE rooms SET guest_id = NULL, status = 'waiting' WHERE id = $1",
        [roomId]
      );
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
    SELECT skin_id, animation_id, effect_id
    FROM user_customization
    WHERE user_id = $1
  `, [ws.user.id]);

  const active = customizationResult.rows[0] || {};

  const items = itemsResult.rows.map(item => {

    const isOwned =
      item.price === 0 || ownedIds.has(item.id);

    let isActive = false;

    if (item.type === "skin" && active.skin_id === item.id)
      isActive = true;

    if (item.type === "animation" && active.animation_id === item.id)
      isActive = true;

    if (item.type === "effect" && active.effect_id === item.id)
      isActive = true;

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

  const game = activeGames.get(ws.roomId);
  if (!game) return;

  if (game.processingMove) return;
  game.processingMove = true;

  try {

    const result = game.makeMove(ws.user.id, data.cell);

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

  ws.on("close", () => {

  const roomId = ws.roomId;
  if (!roomId) return;

  const game = activeGames.get(roomId);
  if (!game) return;

  // ❗ отменяем countdown если он был
  if (roomCountdowns.has(roomId)) {
    clearInterval(roomCountdowns.get(roomId));
    roomCountdowns.delete(roomId);

    broadcast(roomId, {
      type: "countdown_cancelled"
    });
  }

  if (!game.disconnected) {
    game.disconnected = {};
  }

  game.disconnected[ws.user.id] = Date.now();

  setTimeout(() => {

    if (!activeGames.has(roomId)) return;

    const currentGame = activeGames.get(roomId);
    if (!currentGame.disconnected) return;

    const stillDisconnected =
      currentGame.disconnected[ws.user.id];

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