"use strict";

const { Location } = require("../../src/main/typescript/elvarg/game/model/Location");
const { GameObject } = require("../../src/main/typescript/elvarg/game/entity/impl/object/GameObject");
const { MapObjects } = require("../../src/main/typescript/elvarg/game/entity/impl/object/MapObjects");
const { Sound } = require("../../src/main/typescript/elvarg/game/Sound");
const { Sounds } = require("../../src/main/typescript/elvarg/game/Sounds");
const { Task } = require("../../src/main/typescript/elvarg/game/task/Task");
const { CacheDefinitions } = require("../../src/main/typescript/elvarg/game/cache/CacheDefinitions");
const { ObjectIdentifiers: O } = require("../../src/main/typescript/elvarg/util/ObjectIdentifiers");

// OSRS: an opened door/gate that nobody interacts with reverts on its own after
// 300 seconds (500 ticks @ 600ms/tick). Cross-checked against rsmod/OpenRune-Server
// (DoorConstants.DURATION = 500) and a from-scratch OSRS-parity server (DOOR_AUTO_CLOSE_TICKS).
const DOOR_AUTO_CLOSE_TICKS = 500;

const DOOR_RESYNC_TICKS_ATTR = "doors:resyncTicks";

// Always name locs by their ObjectIdentifiers property (O.DOOR_358), never a raw id: the
// generated enum follows the cache, so ids stay right when it changes. Only locs the cache
// leaves nameless have no property; those stay numeric, marked "nameless".

// Single-door closed/open pairs are discovered from this server's own cache instead of a
// hand-picked ID list: OSRS models every plain door as two consecutive loc ids where the
// closed variant offers "Open" and closedId+1 offers "Close" (verified live against this
// cache: e.g. 23972 "Door" Open -> 23973 "Door" Close). A hardcoded whitelist can only ever
// cover the handful of doors someone happened to test; this covers all of them.
//
// Adding a door? Dump the ids around it from the cache first (needs `yarn build`, run from server/):
//   node -e '(async()=>{require("./dist/Server").Server.installProductionPathResolver();
//     await require("./dist/game/cache/CachePipeline").CachePipeline.initialize(process.cwd());
//     const {CacheDefinitions:C}=require("./dist/game/cache/CacheDefinitions");
//     for(const id of [1516,1517,1518,1519,1520]){const d=C.getObject(id);
//     console.log(id,d?.name,JSON.stringify(d?.actions),JSON.stringify(d?.models));}})()' 2>&1 | grep -E "^[0-9]"
// Closed = "Open" action; its open variant is a "Close" loc with the same models (usually id+1).
// Not id+1 -> SINGLE_DOOR_OPEN_IDS. Two leaves -> DOUBLE_DOOR_ID_FAMILIES (+ SPECIAL_* maps when
// the open ids are not closed+1). Same trick works for NPCs/items via C.getNpc / C.getItem.
const DOOR_NAMES = new Set([
  "Door", "Doors", "Large door", "Castle door", "Cell Door", "Cell door",
  "Glass door", "Magic door", "Metal door", "Mind Door", "Tent door",
  "Gate", "Metal gate", "Doorway",
]);

// Doors with no open variant in the cache: OSRS opens them by rotating the same loc
// (open id === closed id). Their consecutive ids are unrelated doors with the same
// model, so the same-model pairing below must not pair them. Tutorial Island:
// start house, chef entry/exit, quest guide, and the bank/prayer area doors. DOOR_358: a single
// door whose same-model "Close" locs (5245, 11617, 15205, 17115) all belong to other doors.
const SELF_OPENING_DOOR_IDS = new Set([O.DOOR_223, O.DOOR_225, O.DOOR_226, O.DOOR_227, O.DOOR_228, O.DOOR_229, O.DOOR_230, O.DOOR_231, O.DOOR_358]);

// Single doors whose open variant is not closedId + 1 (e.g. Large door 1517 -> 1520, same models).
const SINGLE_DOOR_OPEN_IDS = new Map([[O.LARGE_DOOR_11, O.LARGE_DOOR_14]]);

// OSRS wooden gates are two locs that pivot together around the hinge post: a hinge panel
// and an extension panel. Opening/closing moves BOTH pieces, so the "closed id + 1 = open
// id" auto-pairing below cannot find them (their ids are unrelated) and the metal
// double-door families do not apply either. List each gate explicitly.
// Sources: the original elvarg gate catalog (doors.json "definitions.gates", hinge style)
// for 1558/1560, 1561/1562, 8810/8811, 12986/12987, 15514/15516; the remaining pairs come
// from the unresolved gate catalog (gates.unresolved.json closed sets, id-collision) with
// their adjacent-id open variants. Closed hinge is always the unrotated loc (or first
// model), closed extension the rotated/mirrored one.
function woodenGate(hinge, extension, openHinge, openExtension) {
  return Object.freeze({
    closed: Object.freeze({ hinge, extension }),
    opened: Object.freeze({ hinge: openHinge, extension: openExtension }),
  });
}

const WOODEN_GATES = Object.freeze([
  woodenGate(O.GATE_4, O.GATE_5, O.GATE_6, O.GATE_7),
  woodenGate(O.GATE_17, O.GATE_167, O.GATE_168, O.GATE_169),
  woodenGate(O.GATE_18, O.GATE_20, O.GATE_19, O.GATE_25),
  woodenGate(O.GATE_21, O.GATE_22, O.GATE_23, O.GATE_24),
  woodenGate(O.GATE_78, O.GATE_79, O.GATE_80, 4314), // 4314 nameless
  woodenGate(O.GATE_83, O.GATE_84, O.GATE_85, O.GATE_86),
  woodenGate(O.GATE_113, O.GATE_114, O.GATE_115, 12819), // 12819 nameless
  woodenGate(O.GATE_116, O.GATE_117, O.GATE_118, O.GATE_119),
  woodenGate(O.GATE_140, O.GATE_142, O.GATE_137, O.GATE_139),
  woodenGate(O.GATE_243, O.GATE_244, O.GATE_245, O.GATE_246),
  woodenGate(O.GATE_322, O.GATE_319, O.GATE_320, O.GATE_321),
]);

