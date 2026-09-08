import { strict as assert } from "assert";
import { ItemIdentifiers } from "../src/main/typescript/elvarg/util/ItemIdentifiers";
import { Skill } from "../src/main/typescript/elvarg/game/model/Skill";

const plugin = require("../plugins/items/PegasianBoots.plugin.js");

let itemOnItem: any;
plugin.register({ onItemOnItem: (handler: any) => (itemOnItem = handler) });

const messages: string[] = [];
const experience: Array<[Skill, number]> = [];
const amounts = new Map([
  [ItemIdentifiers.PEGASIAN_CRYSTAL, 1],
  [ItemIdentifiers.RANGER_BOOTS, 1],
]);
const inventory: any = {
  getAmount: (id: number) => amounts.get(id) ?? 0,
  deleteNumber: (id: number, amount: number) => amounts.set(id, (amounts.get(id) ?? 0) - amount),
  addItem: (item: any) => amounts.set(item.getId(), (amounts.get(item.getId()) ?? 0) + item.getAmount()),
};
let levels = new Map<Skill, number>([
  [Skill.MAGIC, 60],
  [Skill.RUNECRAFTING, 60],
]);
const player: any = {
  getInventory: () => inventory,
  getSkillManager: () => ({
    getMaxLevel: (skill: Skill) => levels.get(skill) ?? 1,
    addExperiences: (skill: Skill, xp: number) => experience.push([skill, xp]),
  }),
  getPacketSender: () => ({ sendMessage: (message: string) => messages.push(message) }),
};

const event: any = {
  player,
  usedItemId: ItemIdentifiers.PEGASIAN_CRYSTAL,
  usedWithItemId: ItemIdentifiers.RANGER_BOOTS,
  handled: false,
};
itemOnItem(event);
assert.equal(event.handled, true);
assert.equal(amounts.get(ItemIdentifiers.PEGASIAN_CRYSTAL), 0);
assert.equal(amounts.get(ItemIdentifiers.RANGER_BOOTS), 0);
assert.equal(amounts.get(ItemIdentifiers.PEGASIAN_BOOTS), 1);
assert.deepEqual(experience, [[Skill.MAGIC, 200], [Skill.RUNECRAFTING, 200]]);

amounts.set(ItemIdentifiers.PEGASIAN_CRYSTAL, 1);
amounts.set(ItemIdentifiers.RANGER_BOOTS, 1);
levels = new Map([[Skill.MAGIC, 59], [Skill.RUNECRAFTING, 60]]);
assert.equal(plugin._test.combine(player), false);
assert.equal(amounts.get(ItemIdentifiers.PEGASIAN_CRYSTAL), 1);
assert.equal(amounts.get(ItemIdentifiers.RANGER_BOOTS), 1);
assert(messages.at(-1)?.includes("level 60 Magic and Runecrafting"));
console.info("pegasian boots plugin smoke test passed");
