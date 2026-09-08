import { strict as assert } from "assert";
import { Item } from "../src/main/typescript/elvarg/game/model/Item";
import { Barrows } from "../src/main/typescript/elvarg/game/content/combat/Barrows";

const plugin = require("../plugins/items/Barrows.plugin.js");
const axe = new Item(4718);
assert.equal(plugin._test.setDurability(axe, 999), true);
assert.equal(axe.getId(), 4886, "first combat tick must change a pristine axe to its 100% state");
assert.equal(plugin._test.repairCost(axe), 100, "weapons cost 100 coins per lost degradation point");
assert.equal(plugin._test.setDurability(axe, 0), true);
assert.equal(Barrows.isBroken(axe.getId()), true);

let canEquip: any;
let drop: any;
let bonusProvider: any;
plugin.register({
  getBonusManager: () => ({ update: () => undefined }),
  getTaskManager: () => ({ submit: () => undefined }),
  getCombatFactory: () => ({ inCombat: () => false }),
  onPlayerLogin: () => undefined,
  onPlayerLogout: () => undefined,
  onCanEquip: (handler: any) => (canEquip = handler),
  onItemDropPolicy: (handler: any) => (drop = handler),
  onPlayerDeathItemDrop: () => undefined,
  onNpcFirstClick: () => undefined,
  registerBonusProvider: (provider: any) => (bonusProvider = provider),
  registerMeleeDefenseModifier: () => undefined,
  registerRangedDefenseModifier: () => undefined,
  registerMagicDefenseModifier: () => undefined,
});

const messages: string[] = [];
const blocked: any = { item: axe, allow: null, player: { getPacketSender: () => ({ sendMessage: (message: string) => messages.push(message) }) } };
canEquip(blocked);
assert.equal(blocked.allow, false);
assert.match(messages[0], /broken/);

const dropped = new Item(4718);
drop({ item: dropped });
assert.equal(Barrows.isBroken(dropped.getId()), true, "dropped Barrows gear must become broken");

const verac = [4753, 4757, 4759, 4755].map((id) => new Item(id));
const player = { getEquipment: () => ({ getItems: () => verac, get: () => new Item(-1) }) };
const bonuses = new Array(14).fill(0);
bonusProvider.apply({ player, bonuses });
assert.equal(bonuses[13], 0, "the damned amulet is required for Verac's extra prayer");
const damnedPlayer = { getEquipment: () => ({ getItems: () => verac, get: () => new Item(12853) }) };
bonusProvider.apply({ player: damnedPlayer, bonuses });
assert.equal(bonuses[13], 7, "the damned Verac set adds 7 prayer");
console.log("barrows plugin smoke test passed");