const WOODEN_GATE_BY_ID = new Map();
for (const gate of WOODEN_GATES) {
  for (const id of [gate.closed.hinge, gate.closed.extension, gate.opened.hinge, gate.opened.extension]) {
    WOODEN_GATE_BY_ID.set(id, gate);
  }
}

const DOUBLE_DOOR_ID_FAMILIES = Object.freeze([
  // Large doors (model 633): 1511 opens to 1512, 1513 to 1516 (1514 is an unnamed loc).
  Object.freeze([O.LARGE_DOOR_7, O.LARGE_DOOR_9, O.LARGE_DOOR_8, O.LARGE_DOOR_10]),
  Object.freeze([O.LARGE_DOOR_10, O.LARGE_DOOR_13]),
  Object.freeze([O.GATE_33, O.GATE_34, O.GATE_29, O.GATE_30]),
  Object.freeze([O.DOOR_354, O.DOOR_355, O.DOOR_356, O.DOOR_357]),
  Object.freeze([O.LARGE_DOOR_15, O.LARGE_DOOR_16, O.LARGE_DOOR_17, O.LARGE_DOOR_18]),
  Object.freeze([O.DOOR_36, O.DOOR_37, 1553, 1554]), // 1553, 1554 nameless
  Object.freeze([1557, O.GATE_18, O.GATE_19]), // 1557 nameless
  Object.freeze([O.GATE_26, O.GATE_27, O.GATE_29, O.GATE_30]),
  Object.freeze([O.DOORWAY_2, O.DOORWAY_3, O.DOORWAY_4]),
  Object.freeze([1596, O.WALL_5, O.WALL_6]), // 1596 nameless
  // Castle Wars large doors. West leaf is left: Saradomin 4423/4424 -> 4425/4426,
  // Zamorak 4428/4427 (ids run east to west on that wall) -> 4430/4429.
  Object.freeze([O.LARGE_DOOR_24, O.LARGE_DOOR_25, O.LARGE_DOOR_26, O.LARGE_DOOR_27]),
  Object.freeze([O.LARGE_DOOR_28, O.LARGE_DOOR_29, O.LARGE_DOOR_30, O.LARGE_DOOR_31]),
  Object.freeze([O.GATE_40, O.GATE_41, O.GATE_29, O.GATE_30]),
  // Tutorial Island mining exit: same metal gate as 1727/1728 (9717 is the left leaf).
  Object.freeze([O.GATE_92, O.GATE_93, O.GATE_29, O.GATE_30]),
  // Tutorial Island rat cage: same metal gate, face 0 (9719 is the left/south leaf).
  Object.freeze([O.GATE_94, O.GATE_95, O.GATE_29, O.GATE_30]),
  // Large doors sharing model 639 with 1521/1524; they open into that family's 1522/1525.
  Object.freeze([O.LARGE_DOOR_98, O.LARGE_DOOR_99, O.LARGE_DOOR_16, O.LARGE_DOOR_18]),
]);
const SPECIAL_DOUBLE_DOOR_LEFT_IDS = new Set([O.GATE_26, O.GATE_29, O.GATE_33, O.DOOR_354, O.DOOR_356, O.GATE_40, O.GATE_92, O.GATE_94, O.LARGE_DOOR_24, O.LARGE_DOOR_26, O.LARGE_DOOR_29, O.LARGE_DOOR_31, O.LARGE_DOOR_98, O.LARGE_DOOR_16, O.LARGE_DOOR_7, O.LARGE_DOOR_8]);
const SPECIAL_DOUBLE_DOOR_PARTNER_IDS_BY_ID = new Map([
  [O.GATE_26, [O.GATE_27]],
  [O.GATE_27, [O.GATE_26]],
  [O.GATE_29, [O.GATE_30]],
  [O.GATE_30, [O.GATE_29]],
  [O.GATE_33, [O.GATE_34]],
  [O.GATE_34, [O.GATE_33]],
  [O.DOOR_354, [O.DOOR_355, O.DOOR_357]],
  [O.DOOR_355, [O.DOOR_354, O.DOOR_356]],
  [O.DOOR_356, [O.DOOR_355, O.DOOR_357]],
  [O.DOOR_357, [O.DOOR_354, O.DOOR_356]],
  [O.GATE_40, [O.GATE_41]],
  [O.GATE_41, [O.GATE_40]],
  [O.GATE_92, [O.GATE_93]],
  [O.GATE_93, [O.GATE_92]],
  [O.GATE_94, [O.GATE_95]],
  [O.GATE_95, [O.GATE_94]],
  [O.LARGE_DOOR_24, [O.LARGE_DOOR_25]],
  [O.LARGE_DOOR_25, [O.LARGE_DOOR_24]],
  [O.LARGE_DOOR_26, [O.LARGE_DOOR_27]],
  [O.LARGE_DOOR_27, [O.LARGE_DOOR_26]],
  [O.LARGE_DOOR_29, [O.LARGE_DOOR_28]],
  [O.LARGE_DOOR_28, [O.LARGE_DOOR_29]],
  [O.LARGE_DOOR_31, [O.LARGE_DOOR_30]],
  [O.LARGE_DOOR_30, [O.LARGE_DOOR_31]],
  [O.LARGE_DOOR_98, [O.LARGE_DOOR_99]],
  [O.LARGE_DOOR_99, [O.LARGE_DOOR_98]],
  [O.LARGE_DOOR_16, [O.LARGE_DOOR_18]],
  [O.LARGE_DOOR_18, [O.LARGE_DOOR_16]],
  [O.LARGE_DOOR_7, [O.LARGE_DOOR_9]],
  [O.LARGE_DOOR_9, [O.LARGE_DOOR_7]],
  [O.LARGE_DOOR_8, [O.LARGE_DOOR_10]],
  [O.LARGE_DOOR_10, [O.LARGE_DOOR_8]],
]);
const SPECIAL_DOUBLE_DOOR_OPEN_IDS_BY_CLOSED_ID = new Map([
  [O.GATE_26, O.GATE_29],
  [O.GATE_27, O.GATE_30],
  [O.GATE_33, O.GATE_29],
  [O.GATE_34, O.GATE_30],
  [O.DOOR_354, O.DOOR_356],
  [O.DOOR_355, O.DOOR_357],
  [O.GATE_40, O.GATE_29],
  [O.GATE_41, O.GATE_30],
  [O.GATE_92, O.GATE_29],
  [O.GATE_93, O.GATE_30],
  [O.GATE_94, O.GATE_29],
  [O.GATE_95, O.GATE_30],
  [O.LARGE_DOOR_24, O.LARGE_DOOR_26],
  [O.LARGE_DOOR_25, O.LARGE_DOOR_27],
  [O.LARGE_DOOR_29, O.LARGE_DOOR_31],
  [O.LARGE_DOOR_28, O.LARGE_DOOR_30],
  [O.LARGE_DOOR_98, O.LARGE_DOOR_16],
  [O.LARGE_DOOR_99, O.LARGE_DOOR_18],
  [O.LARGE_DOOR_7, O.LARGE_DOOR_8],
  [O.LARGE_DOOR_9, O.LARGE_DOOR_10],
]);
const DOUBLE_DOOR_FAMILY_IDS_BY_ID = new Map(
  DOUBLE_DOOR_ID_FAMILIES.flatMap((familyIds) =>
    familyIds.map((id) => [id, familyIds])
  )
);

