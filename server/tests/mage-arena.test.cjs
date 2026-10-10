// Run after `yarn build`: node --test tests/mage-arena.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { PluginManager } = require("../dist/plugins/PluginManager");

const MageArena = require("../plugins/minigames/MageArena.plugin");

const core = PluginManager.getCoreApi();
const { battleMages, levers, spells, statues } = MageArena._test;

const SARADOMIN = spells.GODS.find((god) => god.spellId === 1190);
const ZAMORAK = spells.GODS.find((god) => god.spellId === 1192);

function player({ x = 3100, y = 3930, z = 0, cape = -1, spellId = null, attributes = {}, localNpcs } = {}) {
  const attrs = new Map(Object.entries(attributes));
  const messages = [];
  const moved = [];
  return {
    messages,
    moved,
    isPlayer: () => true,
    getAttribute: (key) => attrs.get(key),
    setAttribute: (key, value) => attrs.set(key, value),
    getLocation: () => ({ getX: () => x, getY: () => y, getZ: () => z }),
    getEquipment: () => ({ get: (slot) => (slot === core.Equipment.CAPE_SLOT ? { getId: () => cape } : null) }),
    getCombat: () => ({
      getSelectedSpell: () => (spellId == null ? null : { spellId: () => spellId }),
      getPreviousCast: () => null,
    }),
    getLocalNpcs: () => localNpcs ?? [],
    sendMessage: (message) => messages.push(message),
    moveTo: (location) => moved.push([location.getX(), location.getY()]),
  };
}

function battleMage(id) {
  return { isNpc: () => true, getId: () => id };
}

test("god spell casts count only inside the arena, on a battle mage, with the god spell", () => {
  const caster = player({ spellId: 1192 });
  spells.hitResolved({ attacker: caster, target: battleMage(1610) });
  spells.hitResolved({ attacker: caster, target: battleMage(1611) });
  assert.equal(caster.getAttribute(ZAMORAK.counter), 2, "any battle mage charges the spell");

  const outside = player({ x: 3090, y: 3956, spellId: 1192 });
  spells.hitResolved({ attacker: outside, target: battleMage(1610) });
  assert.equal(outside.getAttribute(ZAMORAK.counter), undefined);

  const wrongTarget = player({ spellId: 1192 });
  spells.hitResolved({ attacker: wrongTarget, target: battleMage(1614) });
  assert.equal(wrongTarget.getAttribute(ZAMORAK.counter), undefined);

  const wrongSpell = player({ spellId: 1181 });
  spells.hitResolved({ attacker: wrongSpell, target: battleMage(1610) });
  assert.equal(wrongSpell.getAttribute(ZAMORAK.counter), undefined);

  const npcCaster = { isPlayer: () => false };
  spells.hitResolved({ attacker: npcCaster, target: battleMage(1610) });
});

test("the 100th cast unlocks the spell, announces it once and caps the counter", () => {
  const caster = player();
  for (let cast = 0; cast < 99; cast++) {
    assert.equal(spells.awardCast(caster, ZAMORAK), true);
  }
  assert.equal(caster.getAttribute(ZAMORAK.counter), 99);
  assert.equal(caster.messages.length, 0, "nothing is announced before 100");

  assert.equal(spells.awardCast(caster, ZAMORAK), true);
  assert.equal(caster.getAttribute(ZAMORAK.counter), 100);
  assert.equal(caster.messages.length, 1);
  assert.match(caster.messages[0], /Flames of Zamorak/);

  assert.equal(spells.awardCast(caster, ZAMORAK), false, "the counter stops at 100");
  assert.equal(caster.messages.length, 1, "the unlock is announced once");
});

