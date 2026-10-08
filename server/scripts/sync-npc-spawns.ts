// Adds the NPC spawns data/definitions/npc-spawns.json lacks in an area, from the OSRS Wiki.
//
//   yarn sync:npc-spawns --box 2530,2190,2640,2290 --tag Wyrmscraig          # print what it would add
//   yarn sync:npc-spawns --box ... --tag ... --write                         # add them
//   yarn sync:npc-spawns --box ... --wiki wiki.json [--save]                 # use (or write) a saved Wiki copy
//
// Options:
//   --box minX,minY,maxX,maxY[,plane]  the area (repeatable; inclusive; every plane unless given)
//   --tag <word>                       prefer Wiki versions whose label has it ("Idle (Wyrmscraig)")
//   --id <Name>=<npc id>               use this id for a Wiki page's spawns (repeatable)
//   --skip <Name>                      leave a Wiki page's spawns out (Leagues or event NPCs; repeatable)
//   --radius <tiles>                   how far an existing spawn may be from the Wiki's (default 4)
//
// Where the Wiki keeps spawns:
// - monsters: {{LocLine}} rows (bucket "locline"), one coordinate per spawn, ids per page version
//   from bucket "infobox_monster";
// - single NPCs: their infobox {{Map}} (page wikitext), ids from bucket "infobox_npc".
// A LocLine row has no version, so a page's id is chosen: a version whose label has a --tag, else
// the id existing spawns of that page already use most, else the first; the report lists it.
//
// Add-only: per NPC name, a Wiki spawn with an existing one of that name within --radius is
// already there, and leftover existing spawns still count, so only the difference in number is
// added. Nothing is moved or removed, and a second run adds nothing. Added spawns carry
// "source": "wiki".
//
// Wander radius: what existing spawns of that NPC (by id, else by name) mostly use - 0 for fishing
// spots and bankers; else 0 for an NPC without a walk animation in the cache; else the loader's
// default. The Wiki map's `r` only sizes its marker (Mortimer has r=4 and stands still), so it's
// not used. Spawned NPCs with a combat level but no drop table or stats are listed:
// those come from the drop dumper in osrsreboxed-db (plugins/npcs/NpcDrops.plugin.js).
//
// Needs the cache in server/caches - run `yarn ensure-cache` first.
import * as fs from "fs";
import path = require("path");

import { CachePipeline } from "../src/main/typescript/elvarg/game/cache/CachePipeline";
import { CacheDefinitions } from "../src/main/typescript/elvarg/game/cache/CacheDefinitions";

const { parsePoint, parseInfoboxMaps, parseBox, inBoxes, nameKey, planAdditions } = require("./npc-spawn-matching.cjs");

const WIKI_API = "https://oldschool.runescape.wiki/api.php";
const USER_AGENT = "tsps-npc-spawns (https://github.com/RSPSApp/tsps)";
const PAGE = 5000;
const TITLES_PER_REQUEST = 50;
const DEFINITIONS = path.resolve(__dirname, "../data/definitions");
const SPAWNS_FILE = path.join(DEFINITIONS, "npc-spawns.json");

type Spawn = { level: number; name?: string; x: number; y: number; id?: number; key?: string; wanderRadius?: number; source?: string };
/** `ids`: those in the cache; `numbered`: whether the Wiki gave any real id (not "hist11249"). */
type Version = { label: string; ids: number[]; numbered: boolean };
type WikiSpawn = { page: string; versions: Version[]; x: number; y: number; level: number };
type Wiki = { loclines: any[]; monsters: any[]; npcs: any[]; npcMaps: Record<string, string> };

function argValues(flag: string): string[] {
    const values: string[] = [];
    process.argv.forEach((arg, index) => { if (arg === flag && process.argv[index + 1] !== undefined) values.push(process.argv[index + 1]); });
    return values;
}

async function wikiJson(params: Record<string, string>): Promise<any> {
    const response = await fetch(`${WIKI_API}?${new URLSearchParams({ format: "json", ...params })}`, { headers: { "User-Agent": USER_AGENT } });
    if (!response.ok) throw new Error(`Wiki ${response.status} for ${JSON.stringify(params)}`);
    return response.json();
}

async function allRows(select: string): Promise<any[]> {
    const rows: any[] = [];
    for (let offset = 0; ; offset += PAGE) {
        const page = (await wikiJson({ action: "bucket", query: `${select}.limit(${PAGE}).offset(${offset}).run()` })).bucket ?? [];
        rows.push(...page);
        if (page.length < PAGE) return rows;
    }
}

