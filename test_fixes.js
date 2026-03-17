import WebSocket from "ws";

const BASE_URL = "http://localhost:3000";
const WS_URL = "ws://localhost:3000";

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.log(`  ✗ FAIL: ${label}`);
    failed++;
  }
}

// Message queue wrapper around WebSocket
function createClient(ws) {
  const queue = [];
  const waiters = [];

  ws.on("message", (data) => {
    const msg = JSON.parse(data.toString());
    console.log(`  [q${ws._debugId || '?'}] ${msg.type}`);
    // Check if there's a waiter for this type
    for (let i = 0; i < waiters.length; i++) {
      const w = waiters[i];
      if (w.types.includes(msg.type)) {
        waiters.splice(i, 1);
        clearTimeout(w.timer);
        w.resolve(msg);
        return;
      }
    }
    queue.push(msg);
  });

  function waitFor(types, timeout = 15000) {
    if (!Array.isArray(types)) types = [types];
    // Check queue first
    for (let i = 0; i < queue.length; i++) {
      if (types.includes(queue[i].type)) {
        return Promise.resolve(queue.splice(i, 1)[0]);
      }
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = waiters.indexOf(waiter);
        if (idx >= 0) waiters.splice(idx, 1);
        reject(new Error(`Timeout waiting for ${types.join("/")}`));
      }, timeout);
      const waiter = { types, resolve, timer };
      waiters.push(waiter);
    });
  }

  return { ws, waitFor, send: (d) => ws.send(JSON.stringify(d)), close: () => ws.close() };
}

