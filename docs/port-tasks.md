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

### Damage contribution and on-task uniques

The [Bounty tasks](https://oldschool.runescape.wiki/w/Bounty_tasks) and individual creature
pages describe the June 2026 reward changes. Narwhals, orcas, great white sharks and armoured,
veiled and vampyre krakens scale bounty-part and pre-roll chances with damage dealt.
`Loot.SeaCombat` observes actual HP lost through `HitDamage.onApplied`, including the fatal
hitsplat after the before-death hook. Queued overkill earns no additional reward chance.
Crew cannon hits belong to their captain. Contribution is applied damage divided by the
creature's maximum HP, capped at one; the Wiki does not document a separate healing formula.
Common loot, quantities, clues and other sea creatures' chances are unchanged.

Before a bounty's required number of parts has first been received:

- Orca echo pearls: 1/70 to 1/35; dragon nails: 4–8 to 7–11 at the same 1/75 chance.
- Narwhal dragon nails: 3–7 to 5–10 at the same 1/75 chance; horns are not boosted.
- Great white shark broken dragon hooks: 1/500 to 1/250.
- Armoured kraken bottled storms: 1/500 to 1/250.
- Veiled kraken dragon cannon barrels: 1/500 to 1/250.
- Vampyre kraken bottled storms: 1/350 to 1/175.
- Those five creatures' dragon metal sheet/keel parts/large keel parts chances double.
  Inky paint is damage-scaled but receives no on-task boost.

The existing saved slot `collected` value records receipts monotonically, including retained
parts credited on acceptance. Dropping, destroying or losing parts does not reopen its boost;
missing parts can still drop as replacements. Armoured and vampyre krakens award tentacles
before ink sacs, as their individual Wiki pages specify, even if the ink sac task was accepted
first. Receiving all required tentacles allows ink sacs without handing in at a port.
Other creatures keep accepted-task order. A receipt commits only for the
same accepted slot, after the shared Ironman/members/drop hooks, and cannot commit twice.

These rates and the damage rule come from the Wiki, not a recording. The indexed vampyre
capture 235/00948 predates the rebalance and cannot establish its rates. The rev 241 tern
messages, jingle and counter remain as above. See
`docs/superpowers/plans/2026-10-29-sailing-bounty-rewards.md` for the production path and checks.

## Not done

- Opening port reward bags (each port's loot is on the Wiki).
- Confiscating crates on a teleport, or when leaving port with one in hand, and the captain's
  log's task list and cancel.
- Trim being refused while carrying cargo.
