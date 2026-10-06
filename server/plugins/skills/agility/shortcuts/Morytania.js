const { ObjectIds } = require("../../../../src/main/typescript/elvarg/util/IdEnums");
const { Anim } = require("../constants");
const { ShortcutAnim, between, climbOver, hops, crawlDown, crawlUp } = require("./builders");

/** Slayer Tower spikey chains, keyed by the chain's tile; each climbs to the given plane. */
const SPIKEY_CHAINS = [
  { at: [3422, 3550, 1], plane: 0, level: 61 },
  { at: [3422, 3550, 0], plane: 1, level: 61 },
  { at: [3447, 3576, 2], plane: 1, level: 71 },
  { at: [3447, 3576, 1], plane: 2, level: 71 },
];

/** Slayer Tower ivy and windows (OSRS capture, docs/slayer-tower.md): climbing and landing sounds. */
const SLAYER_TOWER_SOUND = { CLIMB: 2454, JUMP: 2461, LAND: 2462 };
const IVY_FOOT = [3418, 3533, 0];

module.exports = [
  between({
    object: ObjectIds.BROKEN_FENCE_3,
    level: 1,
    ends: ({ obj }) => [[obj.x, obj.y - 1, obj.z], [obj.x, obj.y + 2, obj.z]],
    end: "You climb over the broken fence.",
    cross: (from, to) => [climbOver(to)],
  }),
  between({
    object: ObjectIds.LOW_FENCE,
    level: 33,
    ends: [[3471, 3221, 0], [3477, 3221, 0]],
    cross: (from, to) => {
      const east = to[0] > from[0];
      return [
        { face: [east ? 3473 : 3474, 3221] },
        { move: [east ? 3473 : 3474, 3221], anim: Anim.RUN_UP, speed: [0, 60] },
        { anim: Anim.JUMP_HURDLE },
        { wait: 1 },
        { move: [east ? 3474 : 3473, 3221], speed: [0, 15] },
      ];
    },
  }),
  between({
    object: ObjectIds.STEPPING_STONE_7,
    level: 50,
    ends: [[3417, 3325, 0], [3422, 3325, 0]],
    cross: (from, to, { obj }) => hops([obj.x, obj.y], to),
  }),
  between({
    object: ObjectIds.ORNATE_RAILING,
    level: 65,
    ends: [[3423, 3476, 0], [3424, 3476, 0]],
    cross: (from, to) => [{ move: to, anim: ShortcutAnim.SQUEEZE_WINDOW, speed: [0, 50] }],
  }),
  between({
    object: ObjectIds.ORNATE_RAILING_2,
    level: 65,
    ends: [[3425, 3483, 0], [3425, 3484, 0]],
    cross: (from, to) => [{ move: to, anim: ShortcutAnim.SQUEEZE_WINDOW, speed: [0, 50] }],
  }),
  {
    // Mort Myre: the rocks between the swamp and the bridge railing.
    object: ObjectIds.ROCKS_84,
    level: 65,
    xp: 0,
    steps: ({ obj }) => crawlUp([obj.x, obj.y], [3425, 3476], [3424, 3476]),
  },
  {
    object: ObjectIds.ROCKS_83,
    level: 65,
    xp: 0,
    steps: crawlDown([3423, 3476], [3427, 3477], "west"),
  },
  {
    // Ectofuntus: the weathered wall between the slime pit levels.
    object: ObjectIds.WEATHERED_WALL,
    level: 57,
    xp: 2,
    steps: [{ anim: Anim.CLIMB_WALL }, { wait: 1 }, { anim: -1 }, { tele: [3670, 9888, 3] }],
  },
  {
    object: ObjectIds.WEATHERED_WALL_2,
    level: 57,
    xp: 2,
    steps: [
      { face: [3671, 9888] },
      { anim: Anim.LEAP, delay: 15 },
      { wait: 1 },
      { tele: [3671, 9888, 2] },
      { anim: Anim.LAND },
    ],
  },
  between({
    object: ObjectIds.STEPPING_STONE_17,
    level: 60,
    ends: [[3708, 2969, 0], [3715, 2969, 0]],
    cross: (from, to, { obj }) => hops([obj.x, obj.y], to),
  }),
  {
    // Mausoleum bridge on the way to Mort'ton: step forward and leap the gap.
    object: [ObjectIds.BRIDGE_13, ObjectIds.BRIDGE_14],
    level: 1,
    xp: 0,
    route: ({ obj }) => (obj.id === ObjectIds.BRIDGE_13 ? [obj.x, 3558, 0] : [obj.x, obj.y, obj.z]),
    steps: ({ pos }) => [
      { walk: [[pos.x, pos.y + 1]] },
      { anim: Anim.LEAP },
      { wait: 1 },
      { tele: [pos.x, pos.y + 4, pos.z] },
      { wait: 2 },
      { anim: -1 },
    ],
  },
  // Slayer Tower banshee window: one 2-tile slide through it, either way (captured; Wiki: 18, 3 XP).
  between({
    object: ObjectIds.BROKEN_WINDOW_3,
    level: 18,
    xp: 3,
    ends: [[3442, 3531, 0], [3444, 3533, 0]],
    cross: (from, to) => [{ move: to, anim: Anim.CLIMB_LOW_WALL, speed: [0, 94], ticks: 3 }],
  }),
  {
    // Slayer Tower ivy: up two floors, along the ledge and in through the window (captured;
    // Wiki: 81). The capture shows no XP, though the Wiki lists 3.
    object: ObjectIds.IVY,
    at: IVY_FOOT,
    level: 81,
    xp: 0,
    route: IVY_FOOT,
    steps: [
      { faceDir: "north" },
      { anim: Anim.CLIMB_UP },
      { sound: SLAYER_TOWER_SOUND.CLIMB },
      { wait: 1 },
      { tele: [3418, 3533, 1] },
      { anim: ShortcutAnim.CLIMB_LOOP },
      { sound: SLAYER_TOWER_SOUND.CLIMB },
      { wait: 1 },
      { tele: [3418, 3533, 2] },
      { sound: SLAYER_TOWER_SOUND.CLIMB },
      { wait: 1 },
      { move: [3419, 3533, 2], anim: ShortcutAnim.LEDGE_SIDESTEP_LEFT, speed: [0, 30] },
      { sound: SLAYER_TOWER_SOUND.LAND },
      { move: [3420, 3534, 2], anim: Anim.LAND, speed: [0, 12] },
    ],
  },
  {
    // ...and back: out of the window onto the ledge, along it and down the ivy (captured).
    object: ObjectIds.BROKEN_WINDOW_2,
    at: [3419, 3533, 2],
    level: 81,
    xp: 0,
    route: [3420, 3534, 2],
    steps: [
      { sound: SLAYER_TOWER_SOUND.JUMP },
      { move: [3419, 3533, 2], anim: Anim.JUMP, speed: [15, 30] },
      { move: [3418, 3533, 2], anim: ShortcutAnim.LEDGE_SIDESTEP_RIGHT, speed: [0, 30] },
      { faceDir: "north" },
      { anim: Anim.CLIMB_ROCKS },
      { sound: SLAYER_TOWER_SOUND.CLIMB },
      { wait: 1 },
      { tele: [3418, 3533, 1] },
      { sound: SLAYER_TOWER_SOUND.CLIMB },
      { wait: 1 },
      { tele: IVY_FOOT },
      { sound: SLAYER_TOWER_SOUND.CLIMB },
      { wait: 1 },
      { faceDir: "south" },
      { anim: -1 },
    ],
  },
  ...SPIKEY_CHAINS.map(({ at, plane, level }) => ({
    object: [ObjectIds.SPIKEY_CHAIN, ObjectIds.SPIKEY_CHAIN_2],
    at,
    level,
    xp: 3,
    steps: ({ pos }) => [{ anim: Anim.CLIMB_UP }, { wait: 1 }, { tele: [pos.x, pos.y, plane] }],
  })),
  between({
    object: [ObjectIds.ROPE_ANCHOR, ObjectIds.ROPE_ANCHOR_2],
    level: 64,
    ends: [[3778, 3821, 0], [3784, 3821, 0]],
    render: Anim.BALANCE_WALK,
    cross: (from, to) => [{ walk: [to] }],
  }),
  {
    // Fossil Island: climb over the decaying trunk.
    object: ObjectIds.DECAYING_TRUNK,
    level: 1,
    xp: 0,
    end: "You climb over the trunk.",
    steps: ({ pos, obj }) => [climbOver([obj.x, obj.y + (pos.y > obj.y ? -1 : 1)])],
  },
];