/** The infobox {{Map}} lines of each NPC page (only those, to keep a saved copy small). */
async function npcMaps(pages: string[]): Promise<Record<string, string>> {
    const maps: Record<string, string> = {};
    for (let start = 0; start < pages.length; start += TITLES_PER_REQUEST) {
        const titles = pages.slice(start, start + TITLES_PER_REQUEST).join("|");
        const result = await wikiJson({ action: "query", prop: "revisions", rvprop: "content", rvslots: "main", titles, redirects: "1" });
        const renamed = new Map<string, string>();
        for (const link of [...(result.query?.normalized ?? []), ...(result.query?.redirects ?? [])]) renamed.set(link.to, link.from);
        for (const page of Object.values<any>(result.query?.pages ?? {})) {
            const text: string = page.revisions?.[0]?.slots?.main?.["*"] ?? "";
            const lines = text.split("\n").filter((line) => /^\|\s*map\d*\s*=/i.test(line));
            if (lines.length) maps[renamed.get(page.title) ?? page.title] = lines.join("\n");
        }
        process.stderr.write(`\r  NPC pages ${Math.min(start + TITLES_PER_REQUEST, pages.length)}/${pages.length}`);
    }
    process.stderr.write("\n");
    return maps;
}

async function loadWiki(): Promise<Wiki> {
    const file = argValues("--wiki")[0];
    if (file && fs.existsSync(file) && !process.argv.includes("--save")) return JSON.parse(fs.readFileSync(file, "utf8"));
    const loclines = await allRows("bucket('locline').select('page_name','plane','coordinates')");
    const monsters = await allRows("bucket('infobox_monster').select('page_name','page_name_sub','id')");
    const npcs = await allRows("bucket('infobox_npc').select('page_name','page_name_sub','npc_id')");
    const withLocLines = new Set(loclines.map((row) => row.page_name));
    const npcPages = [...new Set<string>(npcs.map((row) => row.page_name))].filter((page) => !withLocLines.has(page));
    const wiki = { loclines, monsters, npcs, npcMaps: await npcMaps(npcPages) };
    if (file) fs.writeFileSync(file, JSON.stringify(wiki));
    return wiki;
}

/** Page -> its versions in Wiki order, with the cache's ids. */
function versionsByPage(rows: any[], idField: string): Map<string, Version[]> {
    const pages = new Map<string, Version[]>();
    for (const row of rows) {
        const numbers = (row[idField] ?? []).map(Number).filter((id: number) => Number.isInteger(id) && id >= 0);
        const ids = numbers.filter((id: number) => id < CacheDefinitions.getCounts().npcs);
        if (!pages.has(row.page_name)) pages.set(row.page_name, []);
        pages.get(row.page_name)!.push({ label: String(row.page_name_sub ?? row.page_name), ids, numbered: numbers.length > 0 });
    }
    return pages;
}

function wikiSpawns(wiki: Wiki): WikiSpawn[] {
    const spawns: WikiSpawn[] = [];
    const monsterVersions = versionsByPage(wiki.monsters, "id");
    const npcVersions = versionsByPage(wiki.npcs, "npc_id");
    for (const row of wiki.loclines) {
        // LocLine also places scenery and items; only NPC and monster pages count.
        const versions = monsterVersions.get(row.page_name) ?? npcVersions.get(row.page_name);
        if (!versions) continue;
        for (const coordinate of row.coordinates ?? []) {
            const point = parsePoint(coordinate);
            if (point) spawns.push({ page: row.page_name, versions, ...point, level: Number(row.plane) || 0 });
        }
    }
    for (const [page, lines] of Object.entries(wiki.npcMaps)) {
        const versions = npcVersions.get(page) ?? [];
        for (const map of parseInfoboxMaps(lines)) {
            const ofMap = map.version !== null && versions[map.version - 1] ? [versions[map.version - 1]] : versions;
            for (const point of map.points) spawns.push({ page, versions: ofMap, ...point, level: map.plane });
        }
    }
    return spawns;
}

function npcName(id: number): string | undefined {
    try { return CacheDefinitions.getNpc(id)?.name ?? undefined; } catch { return undefined; }
}

/** The id for a page's spawns: --id, a --tag version, the one existing spawns use most, the first. */
function chooseId(page: string, versions: Version[], tags: string[], overrides: Map<string, number>, usage: Map<number, number>): number | null {
    const override = overrides.get(nameKey(page));
    if (override !== undefined) return override;
    const valid = (version: Version) => version.ids.filter((id) => { const name = npcName(id); return name && name !== "null"; });
    const tagged = versions.filter((version) => tags.some((tag) => version.label.toLowerCase().includes(tag)));
    const taggedIds = tagged.flatMap(valid);
    if (taggedIds.length) return taggedIds[0];
    const all = versions.flatMap(valid);
    if (all.length === 0) return null;
    return [...all].sort((a, b) => (usage.get(b) ?? 0) - (usage.get(a) ?? 0))[0];
}

/** The wander radius existing spawns of `key` mostly have (undefined: the loader's default). */
function commonRadius(spawns: Spawn[], matches: (spawn: Spawn) => boolean): { found: boolean; radius?: number } {
    const counts = new Map<number | undefined, number>();
    for (const spawn of spawns) if (matches(spawn)) counts.set(spawn.wanderRadius, (counts.get(spawn.wanderRadius) ?? 0) + 1);
    if (counts.size === 0) return { found: false };
    return { found: true, radius: [...counts].sort((a, b) => b[1] - a[1])[0][0] };
}

