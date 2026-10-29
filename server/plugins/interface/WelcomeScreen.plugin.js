const WELCOME_SCREEN_GROUP_ID = 378;
const PLAY_BUTTON_UID = (WELCOME_SCREEN_GROUP_ID << 16) | 72;
const FIRST_OPTION_FLAG = 1 << 1;
const pending = new WeakSet();
const visible = new WeakMap();
let api;

function inWilderness(player) {
  return api.core.Wilderness.isInLocation(player?.getLocation?.());
}

function login({ player, isNewAccount }) {
  // Mobile, new accounts and Wilderness logins enter the world directly.
  if (isNewAccount || player.isPlayerBot?.() === true || inWilderness(player)
      || player.getAttribute(api.core.MOBILE_CLIENT_ATTRIBUTE) === true) return;
  pending.add(player);
}

function bootstrap(event) {
  const { player } = event;
  if (!pending.delete(player) || inWilderness(player)) return;
  event.handled = true;
  visible.set(player, event.open);
  const sender = player.getPacketSender();
  sender.sendRootInterface(WELCOME_SCREEN_GROUP_ID);
  sender.sendInterfaceFlags(PLAY_BUTTON_UID, FIRST_OPTION_FLAG);
  api.emitCustomEvent("welcome-screen:shown", { player });
}

function play({ player }) {
  const open = visible.get(player);
  if (!open) return false;
  visible.delete(player);
  open();
  api.emitCustomEvent("gameframe:ready", { player });
  return false;
}

function clear({ player }) {
  pending.delete(player);
  visible.delete(player);
}

module.exports = {
  name: "WelcomeScreen",
  dependsOn: ["Wilderness"],
  register(pluginApi) {
    api = pluginApi;
    api.onPlayerLogin(login);
    api.onCustomEvent("player:gameframe-bootstrap", bootstrap);
    api.onInterfaceActionButton(PLAY_BUTTON_UID, play);
    api.onPlayerDisconnect(clear);
    api.onPlayerLogout(clear);
    api.log("registered");
  },
};
