import { strict as assert } from "assert";

const MakeOverMage = require("../plugins/npcs/MakeOverMage.plugin");

const commands = new Map<string, (event: any) => boolean>();
let login: ((event: any) => void) | undefined;
let play: ((event: any) => boolean) | undefined;
MakeOverMage.register(new Proxy<any>({
  getCombatFactory: () => ({ inCombat: () => false }),
  onPlayerLogin: (handler: any) => { login = handler; },
  onInterfaceActionButton: (_buttonId: number, handler: any) => { play = handler; },
  registerCommand: (name: string, handler: any) => commands.set(name, handler),
}, { get: (target, property) => target[property] ?? (() => undefined) }));

assert.ok(login && play, "plugin must register login and welcome hooks");
assert.deepEqual([...commands.keys()], ["mm", "makeover", "makeovermage"]);

function player(busy = false) {
  const messages: string[] = [];
  const calls: string[] = [];
  const sender = {
    sendInterfaceRemoval: () => { calls.push("remove"); return sender; },
    sendSubInterface: () => { calls.push("open"); return sender; },
    sendMessage: (message: string) => messages.push(message),
    hasInterruptibleInterface: () => false,
  };
  return {
    calls,
    messages,
    player: {
      busy: () => busy,
      getPacketSender: () => sender,
      setInterfaceId: (id: number) => calls.push(`interface:${id}`),
      getAppearance: () => ({ setCanChangeAppearance: (enabled: boolean) => calls.push(`appearance:${enabled}`) }),
      getDialogueManager: () => ({ isActive: () => false }),
    },
  };
}

async function main() {
  const newcomer = player();
  login!({ player: newcomer.player, isNewAccount: true });
  await Promise.resolve();
  assert.deepEqual(newcomer.calls, [], "makeover must wait until the welcome screen is dismissed");
  assert.equal(play!({ player: newcomer.player }), true);
  await Promise.resolve();
  assert.deepEqual(newcomer.calls, ["remove", "interface:679", "appearance:true", "open"]);
  assert.deepEqual(newcomer.messages, ["If you ever want to change your appearance again, type ::mm ingame"]);

  const regular = player();
  assert.equal(commands.get("mm")!({ player: regular.player }), true);
  assert.deepEqual(regular.calls, ["remove", "interface:679", "appearance:true", "open"]);

  const occupied = player(true);
  assert.equal(commands.get("makeover")!({ player: occupied.player }), true);
  assert.deepEqual(occupied.calls, []);
  assert.deepEqual(occupied.messages, ["You cannot change your appearance right now."]);

  console.log("makeover mage plugin ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
