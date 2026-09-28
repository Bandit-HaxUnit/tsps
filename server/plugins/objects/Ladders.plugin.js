const { Animation } = require("../../src/main/typescript/elvarg/game/model/Animation");
const { Location } = require("../../src/main/typescript/elvarg/game/model/Location");
const { Task } = require("../../src/main/typescript/elvarg/game/task/Task");

const CLIMB_UP = new Animation(828);
const CLIMB_DOWN = new Animation(827);
// Cache animations last 1260ms up and 1160ms down, rounded up to 600ms ticks.
const CLIMB_UP_TICKS = 3;
const CLIMB_DOWN_TICKS = 2;
let TaskManager;

function climb({ player, destination }, animation, ticks) {
  const start = player.getLocation().clone();
  const target = destination.clone();
  player.performAnimation(animation);
  TaskManager.submit(new (class extends Task {
    constructor() { super(ticks, player); }
    execute() {
      if (player.getLocation().equals(start)) player.moveTo(target);
      this.stop();
    }
  })());
}

/**
 * Callers may pass an explicit `destination` (ladders:climbUp custom event), or
 * an object interaction event carrying the ladder's `location` and the tile the
 * player clicked from (`sourceLocation`).
 *
 * A climb must land on the tile in front of the ladder, never on the ladder's
 * own (blocked) tile - otherwise the player stands inside a clipped tile and the
 * client lets them walk onto the ladder. So the generic fallback is the player's
 * source tile one plane up/down. Edgeville registers its own "Ladder" handler
 * first for its fixed link.
 */
function resolveDestination(event, delta) {
  if (event.destination) return event.destination;
  const base = event.sourceLocation ?? event.location;
  if (!base) return null;
  const z = (base.z | 0) + delta;
  if (z < 0 || z > 3) return null;
  return new Location(base.x, base.y, z);
}

function climbUp(event) {
  const destination = resolveDestination(event, 1);
  if (!destination) return false;
  climb({ player: event.player, destination }, CLIMB_UP, CLIMB_UP_TICKS);
}

function climbDown(event) {
  const destination = resolveDestination(event, -1);
  if (!destination) return false;
  climb({ player: event.player, destination }, CLIMB_DOWN, CLIMB_DOWN_TICKS);
}

module.exports = {
  name: "Ladders",
  register(api) {
    TaskManager = api.getTaskManager();
    api.onCustomEvent("ladders:climbUp", climbUp);
    api.onCustomEvent("ladders:climbDown", climbDown);
    api.onObjectInteraction("Ladder", { "Climb-up": climbUp, "Climb-down": climbDown });
  },
};
