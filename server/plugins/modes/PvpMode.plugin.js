const { ObjectIdentifiers } = require("../../src/main/typescript/elvarg/util/ObjectIdentifiers");
const Presets = require("./pvp/Presets");

function openPresets({ player }) {
  if (player.busy?.()) {
    player.getPacketSender().sendInterfaceRemoval();
  }
  Presets.openPresetInterface(player, player.getCurrentPreset?.() ?? null);
  return true;
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
    Presets.register(api);
    api.registerCommand("presets", openPresets);
    api.registerDefinitionSource("object_spawns", { load: loadObjectSpawns });
  },
};
