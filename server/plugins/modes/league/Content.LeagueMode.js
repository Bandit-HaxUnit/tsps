/**
 * The league content the client reads as if from the cache: struct params and enums a league's
 * own catalogs replace (the relic tiers, the area unlock thresholds). The client keeps one
 * `structOverrides` and one `enumOverrides` set and replaces each whole on every dataset
 * (GamemodeContentStore), so every plugin's rows go out in one packet: a plugin that needs them
 * (re)sent emits `league:send-content` { player }; this unit asks every plugin for its rows with
 * `league:content-rows` { player, league, structs: [], enums: [] } and sends the lot.
 */
const Common = require("./Common.LeagueMode");

function sendContent({ player }) {
  const league = Common.leagueOf(player);
  if (league === null) return;
  const rows = { player, league, structs: [], enums: [] };
  Common.api.emitCustomEvent("league:content-rows", rows);
  player.getPacketSender().sendContentData("server", [
    { key: "structOverrides", rows: rows.structs },
    { key: "enumOverrides", rows: rows.enums },
  ]);
}

module.exports = function attach(api) {
  api.onCustomEvent("league:send-content", sendContent);
};
