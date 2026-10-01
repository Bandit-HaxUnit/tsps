const { Anim } = require("./constants");

/** Climbs (wall, net, tree) onto another plane: animate, then land a tick later. */
function climb(destination, animation = Anim.CLIMB_UP, ticks = 1) {
  return [{ anim: animation }, { wait: ticks }, { tele: destination }];
}

/** Leaps across a gap in one tick and lands on `destination`. */
function leap(destination, { face = null, jump = Anim.LEAP, land = Anim.LAND } = {}) {
  return [
    face ? { face } : null,
    { anim: jump, delay: 15 },
    { wait: 1 },
    { tele: destination },
    land != null ? { anim: land } : null,
  ];
}

/** Walks a tightrope/log/plank path; pair with `render: Anim.BALANCE_WALK`. */
function balance(...path) {
  return [{ walk: path }];
}

module.exports = { climb, leap, balance };