function wanderRadius(spawns: Spawn[], id: number, name: string): number | undefined {
    const byId = commonRadius(spawns, (spawn) => spawn.id === id);
    if (byId.found) return byId.radius;
    const byName = commonRadius(spawns, (spawn) => nameKey(spawn.name) === nameKey(name));
    if (byName.found) return byName.radius;
    return (CacheDefinitions.getNpc(id) as any)?.walkSeqId === -1 ? 0 : undefined;
}

function readJson(file: string): any {
    return JSON.parse(fs.readFileSync(path.join(DEFINITIONS, file), "utf8"));
}

function format(spawns: Spawn[]): string {
    return `[\n${spawns.map((spawn) => `  ${JSON.stringify(spawn)}`).join(",\n")}\n]\n`;
}

async function main() {
    const boxes = argValues("--box").map(parseBox);
    if (boxes.length === 0) throw new Error("Give the area with --box minX,minY,maxX,maxY[,plane]");
    const tags = argValues("--tag").map((tag) => tag.toLowerCase());
    const radius = Number(argValues("--radius")[0] ?? 4);
    const overrides = new Map(argValues("--id").map((pair) => {
        const at = pair.lastIndexOf("=");
        return [nameKey(pair.slice(0, at)), Number(pair.slice(at + 1))] as [string, number];
    }));
    const skipped = new Set(argValues("--skip").map(nameKey));
    const write = process.argv.includes("--write");

    await CachePipeline.initialize(path.resolve(__dirname, ".."));
    const source = fs.readFileSync(SPAWNS_FILE, "utf8");
    const spawns: Spawn[] = JSON.parse(source);
    if (format(spawns) !== source) throw new Error("npc-spawns.json isn't in the expected one-spawn-per-line format; not touching it");
    const usage = new Map<number, number>();
    for (const spawn of spawns) if (spawn.id !== undefined) usage.set(spawn.id, (usage.get(spawn.id) ?? 0) + 1);

    const wiki = await loadWiki();
    const unresolved = new Set<string>();
    const candidates: Spawn[] = [];
    for (const spawn of wikiSpawns(wiki)) {
        if (!inBoxes(spawn, boxes) || skipped.has(nameKey(spawn.page))) continue;
        const id = chooseId(spawn.page, spawn.versions, tags, overrides, usage);
        if (id === null) {
            // Historical and event pages have no real ids; only newer-than-cache NPCs are worth a line.
            if (spawn.versions.some((version) => version.numbered)) unresolved.add(spawn.page);
            continue;
        }
        const entry: Spawn = { level: spawn.level, name: npcName(id) ?? spawn.page, x: spawn.x, y: spawn.y, id, source: "wiki" };
        if (skipped.has(nameKey(entry.name))) continue;
        const radiusOf = wanderRadius(spawns, id, entry.name!);
        if (radiusOf !== undefined) entry.wanderRadius = radiusOf;
        candidates.push(entry);
    }
    const existing = spawns.map((spawn) => ({ ...spawn, name: spawn.name ?? (spawn.id !== undefined ? npcName(spawn.id) : undefined) }))
        .filter((spawn) => inBoxes(spawn, boxes));
    const { add, report } = planAdditions(candidates, existing, radius);

    console.log(`Wiki spawns in the area: ${candidates.length}; existing spawns: ${existing.length}; to add: ${add.length}`);
    for (const row of report) {
        const ids = [...new Set(add.filter((spawn: Spawn) => nameKey(spawn.name) === nameKey(row.name) && spawn.level === row.level).map((spawn: Spawn) => spawn.id))];
        console.log(`  ${row.name}${row.level ? ` (plane ${row.level})` : ""}: Wiki ${row.wiki}, existing ${row.existing}, add ${row.added}${ids.length ? ` (id ${ids.join(", ")})` : ""}`);
    }
    if (unresolved.size) console.log(`Not in this cache (newer NPCs): ${[...unresolved].sort().join(", ")}`);

    const drops = readJson("npc-drops.json").npcs ?? {};
    const stats = readJson("monsters-complete.json");
    const lacking = [...new Set<number>(add.map((spawn: Spawn) => spawn.id!))].filter((id) => {
        const level = Number((CacheDefinitions.getNpc(id) as any)?.combatLevel) || 0;
        return level > 0 && (!drops[id] || !stats[id]);
    });
    for (const id of lacking) {
        console.log(`  ${npcName(id)} (${id}) fights but has no ${!drops[id] ? "drop table" : ""}${!drops[id] && !stats[id] ? " or " : ""}${!stats[id] ? "stats" : ""}: rerun the drop dumper`);
    }

    if (!write) { console.log(add.length ? "Dry run: add --write to add them." : "Nothing to add."); return; }
    if (add.length) fs.writeFileSync(SPAWNS_FILE, format([...spawns, ...add]));
    console.log(`Wrote ${add.length} spawn(s) to npc-spawns.json.`);
}

main().catch((error) => { console.error(error); process.exit(1); });
