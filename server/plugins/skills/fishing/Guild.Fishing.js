/**
 * Fishing Guild (OSRS Wiki): level 68 Fishing to go through the front door, and temporary boosts
 * count. Inside, an invisible +7 Fishing boost applies to catch rolls.
 */
const GUILD_LEVEL = 68;
const INVISIBLE_BOOST = 7;

// Front door: a wall on the south edge of its tile (cache loc 20925, type 0, rotation 3), so the
// door tile is inside and the tile south of it outside.
const DOOR = Object.freeze({ x: 2611, y: 3394, z: 0 });
const INSIDE = Object.freeze([2611, 3394]);
const OUTSIDE = Object.freeze([2611, 3393]);

// The guild's map region from the door wall up to the docks. It holds only the guild's own spots
// (Wiki: about 11 cage/harpoon and 9 big net/harpoon), so these bounds stand in for the fenced
// grounds. Kylie Minnow's platform (y 3437 up) is not part of the guild and gets no boost.
const GUILD_BOUNDS = Object.freeze({ minX: 2560, maxX: 2623, minY: DOOR.y, maxY: 3436, z: DOOR.z });

const WALK_ANIMATION = 819;

let core = null;

function isInGuild(player) {
  const location = player.getLocation?.();
  if (!location) return false;
  const { minX, maxX, minY, maxY, z } = GUILD_BOUNDS;
  const x = location.getX();
  const y = location.getY();
  return location.getZ() === z && x >= minX && x <= maxX && y >= minY && y <= maxY;
}

function invisibleBoost(player) {
  return isInGuild(player) ? INVISIBLE_BOOST : 0;
}

function later(owner, ticks, action) {
  core.TaskManager.submit(new (class extends core.Task {
    constructor() { super(ticks, owner, false); }
    execute() { this.stop(); action(); }
  })());
}

/** Steps the player through the doorway, hiding the door for them while they pass. */
function crossDoor(player, door, x, y) {
  if (player.getForceMovement()) return;
  const from = player.getLocation().clone();
  const dx = x - from.getX();
  const dy = y - from.getY();
  if (Math.abs(dx) + Math.abs(dy) !== 1) {
    player.moveTo(new core.Location(x, y, from.getZ()));
    return;
  }
  player.getPacketSender().sendObjectRemoval(door);
  const direction = dy > 0 ? 0 : dx > 0 ? 1 : dy < 0 ? 2 : 3;
  // 30 client cycles is one tick; the task moves the player once it has played out.
  core.TaskManager.submit(new core.ForceMovementTask(player, 2,
    new core.ForceMovement(from, new core.Location(dx, dy, 0), 0, 30, direction, WALK_ANIMATION)));
  later(player, 3, () => player.getPacketSender().sendObject(door));
}

// Leaving is always allowed; only players outside are checked.
function useGuildDoor(request) {
  const { player, object, location } = request;
  if (request.objectId !== core.ObjectIdentifiers.DOOR_422 ||
      location.x !== DOOR.x || location.y !== DOOR.y || location.z !== DOOR.z) {
    return;
  }
  request.handled = true;
  const entering = player.getLocation().getY() < INSIDE[1];
  if (entering && player.getSkillManager().getCurrentLevel(core.Skill.FISHING) < GUILD_LEVEL) {
    player.sendMessage(`You need a Fishing level of ${GUILD_LEVEL} to enter the Fishing Guild.`);
    return;
  }
  const [x, y] = entering ? INSIDE : OUTSIDE;
  crossDoor(player, object, x, y);
}

function attach(api) {
  core = api.core;
  api.onCustomEvent("door:toggle", useGuildDoor);
}

module.exports = { attach, isInGuild, invisibleBoost, useGuildDoor, DOOR, INSIDE, OUTSIDE };
