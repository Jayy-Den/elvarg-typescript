const { Task } = require("../../src/main/typescript/elvarg/game/task/Task");
const { GameConstants } = require("../../src/main/typescript/elvarg/game/GameConstants");
const { ObjectIdentifiers } = require("../../src/main/typescript/elvarg/util/ObjectIdentifiers");
const Presets = require("./pvp/Presets");

function openPresets({ player }) {
  if (player.busy?.()) {
    player.getPacketSender().sendInterfaceRemoval();
  }
  Presets.openPresetInterface(player, Presets.getGlobalPresetPool()[0] ?? null);
  return true;
}

const OPEN_PRESETS_DELAY_TICKS = 2;
let TaskManager;

function isAtDefaultRespawn(player) {
  const location = player?.getLocation?.();
  const respawn = GameConstants.DEFAULT_LOCATION;
  if (!location || !respawn) {
    return false;
  }
  return (
    location.getX?.() === respawn.getX?.() &&
    location.getY?.() === respawn.getY?.() &&
    location.getZ?.() === respawn.getZ?.()
  );
}

class OpenPresetsAfterDeath extends Task {
  constructor(player) {
    super(OPEN_PRESETS_DELAY_TICKS, false);
    this.player = player;
  }

  execute() {
    this.stop();
    const player = this.player;
    if (!player.isRegistered?.() || player.getHitpoints?.() <= 0
        || !Presets.shouldOpenOnDeath(player) || !isAtDefaultRespawn(player)) return;
    openPresets({ player });
  }
}

function openPresetsAfterDeath({ victim }) {
  if (!victim || victim.isPlayerBot?.() || !Presets.shouldOpenOnDeath(victim)) return;
  TaskManager.submit(new OpenPresetsAfterDeath(victim));
}

function loadObjectSpawns() {
  return [
    { id: ObjectIdentifiers.ORNATE_POOL_OF_REJUVENATION, type: 10, face: 0,
      position: { x: 3085, y: 3518, z: 0 } },
    { id: ObjectIdentifiers.ALTAR_OF_THE_OCCULT, type: 10, face: 0,
      position: { x: 3087, y: 3518, z: 0 } },
  ];
}

module.exports = {
  name: "PvpMode",
  register(api) {
    TaskManager = api.getTaskManager();
    Presets.register(api);
    api.registerCommand("presets", openPresets);
    api.onPlayerDefeated(openPresetsAfterDeath);
    api.registerDefinitionSource("object_spawns", { load: loadObjectSpawns });
  },
};