const COORD_OFFSETS = Object.freeze([
  [-1, 0],
  [0, 1],
  [1, 0],
  [0, -1],
]);

const GATE_PARTNER_OFFSETS = Object.freeze([
  [0, 1],
  [0, -1],
  [1, 0],
  [-1, 0],
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1],
]);

let ObjectManager;
let TaskManager;
let DOOR_CATALOG = null;
const OPEN_OBJECT_STATES = new Map();
const RUNTIME_DOUBLE_DOOR_RECORDS = [];
function hasAction(actions, keyword) {
  return Array.isArray(actions) && actions.some((action) => typeof action === "string" && action.toLowerCase() === keyword);
}
function buildDoorCatalog() {
  const closedToOpen = new Map();
  const openToClosed = new Map();
  const total = CacheDefinitions.getCounts().objects;
  for (let id = 0; id < total; id++) {
    const def = CacheDefinitions.getObject(id);
    if (!def || !DOOR_NAMES.has(def.name) || !hasAction(def.actions, "open")) {
      continue;
    }
    // Wooden gates are tracked by WOODEN_GATES, never by the generic pairing heuristics.
    if (WOODEN_GATE_BY_ID.has(id)) {
      continue;
    }
    if (SELF_OPENING_DOOR_IDS.has(id)) {
      closedToOpen.set(id, id);
      continue;
    }
    const partner = CacheDefinitions.getObject(id + 1);
    if (!partner || partner.name !== def.name) {
      continue;
    }
    if (hasAction(partner.actions, "close")) {
      // The open variant only closes back (the classic closed id N, open id N+1).
      if (!hasAction(partner.actions, "open")) {
        closedToOpen.set(id, id + 1);
        openToClosed.set(id + 1, id);
      }
      continue;
    }
    // Some cache exports list both variants with only "Open" (the open door shares
    // the same model and only differs by rotation). Pair consecutive same-model
    // doors so they still open; see e.g. Varrock Palace door 32464/32465.
    // Skip double-door leaves and already-paired ids so chains don't form.
    if (
      hasAction(partner.actions, "open") &&
      !SELF_OPENING_DOOR_IDS.has(id + 1) &&
      JSON.stringify(partner.models) === JSON.stringify(def.models) &&
      !DOUBLE_DOOR_ID_FAMILIES.some((family) => family.includes(id) || family.includes(id + 1)) &&
      !openToClosed.has(id) &&
      !closedToOpen.has(id + 1)
    ) {
      closedToOpen.set(id, id + 1);
      openToClosed.set(id + 1, id);
    }
  }
  for (const [closedId, openId] of SINGLE_DOOR_OPEN_IDS) {
    closedToOpen.set(closedId, openId);
    openToClosed.set(openId, closedId);
  }
  return { closedToOpen, openToClosed };
}

function getDoorCatalog() {
  if (!DOOR_CATALOG) {
    DOOR_CATALOG = buildDoorCatalog();
  }
  return DOOR_CATALOG;
}

function doorSound(id, open) {
  const gate = CacheDefinitions.getObject(id)?.name === "Gate";
  return gate ? (open ? Sound.GATE_OPEN : Sound.GATE_CLOSE) : (open ? Sound.DOOR_OPEN : Sound.DOOR_CLOSE);
}

function cloneLocation(x, y, z) {
  return new Location(x, y, z);
}

function locationKey(location) {
  if (!location) {
    return "0,0,0";
  }
  const x = location.getX?.() ?? location.x ?? 0;
  const y = location.getY?.() ?? location.y ?? 0;
  const z = location.getZ?.() ?? location.z ?? 0;
  return `${x},${y},${z}`;
}

function locationRegionId(location) {
  const x = location.getX?.() ?? location.x ?? 0;
  const y = location.getY?.() ?? location.y ?? 0;
  return ((x >> 6) << 8) | (y >> 6);
}

function toObjectSnapshot(object) {
  const location = object?.getLocation?.() ?? object?.location;
  return {
    id: Number(object?.getId?.() ?? object?.id ?? -1),
    type: Number(object?.getType?.() ?? object?.type ?? 0),
    face: Number(object?.getFace?.() ?? object?.face ?? 0) & 0x3,
    location: {
      x: location?.getX?.() ?? location?.x ?? 0,
      y: location?.getY?.() ?? location?.y ?? 0,
      z: location?.getZ?.() ?? location?.z ?? 0,
    },
  };
}

