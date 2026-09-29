// Boarding and disembarking a boat at a dock's gangplank (varbit 19104 switches its op between
// Board and Disembark). Fade out, move a tick later, fade back in the tick after, as in rsmod's
// live traces.
const { Task } = require("../../../src/main/typescript/elvarg/game/task/Task");
const { TaskManager } = require("../../../src/main/typescript/elvarg/game/task/TaskManager");
const { Sailing } = require("../../../src/main/typescript/elvarg/game/content/sailing/Sailing");
const { content, dockAtGangplank, fade, playSound } = require("./sailingContent");

const SOUND_BOARD_BOAT = 10754;

function later(player, ticks, action) {
  TaskManager.submit(new (class extends Task {
    constructor() { super(ticks, player); }
    execute() {
      action();
      this.stop();
    }
  })());
}

function boardBoat({ player, location }) {
  const dock = dockAtGangplank(location);
  if (!dock) return false;
  fade(player, true);
  later(player, 1, () => {
    const refusal = Sailing.board(player, dock.id);
    if (refusal) {
      fade(player, false);
      player.sendMessage(refusal);
      return;
    }
    playSound(player, SOUND_BOARD_BOAT);
    player.sendMessage("You board your boat.");
    later(player, 1, () => fade(player, false));
  });
}

function disembarkBoat({ player, location }) {
  const dock = dockAtGangplank(location);
  if (!dock || !Sailing.instanceAboard(player)) return false;
  fade(player, true);
  later(player, 1, () => {
    const refusal = Sailing.disembark(player, dock.id);
    if (refusal) player.sendMessage(refusal);
    else player.sendMessage("You disembark from your boat.");
    later(player, 1, () => fade(player, false));
  });
}

module.exports = {
  name: "SailingGangplank",
  register(api) {
    content();
    api.onObjectInteraction("Gangplank", { Board: boardBoat, Disembark: disembarkBoat });
  },
};
