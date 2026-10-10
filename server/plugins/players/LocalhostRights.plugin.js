"use strict";

// Lets a local login (the dev client at localhost) use developer tools without that rank
// ever reaching the account save: the rights the player logged in with are restored on
// logout, so a later login from anywhere else keeps its real rank. The env-based
// DEV_USERNAME check in NetworkBuilder stays the way to pin a specific account.
const LOCAL_HOSTS = new Set(["127.0.0.1", "::1", "0:0:0:0:0:0:0:1", "localhost"]);
const savedRights = new WeakMap();
let api;

function isLocalHost(host) {
  if (typeof host !== "string") return false;
  return LOCAL_HOSTS.has(host.trim().toLowerCase().replace(/^::ffff:/, ""));
}

function login({ player }) {
  if (!isLocalHost(player.getHostAddress?.())) return;
  if (!savedRights.has(player)) savedRights.set(player, player.getRights());
  player.setRights(api.core.PlayerRights.DEVELOPER);
  // StaffCrowns may have read the rights before this hook ran.
  api.emitCustomEvent("account:refresh-chat-icons", { player });
}

function logout({ player }) {
  // onPlayerLogout runs before persistence, so the real rank is what gets saved.
  if (!savedRights.has(player)) return;
  player.setRights(savedRights.get(player));
  savedRights.delete(player);
}

module.exports = {
  name: "LocalhostRights",
  register(pluginApi) {
    api = pluginApi;
    pluginApi.onPlayerLogin(login);
    pluginApi.onPlayerLogout(logout);
  },
  _test: { login, logout, isLocalHost },
};