function objectFromSnapshot(snapshot, privateArea = null) {
  return new GameObject(
    snapshot.id,
    cloneLocation(snapshot.location.x, snapshot.location.y, snapshot.location.z),
    snapshot.type,
    snapshot.face,
    privateArea
  );
}

function resolveClosedId(objectId) {
  const catalog = getDoorCatalog();
  if (catalog.closedToOpen.has(objectId)) {
    return objectId;
  }
  const closedId = catalog.openToClosed.get(objectId);
  return closedId ?? null;
}

function findOpenDoorState(closedId, location) {
  const directKey = locationKey(location);
  const direct = OPEN_OBJECT_STATES.get(directKey);
  if (direct?.closed?.length === 1 && direct.closed[0]?.id === closedId) {
    return [directKey, direct];
  }

  for (const [anchorKey, state] of OPEN_OBJECT_STATES.entries()) {
    if (state.closed?.length !== 1 || state.closed[0]?.id !== closedId) {
      continue;
    }
    if (locationKey(state.current[0]?.location) === directKey) {
      return [anchorKey, state];
    }
  }

  return [directKey, null];
}

function rememberOpenObjects(anchorKey, closedObjects, currentObjects) {
  OPEN_OBJECT_STATES.set(anchorKey, {
    closed: closedObjects.map(toObjectSnapshot),
    current: currentObjects.map(toObjectSnapshot),
  });
  scheduleAutoClose(anchorKey);
}

function clearOpenDoor(anchorKey) {
  OPEN_OBJECT_STATES.delete(anchorKey);
  TaskManager?.cancelTasks?.(anchorKey);
}

// Reverts every object tracked under an anchor back to its closed snapshot. Shared by
// the auto-close task and (indirectly, via clearOpenDoor's cancellation) manual closes.
class AutoCloseDoorTask extends Task {
  constructor(delayTicks, anchorKey) {
    super(Math.max(1, delayTicks), anchorKey);
    this.anchorKey = anchorKey;
  }

  execute() {
    const state = OPEN_OBJECT_STATES.get(this.anchorKey);
    if (state) {
      for (const snapshot of state.current ?? []) {
        ObjectManager.deregister(objectFromSnapshot(snapshot), true);
      }
      for (const snapshot of state.closed ?? []) {
        ObjectManager.register(objectFromSnapshot(snapshot), true);
      }
      for (let i = RUNTIME_DOUBLE_DOOR_RECORDS.length - 1; i >= 0; i--) {
        const record = RUNTIME_DOUBLE_DOOR_RECORDS[i];
        if (state.closed.some((snapshot) => snapshot.id === record.originalId &&
          snapshot.location.x === record.originalX && snapshot.location.y === record.originalY &&
          snapshot.location.z === record.z)) {
          RUNTIME_DOUBLE_DOOR_RECORDS.splice(i, 1);
        }
      }
      OPEN_OBJECT_STATES.delete(this.anchorKey);
      const closedSample = state.closed?.[0];
      if (closedSample) {
        Sounds.sendSound(objectFromSnapshot(closedSample), doorSound(closedSample.id, false));
      }
    }
    this.stop();
  }
}

function scheduleAutoClose(anchorKey) {
  if (!TaskManager) {
    return;
  }
  TaskManager.cancelTasks(anchorKey);
  TaskManager.submit(new AutoCloseDoorTask(DOOR_AUTO_CLOSE_TICKS, anchorKey));
}

function stateMatchesPlayer(player, state) {
  if (!player || !state) {
    return false;
  }
  if (player.getPrivateArea?.() != null) {
    return false;
  }
  const playerLocation = player.getLocation?.();
  if (!playerLocation) {
    return false;
  }
  const snapshots = [...(state.closed ?? []), ...(state.current ?? [])];
  return snapshots.some((snapshot) => {
    const snapshotLocation = cloneLocation(
      snapshot.location.x,
      snapshot.location.y,
      snapshot.location.z
    );
    return playerLocation.isWithinDistance?.(snapshotLocation, 64) === true;
  });
}

function syncOpenDoorsToPlayer(player) {
  if (!player || player.getPrivateArea?.() != null) {
    return;
  }
  for (const state of OPEN_OBJECT_STATES.values()) {
    if (!stateMatchesPlayer(player, state)) {
      continue;
    }
    for (const snapshot of state.closed ?? []) {
      player.getPacketSender?.().sendObjectRemoval?.(objectFromSnapshot(snapshot));
    }
    for (const snapshot of state.current ?? []) {
      player.getPacketSender?.().sendObject?.(objectFromSnapshot(snapshot));
    }
  }
}

function requestDoorResync(player, ticks = 3) {
  if (!player || player.getPrivateArea?.() != null) {
    return;
  }
  const current = Number(player.getAttribute?.(DOOR_RESYNC_TICKS_ATTR) ?? 0);
  if (ticks > current) {
    player.setAttribute?.(DOOR_RESYNC_TICKS_ATTR, ticks);
  }
}

function reapplyOpenDoorsForRegion(regionId) {
  for (const state of OPEN_OBJECT_STATES.values()) {
    const inRegion = [...(state.closed ?? []), ...(state.current ?? [])].some(
      (snapshot) => locationRegionId(snapshot.location) === regionId
    );
    if (!inRegion) {
      continue;
    }
    for (const snapshot of state.closed ?? []) {
      MapObjects.remove(objectFromSnapshot(snapshot));
    }
    for (const snapshot of state.current ?? []) {
      MapObjects.add(objectFromSnapshot(snapshot));
    }
  }
}
// OSRS swings a wooden gate 90 degrees around its hinge post, so both panels land on the
// perpendicular tile line and face the same direction. Ported 1:1 from the original elvarg
// gate state manager (computeGateHingeOpenTransform / computeGateHingeCloseTransform).
function gateHingeTransform(x, y, rotation, opening) {
  switch (rotation & 0x3) {
    case 0:
      return opening
        ? { hinge: [x - 1, y], extension: [x - 2, y], face: 3 }
        : { hinge: [x, y - 1], extension: [x + 1, y - 1], face: 1 };
    case 1:
      return opening
        ? { hinge: [x, y + 1], extension: [x, y + 2], face: 0 }
        : { hinge: [x - 1, y], extension: [x - 1, y - 1], face: 2 };
    case 2:
      return opening
        ? { hinge: [x + 1, y], extension: [x + 2, y], face: 1 }
        : { hinge: [x, y + 1], extension: [x - 1, y + 1], face: 3 };
    case 3:
      return opening
        ? { hinge: [x, y - 1], extension: [x, y - 2], face: 2 }
        : { hinge: [x + 1, y], extension: [x + 1, y + 1], face: 0 };
    default:
      return null;
  }
}

