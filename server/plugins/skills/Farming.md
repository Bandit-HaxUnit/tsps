# Farming plugin

The loader entry is `Farming.plugin.js`; implementation is TypeScript in
`src/main/typescript/elvarg/game/plugin/impl/farming/`.

Implemented: player-owned patches, saved offline growth, raking, planting,
watering, disease and cures, harvesting, regrowth, compost bins and bottomless
buckets, saplings, gardener payments, leprechaun storage/noting, seed vault,
seed boxes/herb sacks, contracts and rewards, anima plants, farming spells,
amulets, barbarian Farming, Tithe Farm, and a private Hespori encounter/retrieval
service. The generated cache data identifies 108 grouped patches and 40 Tithe
plots; gameplay tables contain 82 crops. XP follows the server's configured rate.

## Fidelity limits

This is **not a verified 1:1 implementation**. In particular:

- Unpublished disease/watering probabilities, some yield endpoints, Kronos
  skip probability, barbarian training failure probability, and Hespori's
  special/poison scheduling use estimates marked `ponytail:` in the code.
- Tree chopping uses the existing Woodcutting plugin's rates/depletion model.
  Redwood branch depletion does not yet reproduce OSRS's independent timers.
- Geomancy, storage, contracts, and Tithe rewards use existing dialogue menus;
  the original dedicated interfaces and Tithe overlay are not reproduced.
- Spirit-tree travel currently links player-grown trees. The ordinary network,
  quest-specific crops/access restrictions, achievement completion, and the
  wider quest/diary progression systems are not implemented by this plugin.
- The complete Zamorak equipment list for Bologa and the precise nightshade
  glove restrictions still need parity work.
- Region 25287 could not be decoded by the cache export. Its contents are not
  included in the patch coverage claim. No in-game or smoke tests were run.

## Verification

From `server/`:

```powershell
npx.cmd tsc --noEmit
node -r ts-node/register/transpile-only src/main/typescript/elvarg/game/plugin/impl/farming/FarmingModel.test.ts
```

The second command is an isolated state-machine check, without server startup,
sockets, player login, or a smoke harness. It covers offline/save equivalence,
disease/death, mature immunity, private stump regrowth, herb formulas, critical
cache states, and Tithe growth/scoring. Cache-only audits also checked crop item
resolution and growing, diseased, dead, and mature visual values.

To regenerate the checked-in cache export:

```powershell
node -r ts-node/register/transpile-only scripts/generate-farming-data.ts ../..\runelite
```

Sources: [Farming](https://oldschool.runescape.wiki/w/Farming),
[Disease](https://oldschool.runescape.wiki/w/Disease_(Farming)),
[herb calculator](https://oldschool.runescape.wiki/w/Calculator:Farming/Herbs),
[Tithe Farm](https://oldschool.runescape.wiki/w/Tithe_Farm),
[Hespori](https://oldschool.runescape.wiki/w/Hespori), and the linked crop/tool
pages (OSRS Index's attributed wiki copies were used where direct access failed).
RuneLite supplies timing/varbit interpretation; the local cache supplies object
transforms and map locations. Its retained BSD notice is in
`data/definitions/farming-cache.LICENSE`.
