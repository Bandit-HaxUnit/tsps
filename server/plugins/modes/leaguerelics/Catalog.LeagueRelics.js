/**
 * The relic catalog the client draws. The cache's relic interface reads its league struct's tier
 * enum, tier structs and relic structs, but the cache only carries the current league's, so a
 * league's own go to the client as structOverrides / enumOverrides (GamemodeContentStore): this
 * answers LeagueMode's `league:content-rows` with them, and asks for a resend
 * (`league:send-content`) before the interface opens. Icons are the cache's current relics',
 * per tier and slot.
 */
const Common = require("./Common.LeagueRelics");

/** structId -> params the client reads for it; a cache struct's listed params are replaced, the rest still come from the cache. */
function structRows(type) {
  const { params, iconStructs } = Common.data;
  const iconParams = params.iconParams;
  const { CacheDefinitions } = Common.core;
  const id = Common.ids(type);
  const rows = [{ structId: Common.league(type).struct, params: { [params.tiersEnum]: id.tiersEnum } }];
  Common.catalog(type).tiers.forEach((tier, tierIndex) => {
    rows.push({ structId: id.tierStruct(tierIndex), params: {
      [params.tierCost]: tier.cost,
      [params.tierRelics]: id.relicsEnum(tierIndex),
      [params.tierPassive]: id.passiveStruct(tierIndex),
    } });
    rows.push({ structId: id.passiveStruct(tierIndex), params: { [params.passiveText]: tier.passive } });
    tier.relics.forEach((relic, slotIndex) => {
      const iconSource = CacheDefinitions.getStructParams(iconStructs[tierIndex][slotIndex]);
      const relicParams = {
        [params.relicName]: relic.name,
        [params.relicDescription]: relic.description,
        [params.relicTier]: tierIndex,
        [params.relicHasItem]: relic.grants?.length ? 1 : 0,
      };
      for (const param of iconParams) {
        const value = iconSource.get(param);
        if (value !== undefined) relicParams[param] = value;
      }
      rows.push({ structId: id.relicStruct(tierIndex, slotIndex + 1), params: relicParams });
    });
  });
  return rows;
}

function enumRows(type) {
  const id = Common.ids(type);
  const tiers = Common.catalog(type).tiers;
  const rows = [{
    enumId: id.tiersEnum, valueType: "J", defaultValue: -1,
    entries: tiers.map((_tier, tierIndex) => [tierIndex, id.tierStruct(tierIndex)]),
  }];
  tiers.forEach((tier, tierIndex) => rows.push({
    enumId: id.relicsEnum(tierIndex), valueType: "J", defaultValue: -1,
    entries: tier.relics.map((_relic, slotIndex) => [slotIndex + 1, id.relicStruct(tierIndex, slotIndex + 1)]),
  }));
  return rows;
}

function datasets(type) {
  return [
    { key: "structOverrides", rows: structRows(type) },
    { key: "enumOverrides", rows: enumRows(type) },
  ];
}

/** `league:content-rows` { player, league, structs, enums }: the league's catalog joins the packet. */
function contribute(rows) {
  if (!rows || !Common.catalog(rows.league)) return;
  rows.structs.push(...structRows(rows.league));
  rows.enums.push(...enumRows(rows.league));
}

/** Asks LeagueMode to send every plugin's content again (before the interface opens). */
function send(player) {
  Common.api.emitCustomEvent("league:send-content", { player });
}

module.exports = { datasets, structRows, enumRows, contribute, send };
