export class GameEngine {

  constructor(roomId, hostId, guestId) {
    this.roomId = roomId;
    this.bombsTimer = null;
    this.moveTimer = null;

    this.bombsTimeLeft = 20;   // 20 секунд на бомбы
    this.moveTimeLeft = 15;    // 15 секунд на ход
    this.phase = "placing_bombs"; // placing_bombs | playing | finished

    // 🔥 ВСЕ ID ПРИВОДИМ К ЧИСЛАМ
    hostId = Number(hostId);
    guestId = Number(guestId);

    this.turn = hostId;

    this.players = {
      [hostId]: this.createPlayerState(),
      [guestId]: this.createPlayerState()
    };
  }

  createPlayerState() {
    return {
      bombs: [],
      lives: 3,
      revealed: new Set()
    };
  }

  // =========================
  // Установка бомб
  // =========================
  placeBombs(playerId, bombs) {

    playerId = Number(playerId);

    if (this.phase !== "placing_bombs") {
      return { error: "Game already started" };
    }

    if (!this.players[playerId]) {
      return { error: "Invalid player" };
    }

    if (!Array.isArray(bombs) || bombs.length !== 3) {
      return { error: "Exactly 3 bombs required" };
    }

    const unique = new Set(bombs);
    if (unique.size !== 3) {
      return { error: "Bombs must be unique" };
    }

    if (bombs.some(b => b < 0 || b > 11)) {
      return { error: "Invalid cell index" };
    }

    this.players[playerId].bombs = bombs;

    const allPlaced = Object.values(this.players)
      .every(p => p.bombs.length === 3);

    if (allPlaced) {
      this.phase = "playing";
      return { success: true, gameStarted: true };
    }

    return { success: true };
  }

  // =========================
  // Ход игрока
  // =========================
  makeMove(playerId, cell) {

    playerId = Number(playerId);

    if (this.phase !== "playing") {
      return { error: "Game not started" };
    }

    if (!this.players[playerId]) {
      return { error: "Invalid player" };
    }

    if (this.turn !== playerId) {
      return { error: "Not your turn" };
    }

    // 🔥 Получаем ID соперника корректно
    const opponentId = Object.keys(this.players)
      .map(Number)
      .find(id => id !== playerId);

    const opponent = this.players[opponentId];

    if (opponent.revealed.has(cell)) {
      return { error: "Cell already opened" };
    }

    opponent.revealed.add(cell);

    // ======================
    // ПОПАЛ В БОМБУ
    // ======================
    if (opponent.bombs.includes(cell)) {

      opponent.lives--;

      if (opponent.lives <= 0) {
        this.phase = "finished";
        return {
          bomb: true,
          explodedPlayer: opponentId,
          livesLeft: 0,
          winner: playerId
        };
      }

      this.turn = opponentId;

      return {
        bomb: true,
        explodedPlayer: opponentId,
        livesLeft: opponent.lives,
        nextTurn: opponentId
      };
    }

    // ======================
    // БЕЗОПАСНЫЙ ХОД
    // ======================
    this.turn = opponentId;

    return {
      bomb: false,
      nextTurn: opponentId
    };
  }
}