function findAdjacentGatePartner(objectId, x, y, z, privateArea) {
  for (const [dx, dy] of GATE_PARTNER_OFFSETS) {
    const partner = MapObjects.get(objectId, cloneLocation(x + dx, y + dy, z), privateArea ?? null);
    if (partner) {
      return partner;
    }
  }
  return null;
}

// Opens/closes a wooden gate by swinging its hinge and extension panels together. Tracks
// both pieces as one open-object state so auto-close and resync revert the whole gate.
function handleWoodenGate(player, object, objectId, location) {
  const gate = WOODEN_GATE_BY_ID.get(objectId);
  if (!gate || !object || !location) {
    return false;
  }

  const privateArea = player?.getPrivateArea?.() ?? null;
  const isClosed = objectId === gate.closed.hinge || objectId === gate.closed.extension;
  const isHinge = objectId === gate.closed.hinge || objectId === gate.opened.hinge;

  const oldHingeId = isClosed ? gate.closed.hinge : gate.opened.hinge;
  const oldExtensionId = isClosed ? gate.closed.extension : gate.opened.extension;
  const newHingeId = isClosed ? gate.opened.hinge : gate.closed.hinge;
  const newExtensionId = isClosed ? gate.opened.extension : gate.closed.extension;
  const partnerId = isHinge ? oldExtensionId : oldHingeId;

  const x = Number(location.getX?.() ?? location.x ?? 0);
  const y = Number(location.getY?.() ?? location.y ?? 0);
  const z = Number(location.getZ?.() ?? location.z ?? 0);
  const rotation = Number(object.getFace?.() ?? object.face ?? 0) & 0x3;

  const partner = findAdjacentGatePartner(partnerId, x, y, z, privateArea);
  if (!partner) {
    return false;
  }

  const clickedPart = {
    object,
    x,
    y,
    rotation,
    type: Number(object.getType?.() ?? object.type ?? 0),
  };
  const partnerPart = {
    object: partner,
    x: Number(partner.getLocation?.().getX?.() ?? 0),
    y: Number(partner.getLocation?.().getY?.() ?? 0),
    rotation: Number(partner.getFace?.() ?? 0) & 0x3,
    type: Number(partner.getType?.() ?? 0),
  };
  const hingeOld = isHinge ? clickedPart : partnerPart;
  const extensionOld = isHinge ? partnerPart : clickedPart;

  const transform = gateHingeTransform(hingeOld.x, hingeOld.y, hingeOld.rotation, isClosed);
  if (!transform) {
    return false;
  }

  const hingeNew = new GameObject(
    newHingeId,
    cloneLocation(transform.hinge[0], transform.hinge[1], z),
    hingeOld.type,
    transform.face,
    privateArea
  );
  const extensionNew = new GameObject(
    newExtensionId,
    cloneLocation(transform.extension[0], transform.extension[1], z),
    extensionOld.type,
    transform.face,
    privateArea
  );

  ObjectManager.deregister(hingeOld.object, true);
  ObjectManager.deregister(extensionOld.object, true);
  ObjectManager.register(hingeNew, true);
  ObjectManager.register(extensionNew, true);
  requestDoorResync(player);

  // Anchor on the CLOSED hinge tile so open and close compute the same key for auto-close.
  const closedHingeX = isClosed ? hingeOld.x : transform.hinge[0];
  const closedHingeY = isClosed ? hingeOld.y : transform.hinge[1];
  const anchorKey = `woodenGate:${gate.closed.hinge}:${closedHingeX},${closedHingeY},${z}`;
  if (isClosed) {
    const closedHinge = new GameObject(
      gate.closed.hinge,
      cloneLocation(hingeOld.x, hingeOld.y, z),
      hingeOld.type,
      hingeOld.rotation,
      privateArea
    );
    const closedExtension = new GameObject(
      gate.closed.extension,
      cloneLocation(extensionOld.x, extensionOld.y, z),
      extensionOld.type,
      extensionOld.rotation,
      privateArea
    );
    rememberOpenObjects(anchorKey, [closedHinge, closedExtension], [hingeNew, extensionNew]);
  } else {
    clearOpenDoor(anchorKey);
  }

  Sounds.sendSound(player, doorSound(gate.closed.hinge, isClosed));

  return true;
}

