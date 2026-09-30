# Hunter

`Hunter.plugin.js` attaches hooks; its handlers import core classes exclusively
through `api.core`. One shared tick task drives cancellable actions, trap lifetimes
and creature respawns. Birdhouse timers persist as wall-clock timestamps.

Implemented: bird snares, box traps, net traps, deadfalls, pitfalls with teasing,
magic boxes and imp banking, five tracking species, four butterflies, falconry,
twelve impling species, eleven jar loot tables, all nine birdhouse tiers with
crafting/seeding/reset, and aerial fishing with Molch pearls and golden tench.
Alry's reward shop and nest searching use the existing shop/Woodcutting plugins.

Behavior sources: [Void](https://github.com/GregHib/void) and
[Near-Reality](https://github.com/kurdowns/RSPS-NEAR-REALITY), checked against the
[OSRS Wiki](https://oldschool.runescape.wiki/w/Hunter) and the local rev237 cache.
The runtime code is original; Void's adapted trail data retains its BSD notice
in `Tracking.LICENSE`. Near-Reality supplies behavior/data reference, not code.

Known limits:

- Catch curves other than red/black chinchompas, the seed-nest curve and some
  loot details approximate OSRS. Pit prey follows the player without attacking;
  pit animations/fur quality and group butterfly effects need further parity work.
- Box traps require Eagles' Peak. A quest plugin can answer `quest:is-complete`
  with `{ player, key: "eagles_peak", complete: true }`; the fallback reads
  `quest.eagles_peak.stage >= 2`. This does not implement the quest itself.
- Lucky jars remain intact unless `hunter:lucky-loot` supplies a nonempty
  `rewards` array of `[itemId, amount]` pairs from a treasure-trail reward system.
- This cache has no usable fish-chunks or javelin-head items. Aerial fishing uses
  king worms; those missing jar-table rewards and fish cutting are omitted.
- Active traps and borrowed birds are cleaned up on logout/death/shutdown;
  birdhouses survive logout/restarts. There is no full in-game verification yet.

Check: `yarn build && node --test tests/skill-max-level.test.cjs` from `server/`.
