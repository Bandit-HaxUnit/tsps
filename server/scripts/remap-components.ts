/**
 * Interface component ids across a cache revision update, matched by gameval name.
 *
 *   yarn remap:components <other cache directory> [--all]
 *
 * Compares the current cache (target.txt) with another cache directory (e.g. a newer revision
 * downloaded elsewhere). Lists, per interface, the components whose id changed or that are gone,
 * then every literal `(group << 16) | component` in server and client code that would point
 * elsewhere. Read-only: it changes nothing.
 */
import * as fs from "fs";
import * as path from "path";
import { CachePipeline } from "../src/main/typescript/elvarg/game/cache/CachePipeline";
import { FileStore } from "../src/main/typescript/elvarg/game/cache/codec/rs/cache/store/FileStore";
import { Gamevals } from "../src/main/typescript/elvarg/game/cache/Gamevals";

const REPO_ROOT = path.resolve(__dirname, "../..");
const SCAN_DIRS = ["server/plugins", "server/src", "client/game", "client/widgets", "client/ui", "client/common"];
const LITERAL_UID = /\(\s*(\d{1,4})\s*<<\s*16\s*\)\s*[|+]\s*(\d{1,5})/g;

function sourceFiles(dir: string, out: string[] = []): string[] {
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === "dist") continue;
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) sourceFiles(file, out);
        else if (/\.(ts|js|cjs)$/.test(entry.name)) out.push(file);
    }
    return out;
}

async function main(): Promise<void> {
    const [otherDir] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
    const all = process.argv.includes("--all");
    if (!otherDir || !fs.existsSync(path.join(otherDir, "main_file_cache.dat2"))) {
        console.error("usage: remap-components <other cache directory> [--all]");
        process.exit(1);
    }
    await CachePipeline.initialize();
    const current = new Gamevals();
    const other = new Gamevals(new FileStore(path.resolve(otherDir)));

    console.log(`== Components by name: ${CachePipeline.getActive().name} -> ${path.basename(path.resolve(otherDir))}`);
    const otherByName = new Map([...other.allInterfaces()].map(([group, iface]) => [iface.name, { group, iface }]));
    let moved = 0;
    let gone = 0;
    for (const [group, iface] of current.allInterfaces()) {
        const next = otherByName.get(iface.name);
        if (!next) {
            const reused = other.allInterfaces().get(group)?.name;
            console.log(`${iface.name} (${group}): interface gone${reused ? `; group ${group} is now ${reused}` : ""}`);
            continue;
        }
        const ids = new Map([...next.iface.components].map(([id, name]) => [name, id]));
        const changes: string[] = [];
        for (const [id, name] of iface.components) {
            const nextId = ids.get(name);
            if (nextId === undefined) {
                gone++;
                changes.push(`${name} ${id} -> gone`);
            } else if (nextId !== id || next.group !== group) {
                moved++;
                changes.push(`${name} ${id} -> ${next.group !== group ? `${next.group}:` : ""}${nextId}`);
            }
        }
        if (changes.length === 0) continue;
        console.log(`${iface.name} (${group}${next.group !== group ? ` -> ${next.group}` : ""}): ${changes.length} changed`);
        for (const change of all ? changes : changes.slice(0, 8)) console.log(`  ${change}`);
        if (!all && changes.length > 8) console.log(`  ... ${changes.length - 8} more (--all)`);
    }
    console.log(`${moved} components moved, ${gone} gone.`);

    console.log("\n== Literal (group << 16) | component in code");
    let hits = 0;
    for (const dir of SCAN_DIRS) {
        for (const file of sourceFiles(path.join(REPO_ROOT, dir))) {
            const lines = fs.readFileSync(file, "utf8").split("\n");
            lines.forEach((line, index) => {
                for (const match of line.matchAll(LITERAL_UID)) {
                    const uid = (Number(match[1]) << 16) | Number(match[2]);
                    const name = current.componentName(uid);
                    if (!name) continue;
                    const nextUid = other.componentId(name);
                    if (nextUid === uid) continue;
                    hits++;
                    const to = nextUid === null ? "gone" : `(${nextUid >>> 16} << 16) | ${nextUid & 0xffff}`;
                    console.log(`${path.relative(REPO_ROOT, file)}:${index + 1}  ${match[0]}  ${name} -> ${to}`);
                }
            });
        }
    }
    console.log(`${hits} literal component ids would point elsewhere. Ids kept in named constants need the list above.`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