function handleMappedDoor(player, object, objectId, location) {
  if (!object || !location) {
    return false;
  }

  const closedId = resolveClosedId(objectId);
  if (closedId == null) {
    return false;
  }

  const [anchorKey, existingState] = findOpenDoorState(closedId, location);
  const activeObject = existingState?.current?.[0]
    ? objectFromSnapshot(existingState.current[0], player?.getPrivateArea?.() ?? null)
    : object;
  const activeLocation = activeObject.getLocation?.() ?? location;
  const openId = getDoorCatalog().closedToOpen.get(closedId);
  // A self-opening door keeps its id, so only the tracked state says it is open.
  const open = openId === closedId
    ? existingState != null
    : (activeObject.getId?.() ?? objectId) !== closedId;
  const nextId = open ? closedId : openId;
  const type = Number(activeObject.getType?.() ?? activeObject.type ?? 0);
  const rotation = Number(activeObject.getFace?.() ?? activeObject.face ?? 0) & 0x3;
  const nextRotation = open ? ((rotation + 1) & 0x3) : rotation;
  const offsetIndex = type === 9 ? ((nextRotation + 1) & 0x3) : nextRotation;
  const [dx, dy] = COORD_OFFSETS[offsetIndex] ?? [0, 0];
  const privateArea = player?.getPrivateArea?.() ?? null;

  const previousObject = activeObject;
  const nextObject = new GameObject(
    nextId,
    cloneLocation(
      (activeLocation.getX?.() ?? activeLocation.x ?? 0) + dx,
      (activeLocation.getY?.() ?? activeLocation.y ?? 0) + dy,
      activeLocation.getZ?.() ?? activeLocation.z ?? 0
    ),
    type,
    open ? ((rotation - 1) & 0x3) : ((rotation + 1) & 0x3),
    privateArea
  );

  ObjectManager.register(nextObject, true);
  ObjectManager.deregister(previousObject, true);
  requestDoorResync(player);

  console.warn(
    `[door-debug] user=${player.isPlayerBot?.() ? "BOT:" + player.getUsername?.() : player.getUsername?.()} ${open ? "CLOSE" : "OPEN"} click id=${objectId} closedId=${closedId} ` +
    `prev(id=${previousObject.getId()},loc=${previousObject.getLocation().getX()},${previousObject.getLocation().getY()},${previousObject.getLocation().getZ()},face=${previousObject.getFace()}) ` +
    `next(id=${nextObject.getId()},loc=${nextObject.getLocation().getX()},${nextObject.getLocation().getY()},${nextObject.getLocation().getZ()},face=${nextObject.getFace()}) ` +
    `postCheck=${MapObjects.get(nextObject.getId(), nextObject.getLocation(), privateArea) ? "FOUND" : "MISSING"}`
  );

  if (open) {
    clearOpenDoor(anchorKey);
  } else {
    const closedObject = new GameObject(
      closedId,
      cloneLocation(
        location.getX?.() ?? location.x ?? 0,
        location.getY?.() ?? location.y ?? 0,
        location.getZ?.() ?? location.z ?? 0
      ),
      type,
      rotation,
      privateArea
    );
    rememberOpenObjects(anchorKey, [closedObject], [nextObject]);
  }

  Sounds.sendSound(player, doorSound(closedId, !open));

  return true;
}

function findDoubleDoorRecord(id, x, y, z) {
  return RUNTIME_DOUBLE_DOOR_RECORDS.find(
    (record) => record.currentId === id && record.x === x && record.y === y && record.z === z
  ) ?? null;
}

function createDynamicDoubleDoorRecord(object, location, originalId) {
  return {
    originalId,
    currentId: Number(object.getId?.() ?? object.id ?? originalId),
    open: 0,
    x: Number(location.getX?.() ?? location.x ?? 0),
    y: Number(location.getY?.() ?? location.y ?? 0),
    z: Number(location.getZ?.() ?? location.z ?? 0),
    originalX: Number(location.getX?.() ?? location.x ?? 0),
    originalY: Number(location.getY?.() ?? location.y ?? 0),
    currentFace: Number(object.getFace?.() ?? object.face ?? 0) & 0x3,
    originalFace: Number(object.getFace?.() ?? object.face ?? 0) & 0x3,
    type: Number(object.getType?.() ?? object.type ?? 0),
  };
}

function ensureDynamicDoubleDoorRecords(object, objectId, location, privateArea = null) {
  if (!object || !location) {
    return null;
  }

  const familyIds = DOUBLE_DOOR_FAMILY_IDS_BY_ID.get(objectId);
  if (!familyIds) {
    return null;
  }

  for (const [dx, dy] of COORD_OFFSETS) {
    const candidateLocation = cloneLocation(
      (location.getX?.() ?? location.x ?? 0) + dx,
      (location.getY?.() ?? location.y ?? 0) + dy,
      location.getZ?.() ?? location.z ?? 0
    );
    for (const partnerId of familyIds) {
      const partnerObject = MapObjects.get(partnerId, candidateLocation, privateArea);
      if (!partnerObject) {
        continue;
      }

      const clickedRecord = createDynamicDoubleDoorRecord(
        object,
        location,
        Number(object.getId?.() ?? object.id ?? objectId)
      );
      const partnerRecord = createDynamicDoubleDoorRecord(
        partnerObject,
        candidateLocation,
        Number(partnerObject.getId?.() ?? partnerObject.id ?? partnerId)
      );
      RUNTIME_DOUBLE_DOOR_RECORDS.push(clickedRecord, partnerRecord);
      return [clickedRecord, partnerRecord];
    }
  }

  return null;
}

function buildDoubleDoorAnchorKey(records) {
  return records
    .map((record) => `${record.originalId}:${record.originalX},${record.originalY},${record.z}`)
    .sort()
    .join("|");
}

function cloneDoubleDoorRecord(record) {
  return { ...record };
}

function isDoubleDoorOpen(record) {
  return (
    record.currentId !== record.originalId ||
    record.x !== record.originalX ||
    record.y !== record.originalY ||
    record.currentFace !== record.originalFace
  );
}

function doubleDoorRecordToObject(record, privateArea = null) {
  return new GameObject(
    record.currentId,
    cloneLocation(record.x, record.y, record.z),
    Number(record.type ?? 0),
    record.currentFace,
    privateArea
  );
}

function resolveOpenedDoubleDoorId(record) {
  return SPECIAL_DOUBLE_DOOR_OPEN_IDS_BY_CLOSED_ID.get(record.originalId) ?? (record.originalId + 1);
}

function getNextLeftFace(record) {
  let face = record.originalFace;

  if (record.open === 0) {
    if (record.originalFace === 0 && record.currentFace === 0) {
      face = 3;
    } else if (record.originalFace === 1 && record.currentFace === 1) {
      face = 0;
    } else if (record.originalFace === 2 && record.currentFace === 2) {
      face = 1;
    } else if (record.originalFace === 3 && record.currentFace === 3) {
      face = 0;
    } else if (record.originalFace !== record.currentFace) {
      face = record.originalFace;
    }
  } else if (record.open === 1) {
    if (record.originalFace === 0 && record.currentFace === 0) {
      face = 1;
    } else if (record.originalFace === 1 && record.currentFace === 1) {
      face = 2;
    } else if (record.originalFace === 2 && record.currentFace === 2) {
      face = 1;
    } else if (record.originalFace === 3 && record.currentFace === 3) {
      face = 2;
    } else if (record.originalFace !== record.currentFace) {
      face = record.originalFace;
    }
  }

  record.currentFace = face;
  return face;
}

