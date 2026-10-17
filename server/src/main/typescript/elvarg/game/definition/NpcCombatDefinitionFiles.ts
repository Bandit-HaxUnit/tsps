import fs = require("fs");
import path = require("path");

/**
 * NPC combat definitions (animations, sounds, projectile, death ticks) live in
 * `data/definitions/npc-combat/`: any number of JSON files, each mapping NPC ids to entries,
 * one NPC per line. Content adds its own file instead of editing a shared one, so branches
 * that add different NPCs never touch the same lines. `npc-combat-defs.json` keeps only the
 * inferred `refs` rows and the fallback `defaults`.
 */
export const NPC_COMBAT_DIRECTORY_NAME = "npc-combat";

export type NpcCombatEntries = Record<string, any>;

/** Every entry in the directory, by NPC id. An id in two files is an error, not an override. */
export function readNpcCombatEntries(directory: string): NpcCombatEntries {
    const entries: NpcCombatEntries = {};
    const owners: Record<string, string> = {};
    for (const name of listNpcCombatFiles(directory)) {
        for (const [id, entry] of Object.entries(readNpcCombatFile(path.join(directory, name)))) {
            if (owners[id]) throw new Error(`NPC ${id} has combat definitions in both ${owners[id]} and ${name}`);
            owners[id] = name;
            entries[id] = entry;
        }
    }
    return entries;
}

/** The file in the directory that holds an NPC, or null. */
export function findNpcCombatFile(directory: string, npcId: number | string): string | null {
    const key = String(npcId);
    for (const name of listNpcCombatFiles(directory)) {
        const file = path.join(directory, name);
        if (Object.prototype.hasOwnProperty.call(readNpcCombatFile(file), key)) return file;
    }
    return null;
}

export function readNpcCombatFile(file: string): NpcCombatEntries {
    const entries = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!entries || typeof entries !== "object" || Array.isArray(entries)) {
        throw new Error(`${path.basename(file)} must map NPC ids to combat definitions`);
    }
    return entries;
}

/** Writes entries sorted by id, one per line, so a diff names exactly the NPCs it changes. */
export function writeNpcCombatFile(file: string, entries: NpcCombatEntries): void {
    const ids = Object.keys(entries).sort((a, b) => Number(a) - Number(b));
    const lines = ids.map((id) => `  ${JSON.stringify(id)}: ${JSON.stringify(entries[id])}`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `{\n${lines.join(",\n")}\n}\n`, "utf8");
}

/** The file a new NPC goes in when nothing else holds it: its name, lowercased and hyphenated. */
export function npcCombatFileName(npcName: string | null | undefined): string {
    const slug = String(npcName ?? "").toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    return `${slug || "unnamed"}.json`;
}

function listNpcCombatFiles(directory: string): string[] {
    if (!fs.existsSync(directory)) return [];
    return fs.readdirSync(directory).filter((name) => name.endsWith(".json")).sort();
}
