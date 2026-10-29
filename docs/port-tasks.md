# Port tasks

Courier tasks: deliver crates of cargo between two ports for Sailing XP and a bag of coins or
loot. Bounty tasks show on the notice boards but can't be taken yet.

Code: `server/plugins/skills/sailing/PortTasks.plugin.js` and its units in `porttasks/`
(`Board`, `Ledger`, `PortMaster`, `Bags`, `Common`); the cargo hold's crate handling is in
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

## Not done

- Bounty tasks.
- Opening port reward bags (each port's loot is on the Wiki).
- Confiscating crates on a teleport, or when leaving port with one in hand, and the captain's
  log's task list and cancel.
- Trim being refused while carrying cargo.

## Port coin bag safety

`Bags.PortTasks.openCoinBag` accepts only the live native inventory source and
the exact clicked slot/Item. It rejects busy, dead, placement/teleport and stale
contexts. On a real Inventory copy, it removes one bag and calls the shared
`getAddableAmount` for the complete coin payout. The last bag may free a slot;
a remaining stack does not. Compatible coins can merge even at full inventory,
while metadata-distinct coins stay separate and the integer stack cap is enforced.
Only after the full payout fits does it consume the clicked bag, add the coins
and refresh once. Unchanged inventory slots retain their Item identity/metadata.

The [Port coin bag Wiki](https://oldschool.runescape.wiki/w/Port_coin_bag), fetched
29 October 2026, specifies inclusive payouts Tiny800–1200, Small1600–2400,
Medium2400–3600, Large3600–5400 and Huge6400–9600. This corrects the older
Small1613–2714/Medium2486–3595/Large3864–5350 endpoints. The existing uniform
integer roll is retained; the Wiki's bounds alone do not independently establish
its distribution. Cache param2647 is a display/reference value, not proof of a
server payout distribution.

The [pinned rev241 object dump](https://github.com/Joshua-F/osrs-dumps/blob/6e5033af6215963581a51b348f452320ff18f0f6/config/dump.obj)
names `port_task_lootsack_t0_coins` through `t4_coins`; active
`osrs-241_2026-10-20` cache checks confirm all five Open actions, size param2645
and coin param2646. RSProx index searches for `*port_task_lootsack*coins*` and
`*port_task*coin*` found no matching recordings. No exact opening delay, sound,
animation or message is claimed from a capture; the existing immediate opening
and reward wording remain.

A capacity failure preserves the entire bag/coin inventory and records that
bag ID's roll in registered `port-tasks:pending-coin-bags`. Bank transfer or
save/reload cannot reroll a blocked payout. Saved amounts are checked against
the current size range before delivery; success clears the entry and the next
bag rolls fresh. This bookkeeping is an implementation choice for safe retries,
not a claimed recorded OSRS attribute. There is no delayed task/session or new
save schema. Opening accesses no storage, so Bank PIN guarding is not applicable;
bank transfers continue through their own existing guard.

Production path: native canvas widget → `ClientConnection.inventoryAction` →
`ItemActionPacketListener.handleAction/handleFirstAction` → named
`PluginManager.onItemAction` hook → `openCoinBag` → real Inventory /
ItemContainer capacity, exact-slot deletion and add → inventory packet/message.
`Item` owns metadata cloning; `ItemContainer` owns merges/caps; PlayerSave and
the registered persistence plugin own the inventory and pending attribute.
`tests/port-coin-bags.test.cjs` uses real Player/Inventory/Bank and all enabled
plugins with startup/shutdown, stubbing only network output and controlling RNG
for fixtures. It checks all five Wiki endpoints, full/last slot, matching and
distinct-metadata coin stacks, caps, native widget routing, exact clicked bag,
stale/busy/dead inputs, repeat/Examine, real Bank transfer and save hydration.

The current-base feature/Sailing run passed117/117. Independent review built the
fingerprinted source with pinned Yarn4.12, traced the shared/native owners and
passed22 feature/foundation/adversarial checks with no findings in the inspected
coin paths. Its additional test flushed an actual SQLite worker, closed/reopened
the database, hydrated the player and retained a blocked800 payout despite a
maximum RNG retry; the next bag paid a fresh1200. Invalid saved amounts and
cross-size pending isolation were also checked.

Full `node --test tests/` on base`acf4a8659` plus this change:10080passed,
11failed/10091total. All11 reproduced on a separately built clean source snapshot:
belladonna equipment; three Farming league effects; cannon setup clipping;
custom-item unused IDs; Blood Moon door routing; Barronite rewards; burying
feedback; teleport-menu source data; and Whisperer entry. These are disclosed
baseline failures, not cleared by the coin tests.

Own-port native rendering QA used controlled spawned bags/knives and ordinary
RNG: the menu exposed Open, and native default Open changed two Tiny bags to
one and displayed947 coins. A28-slot inventory kept both bags and showed the
space refusal. Native Drop freed one slot; retry consumed one bag and displayed
961 coins. Screenshots and resulting server state were retained locally. The
QA server saved and stopped gracefully; no live-game change was made.
