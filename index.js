import { GameEngine } from "./gameEngine.js";

const activeGames = new Map();

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

    const token = jwt.sign(
      { id: user.id, nickname: user.nickname },
      process.env.JWT_SECRET,
      { expiresIn: "30m" }
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
      { expiresIn: "30m" }
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

    game.bombsTimeLeft -= 2;

    broadcast(roomId, {
      type: "bombs_phase_update",
      payload: { timeLeft: game.bombsTimeLeft }
    });

    if (game.bombsTimeLeft <= 0) {
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

    game.moveTimeLeft -= 2;

    broadcast(roomId, {
      type: "move_timer_update",
      payload: {
        timeLeft: game.moveTimeLeft,
        currentTurn: game.turn
      }
    });

    if (game.moveTimeLeft <= 0) {
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
wss.on("connection", (ws, req) => {
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
    const { bet } = data;

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

    // создаём комнату
    const result = await pool.query(
    "INSERT INTO rooms (host_id, bet, host_ready, guest_ready) VALUES ($1,$2,false,false) RETURNING *",
    [ws.user.id, bet]
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
    const { roomId } = data;

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
    if (updatedRoom.host_ready && updatedRoom.guest_ready) {

  if (activeGames.has(ws.roomId)) return;

  await pool.query(
    "UPDATE rooms SET status = 'playing' WHERE id = $1",
    [ws.roomId]
  );

  const game = new GameEngine(
    ws.roomId,
    updatedRoom.host_id,
    updatedRoom.guest_id
  );

  activeGames.set(ws.roomId, game);

  broadcast(ws.roomId, { type: "game_started" });
  broadcast(ws.roomId, { type: "request_bombs" });
  startBombsTimer(ws.roomId);
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
    console.log("Disconnected:", ws.user?.nickname);
    if (ws.roomId) {
    // эмулируем leave_room
    ws.emit("message", JSON.stringify({ type: "leave_room" }));
  }
  });
});

// ===== Запуск =====
server.listen(process.env.PORT, () => {
  console.log("Server started on port", process.env.PORT);
});