const fs = require("fs");
const path = require("path");

const { DynamicDialogueBuilder } = require("../../src/main/typescript/elvarg/game/model/dialogues/builders/DynamicDialogueBuilder");
const { NpcDialogue } = require("../../src/main/typescript/elvarg/game/model/dialogues/entries/impl/NpcDialogue");
const { PlayerDialogue } = require("../../src/main/typescript/elvarg/game/model/dialogues/entries/impl/PlayerDialogue");
const { StatementDialogue } = require("../../src/main/typescript/elvarg/game/model/dialogues/entries/impl/StatementDialogue");
const { OptionDialogue } = require("../../src/main/typescript/elvarg/game/model/dialogues/entries/impl/OptionDialogue");
const { DialogueExpression } = require("../../src/main/typescript/elvarg/game/model/dialogues/DialogueExpression");

/**
 * Loads data/definitions/dialogues.json so every NPC defined there supports
 * "Talk-to".
 *
 * The file holds flat dialogue chains: each entry has an id, a type
 * (NPC_STATEMENT / PLAYER_STATEMENT / STATEMENT / OPTION), 1-5 text lines,
 * an optional anim (expression) name, an optional npcId and a `next` id
 * (-1 ends the conversation). Entries without an npcId are shared fragments
 * (option menus, common replies) reachable from several NPCs' chains.
 *
 * Chains are compiled per NPC on click (per player), mirroring the
 * MakeOverMage plugin's DynamicDialogueBuilder pattern: `next` pointers become
 * continue-actions, OPTION entries become option menus whose selections close
 * the conversation (the data set defines no option actions; the last option is
 * conventionally "Cancel"). NPCs that already have a first_click interaction
 * in npc_interactions.json keep theirs - the core handler runs first and
 * claims the click, so shops etc. are unaffected.
 */

const EXPRESSIONS = {
    DEFAULT: DialogueExpression.DEFAULT,
    CALM: DialogueExpression.CALM,
    HAPPY: DialogueExpression.HAPPY,
    CALM_CONTINUED: DialogueExpression.CALM_CONTINUED,
    EVIL: DialogueExpression.EVIL,
    ANNOYED: DialogueExpression.ANNOYED,
};

const DIALOGUE_FILE = path.resolve("data/definitions/dialogues.json");

function entryLines(entry) {
    const out = [];
    for (const key of ["line1", "line2", "line3", "line4", "line5"]) {
        const value = entry[key];
        if (typeof value === "string" && value.length > 0) {
            out.push(value);
        }
    }
    return out;
}

function expressionFor(entry) {
    return EXPRESSIONS[String(entry.anim ?? "DEFAULT").toUpperCase()] ?? DialogueExpression.DEFAULT;
}

/**
 * A dialogue chain compiled for one NPC on click. Entry ids from the JSON are
 * used as dialogue indexes so `next` pointers jump correctly; the chain starts
 * at the NPC's lowest owned entry id.
 */
class JsonDialogueChain extends DynamicDialogueBuilder {
    constructor(npcId, firstId, byId) {
        super();
        this.npcId = npcId;
        this.firstId = firstId;
        this.byId = byId;
    }

    build(player) {
        const seen = new Set();
        // Ends the conversation: removes the chatbox and clears dialogue state.
        // Without this, advance() would fall through to the next numeric entry
        // id, which can belong to an unrelated conversation branch.
        const closeConversation = {
            execute: (p) => {
                p.getPacketSender().sendInterfaceRemoval();
                p.getDialogueManager().reset();
            },
        };
        const visit = (entryId) => {
            if (seen.has(entryId)) return;
            const entry = this.byId.get(entryId);
            if (!entry) return;
            seen.add(entryId);

            const lines = entryLines(entry);
            if (lines.length === 0) return;

            const next = entry.next ?? -1;
            const hasNext = next >= 0 && this.byId.has(next);
            const expression = expressionFor(entry);
            const text = lines.join(" ");
            // Shared fragments (npcId == null) speak as the NPC being talked to.
            const npcForEntry = entry.npcId ?? this.npcId;

            const continueToNext = hasNext
                ? {
                      execute: (player) => {
                          player.getDialogueManager().startDialogue(next);
                      },
                  }
                : undefined;

            let dialogue;
            switch (entry.type) {
                case "NPC_STATEMENT":
                    dialogue = new NpcDialogue(
                        entry.id,
                        npcForEntry,
                        text,
                        expression,
                        continueToNext ?? closeConversation,
                    );
                    break;
                case "PLAYER_STATEMENT":
                    dialogue = new PlayerDialogue(entry.id, text, expression);
                    dialogue.setContinueAction(continueToNext ?? closeConversation);
                    break;
                case "STATEMENT":
                    dialogue = new StatementDialogue(entry.id, text);
                    dialogue.setContinueAction(continueToNext ?? closeConversation);
                    break;
                case "OPTION": {
                    // The data set defines no option actions; any selection
                    // ends the conversation (the last option is the "Cancel").
                    const endConversation = {
                        executeOption: () => {
                            player.getPacketSender().sendInterfaceRemoval();
                            player.getDialogueManager().reset();
                        },
                    };
                    dialogue = new OptionDialogue(entry.id, endConversation, ...lines);
                    break;
                }
                default:
                    return;
            }

            this.add(dialogue);
            if (hasNext) {
                visit(next);
            }
        };

        // Compile from every entry owned by this NPC (a few NPCs have several
        // separate conversations reachable from different option branches).
        for (const entry of this.byId.values()) {
            if (entry.npcId === this.npcId) {
                visit(entry.id);
            }
        }
    }
}

module.exports = {
    name: "JsonDialogues",
    register(api) {
        let raw;
        try {
            raw = JSON.parse(fs.readFileSync(DIALOGUE_FILE, "utf8"));
        } catch (error) {
            console.warn("[JsonDialogues] failed to read dialogues.json", error);
            return;
        }
        if (!Array.isArray(raw)) {
            console.warn("[JsonDialogues] dialogues.json must be an array");
            return;
        }

        const byId = new Map();
        for (const entry of raw) {
            if (entry && Number.isInteger(entry.id)) {
                byId.set(entry.id, entry);
            }
        }

        const npcIds = [...new Set(raw.filter((e) => e && Number.isInteger(e.npcId)).map((e) => e.npcId))];
        const firstIdByNpc = new Map();
        for (const entry of byId.values()) {
            if (!Number.isInteger(entry.npcId)) continue;
            const current = firstIdByNpc.get(entry.npcId);
            if (current === undefined || entry.id < current) {
                firstIdByNpc.set(entry.npcId, entry.id);
            }
        }

        for (const npcId of npcIds) {
            const firstId = firstIdByNpc.get(npcId);
            api.onNpcInteraction((event) => {
                if (event.npcId !== npcId || event.clickType !== 1) return;
                event.player.getDialogueManager().startDialog(
                    new JsonDialogueChain(npcId, firstId, byId),
                    firstId,
                );
                event.handled = true;
            });
        }

        console.info(
            `[JsonDialogues] registered Talk-to dialogues for ${npcIds.length} NPCs ` +
                `(${byId.size} entries)`,
        );
    },
};
