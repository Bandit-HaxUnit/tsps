// Run after `yarn build`: node --test tests/npc-combat-definitions.test.cjs
// data/definitions/npc-combat/: the one-NPC-per-line format that keeps content branches from
// conflicting, file names, and where the admin animation save writes.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const {
  findNpcCombatFile,
  npcCombatFileName,
  readNpcCombatEntries,
  readNpcCombatFile,
  writeNpcCombatFile,
} = require("../dist/game/definition/NpcCombatDefinitionFiles");
const { _test: admin } = require("../plugins/commands/AdminCommands.plugin");

const DIRECTORY = path.join(__dirname, "../data/definitions/npc-combat");

test("every npc-combat file is one NPC per line, sorted, and no id is in two files", () => {
  const entries = readNpcCombatEntries(DIRECTORY);
  assert.ok(Object.keys(entries).length > 600);
  for (const name of fs.readdirSync(DIRECTORY)) {
    const file = path.join(DIRECTORY, name);
    const before = fs.readFileSync(file, "utf8");
    const scratch = path.join(os.tmpdir(), `npc-combat-${process.pid}-${name}`);
    writeNpcCombatFile(scratch, readNpcCombatFile(file));
    assert.equal(fs.readFileSync(scratch, "utf8"), before, `${name} is not in the one-NPC-per-line format`);
    fs.rmSync(scratch);
  }
});

test("file names come from the NPC's name", () => {
  assert.equal(npcCombatFileName("Akkha's Shadow"), "akkhas-shadow.json");
  assert.equal(npcCombatFileName("K'ril Tsutsaroth"), "kril-tsutsaroth.json");
  assert.equal(npcCombatFileName(""), "unnamed.json");
});

test("the admin save edits the file holding an NPC, or starts one named after it", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "npc-combat-"));
  try {
    writeNpcCombatFile(path.join(directory, "boss.json"), { 100: { name: "Boss", anims: { attack: 1 } } });
    admin.writeNpcCombatAnimations([100, 101], { block: 2 }, directory, (id) => (id === 100 ? "Boss" : "Minion"));
    assert.deepEqual(readNpcCombatFile(path.join(directory, "boss.json")), {
      100: { name: "Boss", anims: { attack: 1, block: 2 } },
    });
    assert.deepEqual(readNpcCombatFile(path.join(directory, "minion.json")), {
      101: { name: "Minion", anims: { block: 2 } },
    });
    assert.equal(findNpcCombatFile(directory, 101), path.join(directory, "minion.json"));
    writeNpcCombatFile(path.join(directory, "copy.json"), { 100: {} });
    assert.throws(() => readNpcCombatEntries(directory), /both boss\.json and copy\.json/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