function getNextRightFace(record) {
  let face = record.originalFace;

  if (record.open === 0) {
    if (record.originalFace === 0 && record.currentFace === 0) {
      face = 1;
    } else if (record.originalFace === 1 && record.currentFace === 1) {
      face = 2;
    } else if (record.originalFace === 2 && record.currentFace === 2) {
      face = 3;
    } else if (record.originalFace === 3 && record.currentFace === 3) {
      face = 2;
    } else if (record.originalFace !== record.currentFace) {
      face = record.originalFace;
    }
  } else if (record.open === 1) {
    if (record.originalFace === 0 && record.currentFace === 0) {
      face = 3;
    } else if (record.originalFace === 1 && record.currentFace === 1) {
      face = 0;
    } else if (record.originalFace === 2 && record.currentFace === 2) {
      face = 1;
    } else if (record.originalFace === 3 && record.currentFace === 3) {
      face = 2;
    } else if (record.originalFace !== record.currentFace) {
      face = record.originalFace;
    }
  }

  record.currentFace = face;
  return face;
}

function changeLeftDoubleDoor(record) {
  let xAdjustment = 0;
  let yAdjustment = 0;

  if (record.open === 0) {
    if (record.originalFace === 0 && record.currentFace === 0) {
      xAdjustment = -1;
    } else if (record.originalFace === 1 && record.currentFace === 1) {
      yAdjustment = 1;
    } else if (record.originalFace === 2 && record.currentFace === 2) {
      xAdjustment = 1;
    } else if (record.originalFace === 3 && record.currentFace === 3) {
      yAdjustment = -1;
    }
  } else if (record.open === 1) {
    if (record.originalFace === 0 && record.currentFace === 0) {
      yAdjustment = -1;
    } else if (record.originalFace === 1 && record.currentFace === 1) {
      xAdjustment = -1;
    } else if (record.originalFace === 2 && record.currentFace === 2) {
      xAdjustment = -1;
    } else if (record.originalFace === 3 && record.currentFace === 3) {
      xAdjustment = -1;
    }
  }

  if (record.x === record.originalX && record.y === record.originalY) {
    record.x += xAdjustment;
    record.y += yAdjustment;
  } else {
    record.x = record.originalX;
    record.y = record.originalY;
  }

  if (record.currentId === record.originalId) {
    record.currentId = resolveOpenedDoubleDoorId(record);
  } else {
    record.currentId = record.originalId;
  }

  getNextLeftFace(record);
}

function changeRightDoubleDoor(record) {
  let xAdjustment = 0;
  let yAdjustment = 0;

  if (record.open === 0) {
    if (record.originalFace === 0 && record.currentFace === 0) {
      xAdjustment = -1;
    } else if (record.originalFace === 1 && record.currentFace === 1) {
      yAdjustment = 1;
    } else if (record.originalFace === 2 && record.currentFace === 2) {
      xAdjustment = 1;
    } else if (record.originalFace === 3 && record.currentFace === 3) {
      yAdjustment = -1;
    }
  } else if (record.open === 1) {
    if (record.originalFace === 0 && record.currentFace === 0) {
      xAdjustment = 1;
    } else if (record.originalFace === 1 && record.currentFace === 1) {
      xAdjustment = -1;
    } else if (record.originalFace === 2 && record.currentFace === 2) {
      yAdjustment = -1;
    } else if (record.originalFace === 3 && record.currentFace === 3) {
      xAdjustment = -1;
    }
  }

  if (record.x === record.originalX && record.y === record.originalY) {
    record.x += xAdjustment;
    record.y += yAdjustment;
  } else {
    record.x = record.originalX;
    record.y = record.originalY;
  }

  if (record.currentId === record.originalId) {
    record.currentId = resolveOpenedDoubleDoorId(record);
  } else {
    record.currentId = record.originalId;
  }

  getNextRightFace(record);
}

