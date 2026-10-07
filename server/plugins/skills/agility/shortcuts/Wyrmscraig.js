const { ObjectIds } = require("../../../../src/main/typescript/elvarg/util/IdEnums");
const { Anim } = require("../constants");
const { ShortcutAnim, between } = require("./builders");

/**
 * Wyrmscraig's shortcuts, as captured (docs/wyrmscraig.md): the basalt stepping stones jump two
 * tiles at a time, a jump every 2 ticks; the rocks to Ardeaglais are climbed in one 2-tick move,
 * facing the cliff (west) both ways. Levels and XP: the Wiki's shortcut pages.
 */
const JUMP_SOUND = 2461;
const CLIMB_SOUND = 2454;
/** The rocks' top end: a nameless multiloc (gameval wyrmscraig_cliff_shortcut_top) showing the climbable rocks once mined. */
const CLIFF_TOP_MULTILOC = 62265;

/** One jump: animation and sound 15 cycles in, the move from cycle 30 to 45, the next 2 ticks later. */
function basaltJump(to) {
  return [
    { sound: JUMP_SOUND, delay: 15 },
    { move: to, anim: Anim.JUMP, delay: 15, speed: [30, 45], ticks: 2 },
  ];
}

/** Basalt stepping stones: two tiles a jump from one end to the other, whichever stone is clicked. */
function steppingStones(object, level, path) {
  return between({
    object,
    level,
    xp: 5,
    ends: [path[0], path[path.length - 1]],
    cross: (from, to) => {
      const tiles = from[1] === path[0][1] ? path.slice(1) : [...path].reverse().slice(1);
      return tiles.flatMap(basaltJump);
    },
  });
}

/** The rocks below Ardeaglais: up with the climbing loop, down with the rock climb, both facing west. */
function climbCliff(from, to) {
  const up = to[0] < from[0];
  return [
    { sound: CLIMB_SOUND, loops: 3, delay: 5 },
    { move: to, anim: up ? ShortcutAnim.CLIMB_LOOP : Anim.CLIMB_ROCKS, speed: [0, 60], ticks: 2, dir: "west" },
  ];
}

const CLIFF_ENDS = [[2554, 2209, 0], [2550, 2209, 0]];

module.exports = [
  steppingStones(ObjectIds.BASALT_STEPPING_STONE, 58, [[2584, 2286, 0], [2584, 2284, 0], [2584, 2282, 0], [2584, 2280, 0]]),
  steppingStones(ObjectIds.SLIPPERY_BASALT_STEPPING_STONE, 62, [[2565, 2217, 0], [2565, 2219, 0], [2565, 2221, 0]]),
  steppingStones(ObjectIds.EXTRA_SLIPPERY_BASALT_STEPPING_STONE, 72, [[2614, 2250, 0], [2614, 2248, 0], [2614, 2246, 0]]),
  between({ object: ObjectIds.ROCKS_194, level: 54, xp: 5, ends: CLIFF_ENDS, cross: climbCliff }),
  between({ object: CLIFF_TOP_MULTILOC, level: 54, xp: 5, ends: CLIFF_ENDS, cross: climbCliff }),
];
