const {
  clearFollowState,
  isInsideHomeArea,
  markResumeSoon,
  resetMovementState,
  teleportHome,
} = require("../../state/PlayerBotState");
const { resolveBotNodeContext } = require("../context/BotNodeContext");
const { startBrainRoam } = require("../../../brain/RoamService");

class ReturnHomeActionNode {
  constructor(botStatesByName, api, options) {
    this.botStatesByName = botStatesByName;
    this.api = api;
    this.behaviorMode = options.behaviorMode;
    this.botHomeRadius = options.botHomeRadius;
    this.blockedRetargetMinDelayMs = options.blockedRetargetMinDelayMs;
  }

  tick(context) {
    const resolved = resolveBotNodeContext(context, this.botStatesByName, {
      requiredMode: this.behaviorMode.RETURN_HOME,
    });
    if (!resolved) {
      return "failure";
    }
    const { player, state, nowMs } = resolved;

    clearFollowState(player, state);
    resetMovementState(player);

    if (isInsideHomeArea(player, state, this.botHomeRadius)) {
      startBrainRoam(player, state, nowMs, state.home);
      markResumeSoon(state, nowMs, this.blockedRetargetMinDelayMs);
      this.api.log("return_home_local_resume", { username: player.getUsername() });
      return "success";
    }

    if (teleportHome(player, state)) {
      startBrainRoam(player, state, nowMs, state.home);
      markResumeSoon(state, nowMs, this.blockedRetargetMinDelayMs);
      this.api.log("return_home_teleport", {
        username: player.getUsername(),
        home: state.home,
      });
      return "success";
    }

    return "failure";
  }
}

module.exports = {
  ReturnHomeActionNode,
};