test("a locked god spell is cancelled outside the arena; inside or unlocked it is not", () => {
  const outside = player({ x: 3090, y: 3956 });
  const locked = { player: outside, spellId: 1190, disabled: null };
  spells.spellDisabled(locked);
  assert.equal(locked.disabled, true);
  assert.equal(outside.messages.length, 1);
  spells.spellDisabled(locked);
  assert.equal(outside.messages.length, 1, "the refusal message is throttled");

  const inside = player();
  const charging = { player: inside, spellId: 1190, disabled: null };
  spells.spellDisabled(charging);
  assert.equal(charging.disabled, null, "charging inside the arena is how the spell unlocks");

  const unlocked = player({ x: 3090, y: 3956, attributes: { [SARADOMIN.counter]: 100 } });
  const unlockedEvent = { player: unlocked, spellId: 1190, disabled: null };
  spells.spellDisabled(unlockedEvent);
  assert.equal(unlockedEvent.disabled, null, "an unlocked spell stays castable after relog");

  const otherSpell = { player: player({ x: 3090, y: 3956 }), spellId: 1181, disabled: null };
  spells.spellDisabled(otherSpell);
  assert.equal(otherSpell.disabled, null, "non god spells are not touched");
});

test("register persists one counter per god and wires the hooks", () => {
  const persisted = [];
  const hooks = [];
  const api = {
    core,
    persistAttribute: (key) => persisted.push(key),
    onSpellDisabled: () => hooks.push("onSpellDisabled"),
    onCombatHitResolved: () => hooks.push("onCombatHitResolved"),
    onObjectInteraction: (name) => hooks.push(`onObjectInteraction:${name}`),
    onServerStartup: () => hooks.push("onServerStartup"),
    onPlayerProcess: () => hooks.push("onPlayerProcess"),
    registerNpcCombatMethodProvider: (ids) => hooks.push(`combatMethod:${ids}`),
  };
  MageArena.register(api);

  assert.deepEqual(
    persisted.sort(),
    ["mage-arena:charge:guthix", "mage-arena:charge:saradomin", "mage-arena:charge:zamorak"]
  );
  assert.ok(hooks.includes("onSpellDisabled"));
  assert.ok(hooks.includes("onCombatHitResolved"));
  assert.ok(hooks.includes("onObjectInteraction:Lever"));
  assert.ok(hooks.includes("onObjectInteraction:Sparkling pool"));
  assert.ok(hooks.includes("onObjectInteraction:Statue of Saradomin"));
  assert.ok(hooks.includes("onPlayerProcess"));
  assert.deepEqual(
    hooks.filter((hook) => hook.startsWith("combatMethod:")).sort(),
    ["combatMethod:1610", "combatMethod:1611", "combatMethod:1612"]
  );
});

test("the arena levers teleport through the wall; the bank lever falls through", () => {
  const events = [];
  const caster = player();
  levers.setApi({ emitCustomEvent: (name, payload) => events.push({ name, payload }) });
  levers.setCore(core);

  levers.pullLever({ objectId: 9706, player: caster });
  levers.pullLever({ objectId: 9707, player: caster });
  assert.equal(events.length, 2);
  assert.equal(events[0].name, "lever:teleport");
  assert.deepEqual(
    [events[0].payload.destination.getX(), events[0].payload.destination.getY(), events[0].payload.destination.getZ()],
    [3106, 3952, 0]
  );
  assert.deepEqual(
    [events[1].payload.destination.getX(), events[1].payload.destination.getY(), events[1].payload.destination.getZ()],
    [3105, 3956, 0]
  );

  assert.equal(levers.pullLever({ objectId: 5959, player: caster }), false);
  assert.equal(levers.pullLever({ objectId: 5960, player: caster }), false);
  assert.equal(events.length, 2, "the bank lever pair stays with Wilderness.plugin");
});

test("the sparkling pools move between the bank and the statue chamber", () => {
  const caster = player();
  levers.setCore(core);

  levers.stepIntoPool({ objectId: 2878, player: caster });
  levers.stepIntoPool({ objectId: 2879, player: caster });
  assert.deepEqual(caster.moved, [[2509, 4689], [2542, 4718]]);
  assert.equal(levers.stepIntoPool({ objectId: 1000, player: caster }), false);
  assert.equal(caster.moved.length, 2);
});

test("praying at a statue spawns that god's cape on the open tile in front", () => {
  const spawned = [];
  statues.setCore({
    ...core,
    ItemOnGroundManager: {
      registerLocation: (owner, item, location) =>
        spawned.push({ owner, id: item.getId(), x: location.getX(), y: location.getY(), z: location.getZ() }),
    },
  });
  const caster = player();

  statues.prayAt({ player: caster, objectId: 2873 });
  statues.prayAt({ player: caster, objectId: 2874 });
  statues.prayAt({ player: caster, objectId: 2875 });

  assert.deepEqual(
    spawned.map(({ id, x, y, z }) => [id, x, y, z]),
    [[2412, 2500, 4719, 0], [2414, 2516, 4719, 0], [2413, 2507, 4722, 0]],
    "one matching cape per prayer, in front of each statue"
  );
  assert.ok(spawned.every((entry) => entry.owner === caster));

  assert.equal(statues.prayAt({ player: caster, objectId: 1000 }), undefined);
  assert.equal(spawned.length, 3);
});

