/**
 * Leagues (https://oldschool.runescape.wiki/w/Leagues): a world that runs a league (world.json
 * `"pluginConfig": { "league:type": 4 }`) logs every account into its league character, a save
 * of its own (docs/leagues.md). This plugin gives that character its league (data/leagues.json), its XP
 * rate, the journal's Leagues tab and its Summary / Info / Rank panels, its rank and the
 * summary's statistics, the relic tiers' passives (Passives and BoostedDrops), and sends the structs and enums its screens need (Content). Points are
 * LeaguePoints.plugin.js, relics LeagueRelics.plugin.js; they talk over the `league:*` events
 * listed in the docs. A plain world's characters see none of it.
 */
const Common = require("./league/Common.LeagueMode");

module.exports = {
  name: "LeagueMode",
  members: true,
  register(api) {
    Common.init(api);
    require("./league/Account.LeagueMode")(api);
    require("./league/Content.LeagueMode")(api);
    require("./league/Journal.LeagueMode")(api);
    require("./league/Panels.LeagueMode")(api);
    require("./league/Rank.LeagueMode")(api);
    require("./league/Statistics.LeagueMode")(api);
    require("./league/Passives.LeagueMode")(api);
    require("./league/BoostedDrops.LeagueMode")(api);
    require("./league/Commands.LeagueMode")(api);
  },
};
