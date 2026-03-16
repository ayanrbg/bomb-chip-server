const BOT_NAMES = [
  "CoolBot", "NightOwl", "StarDust", "PixelKing", "ThunderBolt",
  "ShadowFox", "NeonWolf", "CyberPunk", "GhostRider", "IceBreaker",
  "FireStorm", "DarkKnight", "SilverArrow", "CosmicRay", "VoidWalker",
  "ElectricEel", "MoonChild", "SunRise", "StormChaser", "WildCard",
  "CrystalMage", "DiamondDust", "GoldenEagle", "IronFist", "JadePhoenix",
  "LavaLord", "MysticWind", "OceanWave", "PrismPower", "QuantumLeap"
];

const DEFAULT_SKINS = ["default_skin1", "default_skin2", "default_skin3"];

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

let botCounter = 0;

export function createBot() {
  botCounter--;

  return {
    id: botCounter,
    nickname: pickRandom(BOT_NAMES) + Math.floor(Math.random() * 1000),
    isBot: true,
    customization: {
      skin_code: pickRandom(DEFAULT_SKINS),
      effect_code: "default_effect",
      animation_hit_code: "default_anim",
      animation_miss_code: "default_anim_miss",
      animation_win_code: "default_anim_win",
      animation_lose_code: "default_anim_lose"
    }
  };
}

export function botPlaceBombs() {
  const cells = [];
  while (cells.length < 3) {
    const cell = Math.floor(Math.random() * 12);
    if (!cells.includes(cell)) cells.push(cell);
  }
  return cells;
}

export function botChooseCell(revealedSet) {
  const available = [];
  for (let i = 0; i < 12; i++) {
    if (!revealedSet.has(i)) available.push(i);
  }
  if (available.length === 0) return null;
  return pickRandom(available);
}
