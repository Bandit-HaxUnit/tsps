# Port tasks

Courier tasks: deliver crates of cargo between two ports for Sailing XP and a bag of coins or
loot. Bounty tasks: collect a sea creature's parts by harvesting its corpses, then hand them in at
a port master for Sailing XP and coins.

Code: `server/plugins/skills/sailing/PortTasks.plugin.js` and its units in `porttasks/`
(`Board`, `Ledger`, `PortMaster`, `Bags`, `Bounty`, `Common`); the cargo hold's crate handling is in
`CargoHold.plugin.js`. Data: `server/plugins/skills/sailing/data/port-tasks.json`. Tests:
`server/tests/port-tasks.test.cjs`.

## Sources

- The rev 241 cache: every task in table 197 (`port_task`: name, type, level, start, cargo and
  end port, crate and amount), each notice board's pool (db rows named
  `port_task_<board>_<courier|bounty>_<n>`), the notice board and ledger table locs, the 440
  crate items, the port master NPCs, the coin and reward bag items, and cache scripts 8912
  (the board) and 8900 (a task's details). The XP and coin columns of table 197 are server side
  and empty in the client cache.
- The OSRS Wiki: each courier task's XP (Courier tasks, by task id), task slots by level, the
  bag rules (Port coin bag, Port reward bag), shark paint's 1/36, the port masters' positions
  where a recording doesn't have them, and cancelling.
- Recordings from the rsprox.net database (https://rsprox.net/database, rev 235): the board,
  accepting, the ledger table, the cargo hold, delivery, the port master's Claim-rewards and
  Cancel-task lines, the varbits and the messages. Rev 241 has the same board scripts.

## The flow

1. **Notice board** (Inspect): the board (interface 941) with the player's eight tasks for it,
   drawn by script 8912 from their db rows; the board's events are on 941:3, six children a
   task. A board's eight are drawn at random from its pool of 26 (courier and bounty tasks),
   kept per player, and a task's entry is drawn again once it's done.
2. **A task's details**: a click opens 942 on 941:5, drawn by script 8900 with the task's db
   row. Its Accept answers a count dialog with 1 (closing it, 0). Accepting fills the first free
   slot (`port_task_slot_n_id`), says "You have accepted the <task> port task." and redraws the
   board.
3. **Slots**: 1 task, and one more at Sailing 7, 28, 56 and 84 (not boostable).
   `port_task_extra_slots_unlocked` is the number beyond the first.
4. **Ledger table** at the cargo port (Take-cargo; the table shows Deposit-cargo instead while
   `sailing_carrying_cargo` is set): both hands must be free ("You cannot pick up any cargo as
   your hands are full."). The crate goes into the weapon slot, with `human_pickuptable` and
   sound 2739, `_cargo_taken` counts up, `port_task_last_cargo_taken` is the slot (+1) and
   "You pick up a crate of <cargo>." shows in an item box, with "There is one more crate of
   this type to collect." while more are left. With none: "There is no cargo available for you
   to collect here."
5. **Cargo hold**: Deposit-held (its op while carrying) stores the crate: "You deposit some
   cargo into the cargo hold." Clicking a crate in the hold puts it back in the player's hands
   and closes the hold.
6. **Ledger table** at the destination (Deposit-cargo): "You deliver the crate of <cargo>.",
   "There is one more crate of this type to deliver." while more are left. The last completes
   the task: Sailing XP, a port coin bag (4 in 5) or the destination's reward bag (1 in 5),
   sized by the task's base XP (tiny below 400, small 1,000, medium 2,500, large 6,000, else
   huge), shark paint 1 in 36, `port_tasks_completed` (varp 5207) and
   `port_tasks_completed_today` count up, the slot clears, "You have finished the <task> port
   task." and "You deliver the crate of <cargo> and complete your courier task!". With a full
   inventory the bag waits for a port master's Claim-rewards.
7. **Port master**: Claim-rewards ("Thanks, sailor. Here's your payment." / "According to my
   records, you don't have any port task rewards to claim."), Cancel-task (a choice of held
   tasks; "I'm afraid you don't have any assigned tasks for me to cancel."; the task's crates go
   from the player's hands and their boats' holds). Talk-to is the Wiki dialogue. Thirty port
   masters stand where the recordings show them (Mos Le'Harmless, which has no board or dock
   here, isn't spawned).
8. **Bags**: a port coin bag opens to coins by size (800-1,200 up to 6,400-9,600).
   Port reward bags open for exactly one shared or destination-specific drop; see below.

- **Carrying**: a crate in both hands uses the cache's human crate-carrying set
   (`dttd_carrying_crate_ready`, `_walk`, `_walk_fast` for running), in each crate's
   `item-gameplay.json` entry. Live's set isn't in a recording (RSProx doesn't print appearance
   animations); it's the only human crate-carrying set in the cache.

- **Crewmates** carry crates too (docs/sailing.md, Crewmates; `crew/Courier.Crew.js`): the
   ledger counts the crates they hold as collected, adds "but your crew can help with that." to
   the pickup box, and takes theirs before the player's crate. Counts in the boxes are spelt out
   ("There are two more crates of this type to collect", rsprox).

## Ours, not live

- The recordings predate the bags (they paid coins: "...and been given 59 coins as payment."),
  so the completion message leaves the payment out.
- The refusals when accepting (level, no free slot, already held, a bounty task), "This cargo
  isn't for delivery here.", "Your cargo hold is too full to hold any more cargo.", the cancel
  menu and its message, and the coin bag's message.
- Task 91 has no XP on the Wiki: 3194 is twice the reverse delivery's (task 90), as a round
  trip gives double.
- A board only redraws an entry once its task is done; live also changes a board over time.

## Bounty tasks

Sources: the user's rev 241 capture of the Pandemonium tern bounty, the cache (table 197's
`bounty_target_alive`, `bounty_object`, `bounty_object_amount` and `bounty_object_rarity`) and the
Wiki (Bounty tasks: the XP per creature, coins equal to it, handing in at any port master, a
second bounty on the same creature waiting for the first, keeping parts when cancelling).

- Taken at a notice board like a courier task: "You have accepted the <col=0090bc>Pandemonium tern
  bounty</col> port task.", the slot's id varbit and its `bounty_task_item_counter_n` (14662,
  14663, 14819, 15370, 15397, one per slot) set to the parts still needed (5 Tern beaks). Parts
  already held (kept from a cancelled bounty of the kind) count, but not those another held
  bounty already counts.
- Harvesting the task's creature (docs/sailing.md, Combat) rolls its part at 1 in its rarity
  (10 for the five-part beaks, livers and ink sacs; 2 or 3 for the rest) while parts are still
  needed: "One Signal has harvested 1x Tern beak." (the player's name), "<col=ef1020>Untradeable
  drop: Tern beak</col>", jingle 6765 (30 cycles in) and the counter down by one; the part goes
  in with the rest of the loot.
- A port master's Claim-rewards hands in every finished bounty's parts (from the inventory, then
  the active boat's hold): the creature's bounty XP (3,465 for a tern) and as many coins (to the
  bank when the inventory has no room),
  1/36 shark paint, "You have finished the ... port task." and "Thanks, sailor. Here's your
  payment.". Parts can be stored in the cargo hold, and a recovery loses them.

## Not done

- Bounty parts' drop rate scaling with damage dealt, and the boosted rates before the count is met
  (Wiki); the parts' rates here are 1 in the cache's rarity.
- Confiscating crates on a teleport, or when leaving port with one in hand, and the captain's
  log's task list and cancel.
- Trim being refused while carrying cargo.

## Opening port reward bags

`porttasks/Bags.PortTasks.js` handles the native inventory Open option. Its
`Loot.PortTasks.js` unit reads `data/port-reward-bags.json`: five shared tables and
the 95 obtainable size/destination combinations. Every courier task offered by
the current boards has a supported reward-bag table. The other 55 cache combinations
are unobtainable according to the Wiki; developer-created copies are refused intact.
Bag awarding, coin bags and bounty tasks are unchanged.

### Evidence and limits

- [Port reward bag](https://oldschool.runescape.wiki/w/Port_reward_bag) and the
  [Tiny](https://oldschool.runescape.wiki/w/Tiny_port_reward_bag),
  [Small](https://oldschool.runescape.wiki/w/Small_port_reward_bag),
  [Medium](https://oldschool.runescape.wiki/w/Medium_port_reward_bag),
  [Large](https://oldschool.runescape.wiki/w/Large_port_reward_bag) and
  [Huge](https://oldschool.runescape.wiki/w/Huge_port_reward_bag) size pages, fetched
  29 October 2026, supply the shared/destination items, quantity ranges, noted
  rewards and weights. One bag gives one drop, including its local-item roll in
  the main table. Local probabilities are respectively 1/96, 1/84, 1/80, 2/155
  and 1/75. Multiple local possibilities use the Wiki's conditional weights.
- The Wiki quotes Mod Ash on 12 October for the local-item probabilities and on
  13 October for Huge's dragon nails (4/225) and dragon metal sheet (1/225).
  Shared decimal weights are scaled to integers without rounding; the local-item
  chance remains part of the main-table roll. Entries the Wiki explicitly marks approximate retain
  `approximate: true`; observed quantity ranges and other crowdsourced rates
  remain Wiki evidence, not an independent measurement of OSRS's exact formulas.
- The [pinned revision 241 object dump](https://github.com/Joshua-F/osrs-dumps/blob/6e5033af6215963581a51b348f452320ff18f0f6/config/dump.obj)
  supplies item gamevals and cert identities, verified against the shipped
  `osrs-241_2026-10-20` cache. Bag param 2645 is its size. The Tiny Cairn Isle and
  Entrana Wiki quantity fields are blank: their bag params 2646/2647 identify
  noted sapphire ×10 and noted big bones ×15 respectively. These are explicitly
  marked with `quantitySource` in the data. Those two quantities are cache-backed
  fallback values, not captured server rewards. Small Summer Shore's Wiki row
  says Elkhorn frag ×3 '(noted)', but this cache has no noted frag: it is already
  stackable, so the real `coral_elkhorn_frag` is used.
- Searching the local RSProx index for `*port_task_lootsack*`, `*port*reward*`
  and `*port*coin*` found no recordings. Other `*lootsack*` matches are Hunter
  sacks, not port bags. No port-bag animation, sound, exact message or delay has
  therefore been established by a recording. Opening is immediate, with a plain
  reward message and no invented animation/sound. The refusal/message wording
  and retry bookkeeping below are implementation choices.

### Inventory, retries and persistence

- Validate the live inventory widget, clicked slot, held Item identity and amount;
  busy/trading, dead, teleporting and stale contexts cannot consume a bag.
- Plan on a real Inventory copy, remove one bag from that exact slot, and ask
  `getAddableAmount` whether the complete drop fits. This includes metadata stack
  equality and the integer stack cap. The last bag can free its own output slot;
  a remaining bag stack cannot. Refusal preserves all input and output amounts.
- A refused roll is saved under `port-tasks:pending-bag-rewards`, keyed by bag ID,
  and validated against the current loot table before use. Bank transfer and
  logout cannot reroll it; a successful opening consumes one bag, delivers the
  complete reward, clears that pending entry and refreshes inventory once.
- There is no delayed task/session to replay or cancel. No item storage is
  accessed by Open, so a Bank PIN guard is not applicable. Existing bank actions
  retain their own guards. No generated data, core API or save schema changes.

### Production path and verification

Native canvas inventory Open → `ClientConnection.inventoryAction` →
`ItemActionPacketListener.handleAction/handleFirstAction` → named
`PluginManager` item-action hook → `openRewardBag` → real `Inventory` /
`ItemContainer.getAddableAmount`, exact-slot deletion and add → inventory packet
and message. `Item` owns metadata cloning; `ItemContainer` owns capacity, merges
and caps; `PlayerSave` plus the registered persistence plugin owns the saved
inventory and pending attribute. Unchanged inventory slots keep their Item
identity; only the consumed bag and awarded/merged reward are mutated.

`tests/port-reward-bags.test.cjs` loads every enabled plugin and actual startup /
shutdown hooks, with real Player, Inventory and cache data. Network output is the
only stubbed game boundary; deterministic RNG selects loot fixtures. It covers
the native packet widget, all supported tables and quantity endpoints, last/full
inventory, stack cap, metadata, exact-slot consumption, repeated/stale clicks,
busy/dead states, real bank transfer and actual save-codec hydration. Source
limits above still apply even when these checks pass.

On base `3aa2ed9d2`, the feature/Sailing targeted run passed 120/120; independent
feature/Bank/Trading/PlayerSave checks passed 129/129. The full server suite had
10,038 passes and six failures out of 10,044. All six reproduced on a separately
built clean `3aa2ed9d2` source snapshot: belladonna safe equipment, three Farming
league effects, Barronite Mining rewards and bone-burying feedback.

An independent reviewer reconciled all 254 loot rows and ran a further native
inventory → real bank deposit → SQLite worker commit/disk read → hydration →
bank withdrawal → blocked retry → deposit knife → retained reward scenario.
The subsequent bag rolled fresh loot and the cleared pending state persisted;
the emitted inventory snapshot bytes were checked. No runtime findings in those
inspected paths. Review corrected the plan's stale persistence description and
identified the Small Summer Shore noted-label discrepancy documented above.

Own-port native-client QA used controlled spawned bags and knives, with ordinary
RNG: rendered right-click Open consumed one Tiny Port Sarim bag and showed 49
Iron cannonballs and the reward message. Left-click with 28 occupied slots kept
both bags and displayed the inventory-space refusal. Dropping a knife through
the native packet freed a slot; left-click then delivered 27 Bronze nails and
consumed exactly one bag. The screenshot checks establish local client rendering
and input routing, not a comparison with an OSRS port-bag recording.