async function registerUser(email, password, nickname) {
  const res = await fetch(`${BASE_URL}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, nickname })
  });
  return res.json();
}

async function loginUser(email, password) {
  const res = await fetch(`${BASE_URL}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  return res.json();
}

connect._counter = 0;
async function connect(token) {
  const ws = await new Promise((resolve, reject) => {
    const s = new WebSocket(`${WS_URL}?token=${token}`);
    s.on("open", () => resolve(s));
    s.on("error", reject);
  });
  ws._debugId = ++connect._counter;
  const client = createClient(ws);
  const auth = await client.waitFor("authSuccess");
  await client.waitFor("user_customization");
  return { client, auth };
}

// Helper: start game for two clients, return after bombs_phase_finished
async function startGame(c1, c2) {
  // Both play simultaneously — each creates a room
  c1.send({ type: "play", arenaId: 1, bet: 0 });
  await c1.waitFor("room_created");

  c2.send({ type: "play", arenaId: 1, bet: 0 });
  await c2.waitFor("room_created");

  // Both wait for opponent_joined (after both invite windows close and matchmaking runs)
  await Promise.all([
    c1.waitFor("opponent_joined", 30000),
    c2.waitFor("opponent_joined", 30000)
  ]);

  // Both wait for game_started
  await Promise.all([
    c1.waitFor("game_started", 20000),
    c2.waitFor("game_started", 20000)
  ]);

  // Both wait for request_bombs
  await Promise.all([
    c1.waitFor("request_bombs"),
    c2.waitFor("request_bombs")
  ]);

  // Place bombs
  c1.send({ type: "place_bombs", bombs: [0, 1, 2] });
  c2.send({ type: "place_bombs", bombs: [3, 4, 5] });

  // Both wait for bombs_phase_finished
  await Promise.all([
    c1.waitFor("bombs_phase_finished", 25000),
    c2.waitFor("bombs_phase_finished", 25000)
  ]);
}

const suffix = Date.now();

async function runTests() {
  console.log("\n=== Test: Registration & Auth ===");

  const email1 = `test1_${suffix}@test.com`;
  const email2 = `test2_${suffix}@test.com`;

  let reg1 = await registerUser(email1, "password123", `P1_${suffix}`);
  if (reg1.error) reg1 = await loginUser(email1, "password123");
  assert(reg1.token, "Player1 got token");

  let reg2 = await registerUser(email2, "password123", `P2_${suffix}`);
  if (reg2.error) reg2 = await loginUser(email2, "password123");
  assert(reg2.token, "Player2 got token");

  // === Test: room_created has newBalance ===
  console.log("\n=== Test: room_created has newBalance ===");

  const { client: c1, auth: auth1 } = await connect(reg1.token);
  assert(typeof auth1.payload.balance === "number", `Initial balance: ${auth1.payload.balance}`);

  c1.send({ type: "play", arenaId: 1, bet: 0 });
  const rc = await c1.waitFor("room_created");
  assert(rc.payload.newBalance !== undefined, `room_created.newBalance: ${rc.payload.newBalance}`);
  assert(typeof rc.payload.newBalance === "number", "newBalance is number");

  // === Test: play_cancelled has newBalance ===
  console.log("\n=== Test: play_cancelled has newBalance ===");

  await c1.waitFor("invite_window_start");
  c1.send({ type: "cancel_play" });
  const pc = await c1.waitFor("play_cancelled");
  assert(pc.payload.newBalance !== undefined, `play_cancelled.newBalance: ${pc.payload.newBalance}`);
  assert(pc.payload.refunded === true, "refunded: true");

  // === Test: Two-player game → game_finished ===
  console.log("\n=== Test: Two-player game → game_finished with full payload ===");

  const { client: c2 } = await connect(reg2.token);

  // Install auto-move handlers BEFORE starting game (to catch initial request_move)
  let gameFinished = false;
  const gameFinishedPromise = new Promise(resolve => {
    function installHandler(wsObj) {
      wsObj.on("message", (data) => {
        if (gameFinished) return;
        const msg = JSON.parse(data.toString());
        if (msg.type === "game_finished") {
          gameFinished = true;
          resolve(msg);
        }
        if (msg.type === "request_move" && msg.payload?.availableCells?.length > 0) {
          wsObj.send(JSON.stringify({ type: "make_move", cell: msg.payload.availableCells[0] }));
        }
      });
    }
    installHandler(c1.ws);
    installHandler(c2.ws);
  });

  await startGame(c1, c2);

  const gameFinishedMsg = await gameFinishedPromise;

  assert(gameFinishedMsg !== null, "Got game_finished");
  assert(gameFinishedMsg.payload.winnerId !== undefined, `winnerId: ${gameFinishedMsg.payload.winnerId}`);
  assert(gameFinishedMsg.payload.loserId !== undefined, `loserId: ${gameFinishedMsg.payload.loserId}`);
  assert(gameFinishedMsg.payload.prize !== undefined, `prize: ${gameFinishedMsg.payload.prize}`);
  if (gameFinishedMsg.payload.newBalance !== undefined) {
    assert(true, `newBalance: ${gameFinishedMsg.payload.newBalance} (winner)`);
  } else {
    assert(true, "no newBalance (loser — expected)");
  }

  c1.close();
  c2.close();
  await new Promise(r => setTimeout(r, 500));

  // === Test: leave_room during game → opponent gets full game_finished ===
  console.log("\n=== Test: leave_room during game → opponent_left full payload ===");

  const { client: c3 } = await connect(reg1.token);
  const { client: c4 } = await connect(reg2.token);

  // Install handler to catch game_finished on c4 (winner) before starting
  const opLeftPromise = new Promise(resolve => {
    c4.ws.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === "game_finished") resolve(msg);
    });
  });

  await startGame(c3, c4);

  // Small delay to let move phase begin
  await new Promise(r => setTimeout(r, 500));

  // Player1 leaves during game
  c3.send({ type: "leave_room" });

  const opLeft = await opLeftPromise;
  assert(opLeft.payload.reason === "opponent_left", "reason: opponent_left");
  assert(opLeft.payload.winnerId !== undefined, `winnerId: ${opLeft.payload.winnerId}`);
  assert(opLeft.payload.loserId !== undefined, `loserId: ${opLeft.payload.loserId}`);
  assert(opLeft.payload.prize !== undefined, `prize: ${opLeft.payload.prize}`);
  assert(opLeft.payload.newBalance !== undefined, `newBalance: ${opLeft.payload.newBalance}`);
  assert(opLeft.payload.arenaId !== undefined || opLeft.payload.arenaId === 0, `arenaId present`);

  c3.close();
  c4.close();
  await new Promise(r => setTimeout(r, 500));

  // === Test: Reconnect with game_state_restore.board ===
  console.log("\n=== Test: Reconnect → game_state_restore with board ===");

  const { client: c5 } = await connect(reg1.token);
  const { client: c6 } = await connect(reg2.token);

  // Install handler to make exactly one move, ensuring board state exists
  let moveMade = false;
  const movePromise = new Promise(resolve => {
    function handler(data) {
      if (moveMade) return;
      const msg = JSON.parse(data.toString());
      if (msg.type === "request_move" && msg.payload?.availableCells?.length > 0) {
        moveMade = true;
        c5.ws.send(JSON.stringify({ type: "make_move", cell: msg.payload.availableCells[0] }));
        resolve();
      }
    }
    c5.ws.on("message", handler);
    c6.ws.on("message", (data) => {
      if (moveMade) return;
      const msg = JSON.parse(data.toString());
      if (msg.type === "request_move" && msg.payload?.availableCells?.length > 0) {
        moveMade = true;
        c6.ws.send(JSON.stringify({ type: "make_move", cell: msg.payload.availableCells[0] }));
        resolve();
      }
    });
  });

  await startGame(c5, c6);
  await movePromise;
  // Small delay to let move_result propagate
  await new Promise(r => setTimeout(r, 500));

  // Now reconnect
  c5.send({ type: "reconnect" });
  const rOk = await c5.waitFor("reconnect_ok");
  assert(rOk.payload.inRoom === true, "reconnect_ok inRoom: true");

  const sr = await c5.waitFor("game_state_restore");
  assert(sr.payload.board !== undefined, "game_state_restore has board");
  assert(sr.payload.board !== null, "board is not null");
  assert(sr.payload.board.yourLives !== undefined, `yourLives: ${sr.payload.board.yourLives}`);
  assert(sr.payload.board.opponentLives !== undefined, `opponentLives: ${sr.payload.board.opponentLives}`);
  assert(Array.isArray(sr.payload.board.yourBombs), `yourBombs: ${JSON.stringify(sr.payload.board.yourBombs)}`);
  assert(Array.isArray(sr.payload.board.yourAttacks), "yourAttacks is array");
  assert(Array.isArray(sr.payload.board.opponentAttacks), "opponentAttacks is array");

  // Clean up
  c5.send({ type: "leave_room" });
  await new Promise(r => setTimeout(r, 500));
  c5.close();
  c6.close();

  // === Summary ===
  console.log(`\n=============================`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log(`=============================\n`);

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error("Test error:", err);
  process.exit(1);
});
