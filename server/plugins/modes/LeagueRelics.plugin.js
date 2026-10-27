/**
 * League relics (https://oldschool.runescape.wiki/w/Trailblazer_Reloaded_League/Relics,
 * https://oldschool.runescape.wiki/w/Raging_Echoes_League/Relics): eight tiers unlocked with
 * League Points, three relics a tier, chosen for good, through the cache's relic interface. The
 * catalog (data/league-relics.json) reaches the client as structs and enums through LeagueMode's
 * `league:content-rows`, since the cache only carries the current league's (Demonic Pacts, which is
 * read from it instead). Other plugins ask `league:has-relic` { player, relic } and
 * apply a relic's effect themselves (docs/leagues.md).
 */
const Common = require("./leaguerelics/Common.LeagueRelics");

module.exports = {
  name: "LeagueRelics",
  members: true,
  dependsOn: ["LeagueMode", "LeaguePoints"],
  register(api) {
    Common.init(api);
    require("./leaguerelics/Unlock.LeagueRelics")(api);
    require("./leaguerelics/Interface.LeagueRelics")(api);
    require("./leaguerelics/Commands.LeagueRelics")(api);
    require("./leaguerelics/SuperiorSorcerer.LeagueRelics")(api);
    require("./leaguerelics/Berserker.LeagueRelics")(api);
    require("./leaguerelics/UndyingRetribution.LeagueRelics")(api);
  },
};
