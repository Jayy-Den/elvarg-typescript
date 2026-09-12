import * as assert from "node:assert/strict";

const { MagicSpellbook } = require("../src/main/typescript/elvarg/game/model/MagicSpellbook");
const { Sounds } = require("../src/main/typescript/elvarg/game/Sounds");
const { ObjectIds } = require("../src/main/typescript/elvarg/util/IdEnums");
const Altars = require("../plugins/objects/Altars.plugin.js");

const nameActions = new Map<string, Record<string, (event: any) => boolean>>();
Altars.register({
  onObjectFirstClick: () => undefined,
  onObjectInteraction: (
    name: string,
    actions: Record<string, (event: any) => boolean>
  ) => {
    nameActions.set(name, actions);
  },
});

const occult = nameActions.get("Altar of the Occult");
assert.ok(occult, "the occult altar must register its name-keyed action map");
assert.deepEqual(
  Object.keys(occult!).sort(),
  ["Ancient", "Arceuus", "Lunar", "Standard", "Venerate"],
  "the occult altar must support all four spellbooks plus Venerate"
);

const ancient = nameActions.get("Ancient Altar");
assert.ok(ancient?.Venerate, "the ancient altar must register Venerate");
const prayer = nameActions.get("Altar");
assert.ok(
  prayer?.["Pray-at"] && prayer.Pray,
  "the prayer altar must handle both cache action spellings"
);

const originalChangeSpellbook = MagicSpellbook.changeSpellbook;
const originalSendSound = Sounds.sendSound;
const selected: any[] = [];
try {
  MagicSpellbook.changeSpellbook = (_player: any, spellbook: any) => selected.push(spellbook);
  Sounds.sendSound = () => undefined;
  const player = { performAnimation: () => undefined };

  // The client transforms the occult altar to match the active spellbook, so
  // each variant's "Venerate" option selects the spellbook its named options
  // omit; assert all four variants through the enum ids.
  const variants: Array<[number, any]> = [
    [ObjectIds.ALTAR_OF_THE_OCCULT, MagicSpellbook.NORMAL],
    [ObjectIds.ALTAR_OF_THE_OCCULT_2, MagicSpellbook.ANCIENT],
    [ObjectIds.ALTAR_OF_THE_OCCULT_3, MagicSpellbook.LUNAR],
    [ObjectIds.ALTAR_OF_THE_OCCULT_4, MagicSpellbook.ARCEUUS],
  ];
  for (const [objectId, spellbook] of variants) {
    assert.equal(occult!.Venerate({ player, objectId }), true);
    assert.equal(
      selected.pop(),
      spellbook,
      `object ${objectId} Venerate must select its spellbook`
    );
  }

  assert.equal(occult!.Standard({ player }), true);
  assert.equal(selected.pop(), MagicSpellbook.NORMAL);
  assert.equal(occult!.Ancient({ player }), true);
  assert.equal(selected.pop(), MagicSpellbook.ANCIENT);
  assert.equal(occult!.Lunar({ player }), true);
  assert.equal(selected.pop(), MagicSpellbook.LUNAR);
  assert.equal(occult!.Arceuus({ player }), true);
  assert.equal(selected.pop(), MagicSpellbook.ARCEUUS);
} finally {
  MagicSpellbook.changeSpellbook = originalChangeSpellbook;
  Sounds.sendSound = originalSendSound;
}

console.log("occult altar ok: venerate plus all four spellbook actions verified");
