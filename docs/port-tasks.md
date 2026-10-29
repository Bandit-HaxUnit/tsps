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

## Not done

- Bounty parts' drop rate scaling with damage dealt, and the boosted rates before the count is met
  (Wiki); the parts' rates here are 1 in the cache's rarity.
- Opening port reward bags (each port's loot is on the Wiki).
- The captain's log's task list and cancel.

## Hand-carried cargo restrictions

`porttasks/Cargo.PortTasks.js` owns restrictions on the physical crate in the weapon slot.
It never treats cargo held by the crew or stored in a boat as a crate in the player's hands.
The existing crew owner still handles its own departure/logout cleanup.

- [Courier tasks](https://oldschool.runescape.wiki/w/Courier_tasks), changes dated
  10 December and 26 November 2025: teleporting confiscates hand cargo, and Trim is refused
  while carrying it. [Crate of seeds](https://oldschool.runescape.wiki/w/Crate_of_seeds)
  and [Crate of potions](https://oldschool.runescape.wiki/w/Crate_of_potions) describe
  manual unequip restrictions and the 22-tick grace period outside port.
- Local RSProx 235/03467: tick 18581 attempts Navigate at a helm; tick 18582 sends
  "You can't do that while you're holding cargo in your hands." The same refusal occurs
  in 229/02656. Manual weapon Remove in 229/02656 at tick 11402 instead says
  "You can't remove the cargo. You'll need to find a safe place to put it down first."
  The removal policy uses that separate refusal. No recording of confiscation, departure warnings or relog timing was found
  in the local transcripts. Those mechanics come from the Wiki; Trim reuses that refusal.
- Rev 241 active cache confirms crate 32682 (`cargo_crate_jewellery_port_sarim`),
  carrying varbit 19134 and last-cargo-slot 19590. The pinned dump's `sailing_dock` table 194
  declares `inzone_land` and `inzone_sea` as server-only columns; their values are absent
  from the client rows.

When a shared teleport actually lands (`teleport:landed`), the crate is removed in that
tick, its owning task's `taken` count decreases by one (never below `delivered`), and it
can be collected again at the cargo port. A refusal or requirements probe changes nothing.
No task is cancelled, completed or rewarded by confiscation. Other task slots and the
boat's hold are unchanged by this handler.

Outside port, the player first receives "You're leaving port with some cargo. If you do
not return it, it will be confiscated by the shipwright wizard's autonomous tracking unit."
After 22 more ticks outside, "Your cargo has been confiscated by the S.W.A.T. team." is
sent and the same crate recovery applies. Returning cancels the countdown; boarding a
boat is safe. Repeated collection starts a new watcher; putting down/depositing/cancelling
the crate stops the previous one. The watcher survives walking and ordinary actions.

**Boundary limit:** the current implementation uses the existing `Common.dockAt` 48-tile
envelope around dock gangplank/landing tiles on plane 0. This is a TSPS approximation,
not a verified official port boundary. Neither the Wiki nor the accessible client cache
supplies the official server polygons. There is no claim of exact boundary parity.
The Courier tasks trivia uses "You are leaving port"; both detailed crate pages instead
use "You're leaving port". This implementation follows the detailed crate pages. The
warning is not claimed as captured dialogue.

Logout suspends the watcher. The crate, task counters and owning slot persist through
the normal equipment/PlayerSave path; login rebuilds carrying/last-slot varbits and starts
a fresh outside grace period. Resetting that unsaved countdown is a local choice: official
relog countdown behavior was not recorded. Old saves without an owning slot are associated
only when exactly one outstanding task matches the physical crate.

Native path map: ledger/hold object or interface action -> `Common.carry` -> equipment,
persisted `port-tasks:carried-slot`, cargo varbits and `port-tasks:cargo-carried` -> watcher.
`Common.putDown` clears that state and emits `port-tasks:cargo-released`. Native equipment
remove/equip -> `EquipPacketListener` -> existing `canUnequip`/`canEquip` policy hooks.
Helm Navigate/Trim -> `sailing:can-use-hands {player,allow}` -> physical equipment check;
crew-driven navigation does not invoke the player's hands policy. Teleport spell/tablet ->
`TeleportHandler` -> committed `teleport:landed` -> confiscation and task/client updates.

After the shared death owner finishes item loss, `onPlayerDeath` clears the saved hand
owner and carrying varbits only when the equipped crate is actually gone. It does not
change death-drop ownership or task counters, and it never clears an unrelated weapon
installed by another death observer. A safe death retaining the physical crate also
retains its owning slot, hands restrictions and watcher.

Native QA additionally exposed the Pandemonium quest's startup fallback tables replacing
the two port ledger multilocs with fixed Take/Deposit variants. The fallback objects now
use cache names `dock_loading_bay_ledger_table_port_sarim` (60322) and
`dock_loading_bay_ledger_table_pandemonium` (60324). The resolved action variants remain
60320/60321. Tests inspect the actual `ObjectManager` scene overlays and use the resolved
client loc ID through `ObjectActionPacketListener`, including the quests' task 599/600
hand-ins; selecting an invisible base-map object would miss this production problem.

Validation on the acf4a8659 base: pinned Yarn 4.12 build; 205 tests passed across the cargo,
port-task, sailing, crew, boat-teleport and two Sailing quest suites. The 20 new cargo cases
load all 397 plugins and startup hooks and use real players, equipment, inventory,
movement, teleport/death tasks and save hydration; network output is captured. Independent
review retained failing native removal, death and quest-delivery reproductions, then
passed 71 checks on the final source with no failed hook logs. Extra independent checks
include a native tablet against ambiguous legacy task slots, movement cancellation plus
an unrelated modal, actual Ferox safe death, and both native quest hand-ins.

The isolated rendering-client walkthrough accepted Brimhaven jewellery task 24 on the real
notice board. Mapped MCP interactions collected its crate from the corrected ledger and
used the gangplank, Helm Navigate and Sails Trim; the rendered client and server updates
showed the crate and the correct refusals. Actual canvas input verified worn-weapon
Remove preserving cargo with its separate message, and inventory Break on a Lumbridge
tablet. Landing at 3223,3219 removed the crate and cleared 19134/19575/19590 to 0; the same
task remained accepted and could supply another crate.

For the visible departure warning, administrative placement at 3000,3000 was a controlled
water-tile fixture: it showed the carrying crate/warning, then confiscation and empty
equipment with all three indicators 0. Attempts to walk out of the Pandemonium found no
route, so this is not claimed as a normal native walk across an official boundary. The
independent movement/cancellation regression verifies the 22-tick watcher flow separately.
The QA server saved the account and shut down gracefully; its separate static client was
also stopped. No live server was used.
