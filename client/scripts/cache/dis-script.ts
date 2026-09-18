import { CacheSystem } from "../../rs/cache/CacheSystem";
import { IndexType } from "../../rs/cache/IndexType";
import { Opcodes, parseScriptFromBytes } from "../../rs/cs2/Script";
import { loadOpcodeDbOsrs } from "../../rs/cs2/OpcodeDb";
import { ByteBuffer } from "../../rs/io/ByteBuffer";
import { loadCache, loadCacheInfos, loadCacheList } from "./load-util";

const caches = loadCacheInfos();
const cacheInfo = loadCacheList(caches).latest;
const loaded = loadCache(cacheInfo);
const cacheSystem = CacheSystem.fromFiles(cacheInfo, loaded.files);
const index = cacheSystem.getIndex(IndexType.DAT2.clientScript);
const db = loadOpcodeDbOsrs("");

const scriptId = parseInt(process.argv[2] || "175", 10);
const arch = index.getArchive(scriptId);
const file = arch.getFile(0);
const data = file!.data;
const script = parseScriptFromBytes(scriptId, data, cacheSystem.decodeProfile);

// Re-walk the bytecode to record the byte pc of every instruction index.
const inBuf = new ByteBuffer(data);
inBuf.offset = inBuf.length - 2;
const switchLength = inBuf.readUnsignedShort();
const profile = cacheSystem.decodeProfile;
const endIdx =
    inBuf.length - 2 - switchLength - (profile.clientScriptLongCounts ? 16 : 12);
inBuf.offset = 0;
inBuf.readNullString();

const pcs: number[] = [];
for (let i = 0; inBuf.offset < endIdx; i++) {
    pcs.push(inBuf.offset);
    const opcode = inBuf.readUnsignedShort();
    switch (opcode) {
        case Opcodes.SCONST:
            inBuf.readString();
            break;
        case Opcodes.LCONST: {
            inBuf.readInt();
            inBuf.readInt();
            break;
        }
        case Opcodes.RETURN:
        case Opcodes.POP_INT:
        case Opcodes.POP_OBJECT:
        case Opcodes.POP_LONG:
        case Opcodes.PUSH_NULL:
            inBuf.readUnsignedByte();
            break;
        default:
            if (opcode < 100) inBuf.readInt();
            else inBuf.readUnsignedByte();
            break;
    }
}

const pcToIndex = new Map<number, number>();
pcs.forEach((pc, i) => pcToIndex.set(pc, i));
const pcTo = (pc: number) => pcToIndex.get(pc) ?? `pc${pc}`;

console.log(
    `Script ${scriptId} "${script.name}" intArgs=${script.intArgCount} objArgs=${script.objArgCount} localInt=${script.localIntCount} localObj=${script.localObjCount} instr=${script.instructions.length}`,
);

if (script.switches) {
    for (let s = 0; s < script.switches.length; s++) {
        const entries: string[] = [];
        for (const [key, off] of script.switches[s]) {
            entries.push(`key=${key} -> pc+${off}`);
        }
        console.log(`  SWITCH ${s}: ${entries.join(", ")}`);
    }
}

for (let i = 0; i < script.instructions.length; i++) {
    const op = script.instructions[i];
    const intOp = script.intOperands[i];
    const strOp = script.stringOperands[i];
    const name = db.find(op)?.name ?? `op_${op}`;
    let extra = "";
    if (name === "jump") {
        extra = `  ; -> [${pcTo(pcs[i] + 6 + intOp)}]`;
    } else if (name.startsWith("if_")) {
        extra = `  ; -> [${pcTo(pcs[i] + 6 + intOp)}] (fallthrough [${i + 1}])`;
    } else if (name === "switch") {
        // resolve table entries relative to pc after this instruction
        const table = script.switches?.[intOp];
        const parts: string[] = [];
        if (table) for (const [key, off] of table) parts.push(`${key}->[${pcTo(pcs[i] + 6 + off)}]`);
        extra = `  ; table${intOp}: ${parts.join(", ")}`;
    } else if (strOp) {
        extra = `  ; "${strOp}"`;
    }
    console.log(`  [${i}] pc=${pcs[i]} ${name}(${op}) int=${intOp}${extra}`);
}