test("each battle mage casts its own god spell at 4 ticks", () => {
  battleMages.setCore(core);
  const expected = { 1611: 1190, 1610: 1192, 1612: 1191 };
  for (const [npcId, spellId] of Object.entries(expected)) {
    const god = battleMages.godForMage(Number(npcId));
    assert.equal(god.spell.spellId(), Number(spellId));
    assert.equal(god.spell.maximumHit(), 20);

    const Method = battleMages.battleMageCombatMethod(god.spell);
    const method = new Method();
    assert.equal(method.attackSpeed(), 4);

    let cast = null;
    let previous = null;
    const npc = {
      isNpc: () => true,
      getId: () => Number(npcId),
      performAnimation() {},
      getCombat: () => ({
        getSelectedSpell: () => cast,
        setCastSpell: (value) => { cast = value; },
        setPreviousCast: (value) => { previous = value; },
      }),
    };
    method.start(npc, player());
    assert.equal(cast, god.spell, `npc ${npcId} casts its god spell`);
    method.finished(npc);
    assert.equal(previous, god.spell);
    assert.equal(cast, null);
  }
});

test("battle mages tolerate only the player wearing their own god's cape", () => {
  battleMages.setCore({ ...core, NPC: { prototype: { isAggressiveTo: () => true } } });
  const mage = { getId: () => 1611 };
  const other = { getId: () => 1614 };
  battleMages.processPlayer({ player: player({ localNpcs: [mage, other] }) });

  assert.equal(typeof mage.isAggressiveTo, "function");
  assert.equal(typeof other.isAggressiveTo, "undefined", "only battle mages are patched");
  assert.equal(mage.isAggressiveTo(player({ cape: 2412 })), false, "Saradomin's cape is tolerated");
  assert.equal(mage.isAggressiveTo(player({ cape: 21792 })), false, "the imbued cape counts");
  assert.equal(mage.isAggressiveTo(player({ cape: 2414 })), true, "another god's cape is attacked");
  assert.equal(mage.isAggressiveTo(player()), true, "no cape is attacked");

  const outside = { getId: () => 1610 };
  battleMages.processPlayer({ player: player({ x: 3090, y: 3956, localNpcs: [outside] }) });
  assert.equal(typeof outside.isAggressiveTo, "undefined", "nothing is patched outside the arena");
});

test("battle mage aggression is applied on startup, after the definition loader", () => {
  const definitions = new Map();
  battleMages.setCore({
    ...core,
    NpcDefinition: {
      forId: (id) => {
        const definition = definitions.get(id) ?? {};
        definitions.set(id, definition);
        return definition;
      },
    },
  });
  battleMages.configureAggression();

  assert.deepEqual([...definitions.keys()].sort(), [1610, 1611, 1612]);
  for (const definition of definitions.values()) {
    assert.equal(definition.aggressive, true);
    assert.equal(definition.aggressiveTolerance, false, "tolerance must not switch the mages off");
  }
});

test("core already gates the god spells on 60 Magic and the matching staff", () => {
  const godSpells = core.CombatSpells;
  assert.equal(godSpells.SARADOMIN_STRIKE.levelRequired(), 60);
  assert.equal(godSpells.CLAWS_OF_GUTHIX.levelRequired(), 60);
  assert.equal(godSpells.FLAMES_OF_ZAMORAK.levelRequired(), 60);
  assert.equal(godSpells.SARADOMIN_STRIKE.equipmentRequired(player())[0].getId(), 2415);
  assert.equal(godSpells.CLAWS_OF_GUTHIX.equipmentRequired(player())[0].getId(), 2416);
  assert.equal(godSpells.FLAMES_OF_ZAMORAK.equipmentRequired(player())[0].getId(), 2417);
});
