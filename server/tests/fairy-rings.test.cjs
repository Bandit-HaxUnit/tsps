// Run after `yarn build`: node --test tests/fairy-rings.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");
const path = require("node:path");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { ItemIdentifiers } = require("../dist/util/ItemIdentifiers");
const FairyRings = require("../plugins/world/FairyRings.plugin");

const teleports = [];
const dials = new Map();
const interfaces = [];
let questRegistered = false;

FairyRings.register({
  core: {
    ItemIdentifiers,
    GameConstants: { DEFINITIONS_DIRECTORY: path.join(__dirname, "..", "data", "definitions") },
    TeleportHandler: {
      checkReqs: () => true,
      teleport: (player, destination, type, warning) => teleports.push({ destination, type, warning }),
    },
    TeleportType: { NORMAL: "NORMAL" },
  },
  persistAttribute() {},
  onObjectInteraction() {},
  onInterfaceActionClick() {},
  log() {},
});

function createPlayer({ staff = false, inventoryStaff = false } = {}) {
  const attributes = new Map();
  const messages = [];
  const player = {
    messages,
    getEquipment: () => ({ contains: (id) => staff && id === ItemIdentifiers.DRAMEN_STAFF }),
    getInventory: () => ({ contains: (id) => inventoryStaff && id === ItemIdentifiers.LUNAR_STAFF }),
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    sendMessage: (message) => messages.push(message),
    getPacketSender: () => ({
      getVarbit: (id) => dials.get(id) ?? 0,
      sendVarbit: (id, value) => { dials.set(id, value); return this; },
      sendInterface: (id) => { interfaces.push(id); return this; },
      sendInterfaceRemoval: () => { interfaces.push(-1); return this; },
    }),
  };
  return player;
}

test("the fairy ring table has every location with unique codes", () => {
  const destinations = FairyRings._test.loadDestinations();
  assert.equal(destinations.size, 53);
  const aiq = destinations.get("AIQ");
  assert.deepEqual([aiq.getX(), aiq.getY(), aiq.getZ()], [2996, 3114, 0]);
  const alq = destinations.get("ALQ");
  assert.deepEqual([alq.getX(), alq.getY()], [3597, 3495]);
  const cip = destinations.get("CIP");
  assert.deepEqual([cip.getX(), cip.getY()], [2513, 3884]);
  const ajr = destinations.get("AJR");
  assert.deepEqual([ajr.getX(), ajr.getY()], [2780, 3613]);
});

test("dial varbits map to the twelve fairy letters", () => {
  const player = createPlayer({ staff: true });
  FairyRings._test.setDials(player, "AJR");
  assert.deepEqual(FairyRings._test.DIAL_VARBITS.map((varbit) => dials.get(varbit)), [0, 1, 2]);
  assert.equal(FairyRings._test.codeFromDials(player), "AJR");
});

test("using a ring needs a dramen or lunar staff", () => {
  interfaces.length = 0;
  const bare = createPlayer();
  FairyRings._test.openDial({ player: bare });
  assert.equal(interfaces.length, 0);
  assert.match(bare.messages.at(-1), /dramen or lunar staff/);

  const staffed = createPlayer({ inventoryStaff: true });
  FairyRings._test.openDial({ player: staffed });
  assert.deepEqual(interfaces, [FairyRings._test.FAIRY_RING_INTERFACE_ID]);
});

test("confirming a code teleports to its destination and remembers it", () => {
  teleports.length = 0;
  const player = createPlayer({ staff: true });
  FairyRings._test.setDials(player, "CIP");
  FairyRings._test.confirmDial({
    player,
    groupId: FairyRings._test.FAIRY_RING_INTERFACE_ID,
    childId: FairyRings._test.CONFIRM_CHILD_ID,
  });
  assert.equal(teleports.length, 1);
  assert.equal(teleports[0].destination.getX(), 2513);
  assert.equal(teleports[0].destination.getY(), 3884);
  assert.equal(teleports[0].type, "NORMAL");
  assert.equal(player.getAttribute(FairyRings._test.LAST_CODE_ATTRIBUTE), "CIP");

  dials.clear();
  FairyRings._test.lastDestination({ player });
  assert.equal(teleports.length, 2, "Last-destination repeats the stored code");
  assert.equal(teleports[1].destination.getX(), 2513);
  void questRegistered;
});

test("an unknown combination is refused without teleporting", () => {
  teleports.length = 0;
  const player = createPlayer({ staff: true });
  FairyRings._test.setDials(player, "AAA");
  FairyRings._test.confirmDial({
    player,
    groupId: FairyRings._test.FAIRY_RING_INTERFACE_ID,
    childId: FairyRings._test.CONFIRM_CHILD_ID,
  });
  assert.equal(teleports.length, 0);
  assert.match(player.messages.at(-1), /not a valid destination/);
});