function resolveDoubleDoorPair(clicked) {
  const specialPartnerIds = SPECIAL_DOUBLE_DOOR_PARTNER_IDS_BY_ID.get(clicked.currentId);
  if (specialPartnerIds) {
    for (const [dx, dy] of COORD_OFFSETS) {
      const candidateX = clicked.x + dx;
      const candidateY = clicked.y + dy;
      for (const partnerId of specialPartnerIds) {
        const partner = findDoubleDoorRecord(partnerId, candidateX, candidateY, clicked.z);
        if (!partner) {
          continue;
        }
        return SPECIAL_DOUBLE_DOOR_LEFT_IDS.has(clicked.currentId)
          ? [clicked, partner]
          : [partner, clicked];
      }
    }
  }

  let leftDoor = null;
  let rightDoor = null;
  const { currentId: id, x, y, z, originalFace, open } = clicked;

  if (open === 0) {
    if (originalFace === 0) {
      const lowerDoor = findDoubleDoorRecord(id - 3, x, y - 1, z);
      const upperDoor = findDoubleDoorRecord(id + 3, x, y + 1, z);
      if (lowerDoor) {
        leftDoor = lowerDoor;
        rightDoor = clicked;
      } else if (upperDoor) {
        leftDoor = clicked;
        rightDoor = upperDoor;
      }
    } else if (originalFace === 1) {
      const westDoor = findDoubleDoorRecord(id - 3, x - 1, y, z);
      const eastDoor = findDoubleDoorRecord(id + 3, x + 1, y, z);
      if (westDoor) {
        leftDoor = westDoor;
        rightDoor = clicked;
      } else if (eastDoor) {
        leftDoor = clicked;
        rightDoor = eastDoor;
      }
    } else if (originalFace === 2) {
      const lowerDoor = findDoubleDoorRecord(id - 3, x, y + 1, z);
      const upperDoor = findDoubleDoorRecord(id + 3, x, y - 1, z);
      if (lowerDoor) {
        leftDoor = lowerDoor;
        rightDoor = clicked;
      } else if (upperDoor) {
        leftDoor = clicked;
        rightDoor = upperDoor;
      }
    } else if (originalFace === 3) {
      const westDoor = findDoubleDoorRecord(id + 3, x - 1, y, z);
      const eastDoor = findDoubleDoorRecord(id - 3, x + 1, y, z);
      if (westDoor) {
        leftDoor = westDoor;
        rightDoor = clicked;
      } else if (eastDoor) {
        leftDoor = clicked;
        rightDoor = eastDoor;
      }
    }
  } else if (open === 1) {
    if (originalFace === 0) {
      const westDoor = findDoubleDoorRecord(id - 3, x - 1, y, z);
      const eastDoor = findDoubleDoorRecord(id + 3, x + 1, y, z);
      if (westDoor) {
        leftDoor = westDoor;
        rightDoor = clicked;
      } else if (eastDoor) {
        leftDoor = clicked;
        rightDoor = eastDoor;
      }
    } else if (originalFace === 1) {
      const northDoor = findDoubleDoorRecord(id - 3, x, y + 1, z);
      const southDoor = findDoubleDoorRecord(id + 3, x, y - 1, z);
      if (northDoor) {
        leftDoor = northDoor;
        rightDoor = clicked;
      } else if (southDoor) {
        leftDoor = clicked;
        rightDoor = southDoor;
      }
    } else if (originalFace === 2) {
      const westDoor = findDoubleDoorRecord(id - 3, x - 1, y, z);
      const eastDoor = findDoubleDoorRecord(id + 3, x, y - 1, z);
      if (westDoor) {
        leftDoor = westDoor;
        rightDoor = clicked;
      } else if (eastDoor) {
        leftDoor = clicked;
        rightDoor = eastDoor;
      }
    } else if (originalFace === 3) {
      const northDoor = findDoubleDoorRecord(id - 3, x, y + 1, z);
      const southDoor = findDoubleDoorRecord(id + 3, x, y - 1, z);
      if (northDoor) {
        leftDoor = northDoor;
        rightDoor = clicked;
      } else if (southDoor) {
        leftDoor = clicked;
        rightDoor = southDoor;
      }
    }
  }

  return leftDoor && rightDoor ? [leftDoor, rightDoor] : null;
}

function handleDoubleDoor(player, object, objectId, location) {
  const x = location?.getX?.() ?? location?.x;
  const y = location?.getY?.() ?? location?.y;
  const z = location?.getZ?.() ?? location?.z ?? 0;
  let clickedDoor = findDoubleDoorRecord(objectId, x, y, z);
  if (!clickedDoor) {
    ensureDynamicDoubleDoorRecords(object, objectId, location, player?.getPrivateArea?.() ?? null);
    clickedDoor = findDoubleDoorRecord(objectId, x, y, z);
  }
  if (!clickedDoor) {
    return false;
  }

  const pair = resolveDoubleDoorPair(clickedDoor);
  if (!pair) {
    return false;
  }

  const previousStates = pair.map(cloneDoubleDoorRecord);
  const previousObjects = previousStates.map((record) => doubleDoorRecordToObject(record));

  changeLeftDoubleDoor(pair[0]);
  changeRightDoubleDoor(pair[1]);

  const currentObjects = pair.map((record) => doubleDoorRecordToObject(record));
  for (const previousObject of previousObjects) {
    ObjectManager.deregister(previousObject, true);
  }
  for (const currentObject of currentObjects) {
    ObjectManager.register(currentObject, true);
  }

  requestDoorResync(player);

  const anchorKey = buildDoubleDoorAnchorKey(pair);
  if (pair.some(isDoubleDoorOpen)) {
    rememberOpenObjects(anchorKey, previousObjects, currentObjects);
  } else {
    clearOpenDoor(anchorKey);
  }

  Sounds.sendSound(
    player,
    doorSound(pair[0].originalId, pair.some(isDoubleDoorOpen))
  );

  return true;
}

function toggleDoor(api, { player, object, objectId, location }) {
  if (!player || !object || !location) return false;
  const request = { player, object, objectId, location, handled: false };
  api.emitCustomEvent("door:toggle", request);
  if (request.handled) return true;
  if (handleWoodenGate(player, object, objectId, location)) return true;
  if (handleDoubleDoor(player, object, objectId, location)) return true;
  return handleMappedDoor(player, object, objectId, location);
}

module.exports = {
  name: "Doors",
  register: (api) => {
    ObjectManager = api.getObjectManager();
    TaskManager = api.getTaskManager();
    // Warm the door catalog at startup. It scans every loc definition (~185ms for ~60k
    // objects); building it lazily on the first door click stalled a live game tick.
    getDoorCatalog();
    const toggle = toggleDoor.bind(null, api);
    for (const name of DOOR_NAMES) {
      // Some gates (e.g. 60760/60763) expose "Release" instead of "Open".
      api.onObjectInteraction(name, { Open: toggle, Close: toggle, Release: toggle });
    }
    api.onRegionLoaded(({ regionId }) => {
      if (!Number.isInteger(regionId)) {
        return;
      }
      reapplyOpenDoorsForRegion(regionId);
    });
    api.onPlayerProcess(({ player }) => {
      if (!player || player.isPlayerBot?.() === true) {
        return;
      }
      if (player.isNeedsPlacement?.() === true || player.isAllowRegionChangePacket?.() === true) {
        requestDoorResync(player, 4);
      }
      const remaining = Number(player.getAttribute?.(DOOR_RESYNC_TICKS_ATTR) ?? 0);
      if (remaining <= 0) {
        return;
      }
      if (player.isAllowRegionChangePacket?.() === true) {
        return;
      }
      syncOpenDoorsToPlayer(player);
      player.setAttribute?.(DOOR_RESYNC_TICKS_ATTR, remaining - 1);
    });
  },
};
