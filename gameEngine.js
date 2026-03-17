export class GameEngine {

  constructor(roomId, hostId, guestId) {
    this.roomId = roomId;
    this.bombsTimer = null;
    this.moveTimer = null;

    this.bombsTimeLeft = 20;   // 20 секунд на бомбы
    this.moveTimeLeft = 15;    // 15 секунд на ход
    this.phase = "placing_bombs";
    this.disconnected = {}; // placing_bombs | playing | finished

    // ВСЕ ID ПРИВОДИМ К ЧИСЛАМ
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
      revealed: new Set(),
      customization: null // will be set by server after loading from DB
    };
  }

  setCustomization(playerId, customization) {
    playerId = Number(playerId);
    if (this.players[playerId]) {
      this.players[playerId].customization = customization;
    }
  }

  getAnimations(attackerId, event, opponentId) {
    attackerId = Number(attackerId);
    const attacker = this.players[attackerId];
    const attackerCustom = attacker?.customization || {};

    const animations = [];

    if (event === "hit") {
      animations.push({
        userId: attackerId,
        role: "attacker",
        event: "hit",
        animation_code: attackerCustom.animation_hit_code || "default_anim",
        effect_code: attackerCustom.effect_code || "default_effect"
      });

      if (opponentId != null) {
        opponentId = Number(opponentId);
        const defenderCustom = this.players[opponentId]?.customization || {};
        animations.push({
          userId: opponentId,
          role: "defender",
          event: "damaged",
          animation_code: defenderCustom.animation_lose_code || "default_anim_lose",
          effect_code: defenderCustom.effect_code || "default_effect"
        });
      }
    } else if (event === "miss") {
      animations.push({
        userId: attackerId,
        role: "attacker",
        event: "miss",
        animation_code: attackerCustom.animation_miss_code || "default_anim_miss",
        effect_code: attackerCustom.effect_code || "default_effect"
      });
    }

    return animations;
  }

  getFinishAnimations(winnerId, loserId) {
    winnerId = Number(winnerId);
    loserId = Number(loserId);

    const winnerCustom = this.players[winnerId]?.customization || {};
    const loserCustom = this.players[loserId]?.customization || {};

    return [
      {
        userId: winnerId,
        role: "winner",
        event: "win",
        animation_code: winnerCustom.animation_win_code || "default_anim_win",
        effect_code: winnerCustom.effect_code || "default_effect"
      },
      {
        userId: loserId,
        role: "loser",
        event: "lose",
        animation_code: loserCustom.animation_lose_code || "default_anim_lose",
        effect_code: loserCustom.effect_code || "default_effect"
      }
    ];
  }

  // =========================
  // Состояние для реконнекта
  // =========================
  getStateForPlayer(playerId) {
    playerId = Number(playerId);
    const opponentId = Object.keys(this.players)
      .map(Number)
      .find(id => id !== playerId);

    const player = this.players[playerId];
    const opponent = this.players[opponentId];

    if (!player || !opponent) return null;

    // Клетки, которые атаковал этот игрок (на доске оппонента)
    const yourAttacks = [...opponent.revealed].map(cell => ({
      cell,
      bomb: opponent.bombs.includes(cell)
    }));

    // Клетки, которые атаковал оппонент (на доске этого игрока)
    const opponentAttacks = [...player.revealed].map(cell => ({
      cell,
      bomb: player.bombs.includes(cell)
    }));

    return {
      yourLives: player.lives,
      opponentLives: opponent.lives,
      yourBombs: player.bombs,
      yourAttacks,
      opponentAttacks
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

    // Получаем ID соперника корректно
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
          cell,
          bomb: true,
          explodedPlayer: opponentId,
          livesLeft: 0,
          winner: playerId,
          animations: this.getAnimations(playerId, "hit", opponentId)
        };
      }

      this.turn = opponentId;

      return {
        cell,
        bomb: true,
        explodedPlayer: opponentId,
        livesLeft: opponent.lives,
        nextTurn: opponentId,
        animations: this.getAnimations(playerId, "hit", opponentId)
      };
    }

    // ======================
    // БЕЗОПАСНЫЙ ХОД
    // ======================
    this.turn = opponentId;

    return {
      cell,
      bomb: false,
      nextTurn: opponentId,
      animations: this.getAnimations(playerId, "miss")
    };
  }
}
