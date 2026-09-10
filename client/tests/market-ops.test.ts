import assert from "node:assert/strict";
import { Opcodes } from "../rs/cs2/Opcodes";
import { registerMarketOps } from "../rs/cs2/handlers/MarketOps";

const values = new Int32Array(8000);
values[3204] = -1;
const ctx: any = {
    intStack: new Int32Array(8),
    intStackSize: 0,
    pushInt(value: number) { this.intStack[this.intStackSize++] = value; },
    popInt() { return this.intStack[--this.intStackSize]; },
    varManager: { getVarp: (id: number) => values[id] },
};
const handlers = new Map<any, any>();
registerMarketOps(handlers);
const run = (opcode: Opcodes, slot = 0) => {
    ctx.pushInt(slot);
    handlers.get(opcode)(ctx, 0, null);
    return ctx.popInt();
};

assert.equal(run(Opcodes.STOCKMARKET_ISOFFEREMPTY), 1);
assert.equal(run(Opcodes.STOCKMARKET_GETOFFERITEM), -1);

values[3204] = 4151;
values[7900] = 1200000;
values[7901] = 2;
values[7902] = 2;
values[7903] = 2400000;
values[7904] = 1;
values[7905] = 5;
assert.equal(run(Opcodes.STOCKMARKET_ISOFFEREMPTY), 0);
assert.equal(run(Opcodes.STOCKMARKET_GETOFFERITEM), 4151);
assert.equal(run(Opcodes.STOCKMARKET_GETOFFERPRICE), 1200000);
assert.equal(run(Opcodes.STOCKMARKET_GETOFFERCOUNT), 2);
assert.equal(run(Opcodes.STOCKMARKET_GETOFFERCOMPLETEDCOUNT), 2);
assert.equal(run(Opcodes.STOCKMARKET_GETOFFERCOMPLETEDGOLD), 2400000);
assert.equal(run(Opcodes.STOCKMARKET_GETOFFERTYPE), 1);
assert.equal(run(Opcodes.STOCKMARKET_ISOFFERFINISHED), 1);

console.log("market opcode tests passed");

// Native search result script 754 resumes an object dialog with the chosen ID.
import { registerClientOps } from "../rs/cs2/handlers/ClientOps";
registerClientOps(handlers);
let selected: unknown;
ctx.cs2Vm = { onInputDialogComplete: (type: string, value: number) => { selected = [type, value]; } };
ctx.pushInt(4151);
handlers.get(Opcodes.RESUME_OBJDIALOG)(ctx, 0, null);
assert.deepEqual(selected, ["obj", 4151]);
assert.equal(ctx.intStackSize, 0);
