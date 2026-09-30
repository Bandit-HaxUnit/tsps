# Sailing: OSRS reference

What live OSRS actually sends for Sailing, recorded so the tsps implementation can match it. It complements [the Sailing design](sailing.md): that page says what tsps does and why; this one records the observed facts it is built from.

## Sources

- **Live captures** (rsprox, 2026-09-30): boarding the raft, skiff and sloop at The Pandemonium; Junior Jim's Recover-boat and Customise-boat; opening the raft's cargo hold. Names below are rsprox's symbolic names.
- **OSRS Wiki**: [Boat](https://oldschool.runescape.wiki/w/Boat), [Raft](https://oldschool.runescape.wiki/w/Raft), [Shipwright](https://oldschool.runescape.wiki/w/Shipwright).
- **The cache**: tsps runs revision 237 (2026-03-25). The captures are from a newer live revision, so **check every id against the cache before using it**. For example, 29506, 29517 and 29527 are the raft, skiff and sloop's second sail piece live, but fairy rings in revision 237.

Coordinates are written as rsprox does, `level_squareX_squareY_localX_localY` (map square 64 tiles; tile = square × 64 + local). "Deck tile (x, y)" means a tile relative to the boat's template zone.

## Boat types

| | Raft | Skiff | Sloop |
| --- | --- | --- | --- |
| Boat type id (varbit 19137) | 0 | 1 | 2 |
| World entity config | 1 | 2 | 3 |
| World entity size (x × z) | 8 × 8 | 8 × 8 | 8 × 16 |
| Sidepanel boat type (varp 5117) | 8110 | 8111 | 8112 |
| Sidepanel facility slots (937:25 end) | 16 | 40 | 64 |
| HP-bar NPC on deck | `boat_hp_npc_tiny` 15186 | `boat_hp_npc_small` 15187 | `boat_hp_npc_medium` 15188 |
| Player placed on (deck tile, level) | (3, 4), 1 | (4, 4), 1 | (3, 8), 1 |
| Spawn at The Pandemonium | (3074, 2987) | (3075, 2987) | (3075, 2987) |

- Every boat spawns with fine offset 64, 64 and angle 1024 (north).
- The wiki's per-boat facts (level, cost, size, crew, hotspots) are on the [Boat](https://oldschool.runescape.wiki/w/Boat) page.

### Deck templates

Every deck is copied from map square (60, 100), laid out as a grid:

- **The column is the hull material**, 8 tiles per tier: local x = 8 × tier (wooden 0, oak 1, teak 2, mahogany 3, camphor 4, ironwood 5, rosewood 6).
- **The row is the boat type**: raft y = 56, skiff y = 48, sloop y = 32 (two zones, 32 and 40).

| Seen | Template zone(s) |
| --- | --- |
| Raft, wooden hull | (0_60_100_0_56) |
| Skiff, teak hull | (0_60_100_16_48) |
| Skiff, camphor hull | (0_60_100_32_48) |
| Sloop, camphor hull | (0_60_100_32_32), (0_60_100_32_40) |

Upgrading a hull rebuilds the boat from the new column: the capture shows the world entity deleted, re-added and rebuilt from the camphor template.

### Raft deck

Deck tile (x, y), all on level 1, rotation 0:

| Loc | Id | Tile | Shape | Notes |
| --- | --- | --- | --- | --- |
| Helm | 59554 (`sailing_boat_steering_kandarin_1x3_wood`) | (3, 4) | 10 | Navigate / Stop-navigating / Escape |
| Sail | 59530 (`sailing_boat_sail_kandarin_1x3_wood`) | (3, 3) | 10 | |
| Linen sail | 29506 live (`sailing_boat_sail_kandarin_1x3_linen`) | (3, 5) | 10 | a fairy ring in revision 237: not placed |
| Cargo hold | 60245 (`sailing_boat_cargo_hold_regular_raft`) | (3, 2) | 10 | |
| Invisible | 32545 | (2, 2), (2, 3), (4, 2), (2, 5), (4, 5) | 22 | |
| Gulls sound | 58569 | (4, 3) | 22 | |
| Water loop sound | 58526 | (2, 4) | 22 | |
| Crashing waves sound | 58568 | (4, 4) | 22 | |

The HP-bar NPC stands on deck tile (3, 3), level 1.

### Skiff and sloop decks (as captured)

Deck tile relative to each template zone, level 1 unless noted. Part ids depend on the part's tier.

- **Skiff** (keel steel, trim camphor, helm oak, sail teak):
  - level 0: keel 59518 (2, 1), trim 59628 (1, 1);
  - helm 59579 (4, 6); sail 59539 (4, 4); canvas sail 29517 live (4, 5);
  - salvaging hook 60493 (3, 2, rotation 1); inoculation station 59704 (3, 1); cargo hold 60259 (4, 1);
  - sound and invisible locs around the edges.
- **Sloop** (keel adamant, trim camphor, helm mahogany, sail camphor), from zone (60_100_32_32):
  - level 0: keel 59527 (1, 3), trim 59646 (1, 2), and hull gunports 60696, 60700, 60698 and 60702;
  - helm 59607 (3, 11); sail 59548 (4, 10); canvas sail 29527 live (4, 11);
  - salvaging station 59701 (4, 6, rotation 1); salvaging hooks 60505 (2, 5) and 60506 (4, 5, rotation 3); inoculation station 59706 (2, 4); cargo hold 60273 (4, 4).
- **In the shipyard** (Customise-boat), empty facility hotspots show placeholders 59664-59667 (skiff).

### Stats

| | Raft (wooden) | Skiff (teak) | Skiff (camphor) | Sloop (camphor) |
| --- | --- | --- | --- | --- |
| Max HP (19177) | 20 | 120 | 180 | 260 |
| Base speed (19250) | 192 | 256 | 320 | 320 |
| Speed cap (19251) | 320 | 384 | 384 | 448 |
| Speed boost duration (19256) | 20 | 24 | 24 | 30 |
| Acceleration (19257) | 64 | 64 | 64 | 128 |
| Defence (varp 5147) | 1 | 30 | 50 | 55 |
| Armour (varp 5148) | 0 | 300 | 300 | 600 |

- **Speeds are fine units (1/128 tile) per tick.** 192 is 1.5 tiles, 256 is 2 and 320 is 2.5, matching the wiki's base speed for wooden, teak and camphor hulls.
- **Per-style defence**, varps 5159-5165 (stab, slash, crush, magic, heavy, standard and light ranged): raft 24, 11, 6, 9, 4, 13, 26; skiff (camphor) 103, 76, 54, 66, 34, 68, 111.
- **Resistances** (19248 storm, 19249 rapids, 19252 fetid water, 19253 crystal-flecked): 1 or 2 on the skiff and sloop, none on the raft.
- Current HP (19181) is separate from max: the captured raft was at 13 of 20.

## Boarding

The gangplank's Board (op 1) opens the boat selection interface when you own several boats; with one boat it boards straight away. After choosing, in order:

1. Fade out: interface 174 on the atmosphere overlay, script 948 `[0, 255, 0, 0, 15]`; minimap state 2.
2. Message (type spam): **"You board your boat."**
3. Varbits:
   - `sailing_boat_spawned` 19121 = boat slot (from 1);
   - `sailing_previous_boat_data_slot` 19130 = slot;
   - `sailing_previous_boat_type_id` 19143 = boat type;
   - `sailing_boarded_boat` 19136 = 1;
   - `sailing_boarded_boat_type` 19137 = boat type;
   - `sailing_boarded_boat_world` 19122 = world;
   - the boat's name, packed into 19149 and 19150;
   - `sailing_player_is_on_player_boat` 19104 = 1;
   - `sailing_sidepanel_player_role` 19233 = 10 (captain);
   - `sailing_last_personal_boat_boarded` 18554 = slot;
   - `sailing_preloaded_anims` 19118 = 1.
4. Sidepanel values: varp 5117 (boat type), move mode 19175 = 4 (moored), players on board 19235 = 1, helm status 19176 = 1, max and current HP, facility tiers and hotspots, repair kits (raft 10), and the stats above.
5. `WORLDENTITY_INFO` adds the boat. The player teleports onto the deck (level 1). `REBUILD_WORLDENTITY` builds the deck from the template, then the HP-bar NPC and the deck locs are added.
6. Sound 10754. Script 8776 `[name, 1, "", 1]`, script 915 `[0]`, and the sidepanel (937) opens on the combat tab.
7. Sidepanel events:
   - 937:1 slots 0-12, op 1;
   - 937:25 slots 0 to the boat's facility slots, ops 1-4;
   - 937:26 same slots, target NPC;
   - 937:20 same slots, op 1;
   - 937:29 slots 0-11, op 1;
   - 937:10 slots 0-1, target player;
   - 937:38 slots 0-3, op 1.
8. The sails play their "down" animation: raft 13367, plus 13875 on the linen sail.
9. Fade in: script 948 `[0, 0, 0, 255, 15]`, minimap state 0.

**Disembarking** (captured at the shipyard's gangplank):
- the player teleports back ashore;
- varbits 19136, 19137, 19122 and 19104 go to 0;
- the helm plays its inactive animation (13345 on the skiff);
- script 8778 `["", 1, "", 1]` runs;
- players on board 19235 goes to 0.

## Per-boat varbits

The server describes every owned boat to the client at login (live login capture) and whenever one changes. Each boat slot has a block of varbits, 38 ids apart: slot 1 starts at 19258, slot 2 at 19296, up to slot 5 at 19410.

| Offset | Varbit (slot 1) | Value |
| --- | --- | --- |
| +0 | 19258 `owned` | 1 |
| +1 | 19259 `type` | raft 0, skiff 1, sloop 2 |
| +2 | 19260 `port` | the dock's port id (0 = Port Sarim, 1 = The Pandemonium); 255 bottled, 254 capsized, 253 lost at sea (cache script 8997) |
| +3 | 19261 `bottle_previous_port` | 255 |
| +4 | 19262 `facilities_unaltered` | 1 |
| +5, +6, +7 | 19263-19265 `name_1`-`name_3` | the name's three words |
| +8 to +11 | 19266-19269 keel, hull, sail, steering | part tiers (0 on a raft) |
| +15 + n | 19273 + n `hotspot_n` | the facility at hotspot n (raft hotspot 0 = 15) |
| +26 | 19284 `trim` | trim tier |

- **HP:** stored HP is 19458 + slot and stored max HP is 19463 + slot.
- **Also at login:**
  - `sailing_intro` (18314): 50 once the intro (The Pandemonium) is done;
  - the last dock, standard dock and mooring point (19145-19147);
  - where the boat was spawned: slot, fine x/z, angle (19121, 19141, 19142, 19129);
  - `last_personal_boat_boarded` (18554) and `previous_boat_data_slot` (19130);
  - the cargo hold warning (19123).

**Boat names** are three words (cache scripts 9085 and 9088):
- Word *n* (1-based, 0 = none) is entry *n* − 1 of the string list in db row 8545, 8546 or 8547 (table 187, column 1). The words are joined with spaces.
- With no words, the name is "Boat" (row 8547's column 0).
- Row 8545's list is empty in revision 237. The raft in the capture, words 0, 32, 57, is "Extreme Pride".

## Boat selection (interface 934)

One interface serves the gangplank and Junior Jim. Varbit 18553 sets the mode, and varp 5005 is the current dock's db row (8588 = The Pandemonium):

| Mode (18553) | Opened by |
| --- | --- |
| 2 | Customise-boat |
| 3 | Board (gangplank), when you own more than one boat |
| 5 | Recover-boat |

**Opening:**
1. The server sends the bank (95) and every cargo hold (963-967).
2. Script 2524 `[-1, -3]`, then 934 opens as the main modal.
3. Script 8621 initialises it.
4. 934:5 gets slots 1-5, with pause button and op 1.
5. `busy` is set to 1.

**Choosing:** a choice is a pause-button resume on 934:5 whose slot is the boat's slot + 1. The mode and dock vars go back to 0 and -1, and the interface closes.

**Texts in its scripts** (shown by the client for boats you can't choose):
- "You can't choose that boat at the moment."
- "That boat is already at the nearby dock. There's no need to recover it."
- "That boat is already docked at …"
- "That boat does not have anything stored in its cargo hold."

## Buying a boat (Junior Jim's Buy-boat)

Buy-boat opens the data-driven shop "omnishop", not a special interface:
- **Interfaces:** 819 as the main modal and 806 as the side modal.
- **Scripts:** 7140 `[8548, -1, -1]` and 7246 `[8548]`.
- **Shop varps:** `omnishop_selected_id` (3869) is -1 and `omnishop_lastshop` (3874) is 8548.
- **Shop definition:** db row 8548 (`sailing_boat_shop`, table 39): "Boat Emporium", entries 8549-8551 and the button text "Buy".
- **Events:**
  - list 819:38 slots 0-36, ops 1-6 and 10;
  - side items 806:0;
  - info 806:1;
  - buy, examine and request-info triggers 819:4, 819:3 and 819:5 (script triggers);
  - dropdown 819:41.

Buying itself hasn't been captured yet.

## Recovery (Junior Jim)

- **The fee is taken from the bank**, with the message "Payment has been taken from your bank." Recovery also brings back boats docked at other ports, not only sunk ones.
- **What was paid:** a raft 250 coins; a camphor sloop 60,000.
- **The boat's port varbit is set to this dock:**
  - raft `sailing_boat_1_port` 19260: from 0 to 1;
  - sloop `sailing_boat_3_port` 19336: from 26 (another port) to 1.

  So 0 seems to mean lost or sunk.
- **A Port Wizard next to Jim does the work.** One of Perrie, Peter, Petra or Paulie (15378-15381) appears at (3059, 2981):
  - teleports in: animation 715, spot animation 1299, sound 201;
  - says (overhead) "Another recovery? This won't take long...";
  - casts: animation 725, spot animation 3546 with delay 10, sound 10900 with delay 35;
  - teleports out: animation 714, spot animation 111, sound 200.
- **Dialogue:** Jim says "All done! The boat is now docked here at the Pandemonium." (chat head animation 568), and the player answers "Thanks!" (animation 567).
- Junior Jim is 14972 (multinpc 14975). He moves around (3058-3059, 2978-2980).

## Customisation (shipyard)

- **Customise-boat** moves you to a shipyard instance with your boat in it:
  - sidepanel shipyard mode 19173 = 1;
  - the shipyard's boat angle 19519 and fine x 19520.
- **The schematics loc** (59718) "Modify" opens interface 939, with script 8809 and events 939:17 slots 0-50 (op 1 and script trigger).
  - Building sends a script trigger on 939:17 with a payload.
  - The message box says "With the help of some workers, you swap out the hull of your boat."
- **The shipyard's gangplank** (59719) boards and disembarks. The portal (59722) "Exit" returns you to the dock.
- **Per-boat varbits:**
  - boat 2: hull 19305, trim 19322, stored HP 19459, stored max HP 19464;
  - port: boat 1 19260, boat 3 19336 (boat 2's wasn't captured).

## Cargo hold

**The loc** is a multiloc (60245 on the raft), chosen by varbit 19134:
- 0 gives "Basic cargo hold" (60577) with Open / Deposit-all / Modify;
- 1 gives 60581, whose first op is Deposit-held (when carrying cargo).

**What it holds** (OSRS Wiki, Cargo hold):
- **Capacity:** by boat and hold tier. A basic hold has 20 slots on the raft, 30 on the skiff and 40 on the sloop; a rosewood hold has 120, 180 and 240.
- **Slots:** every item takes a slot, except that a stackable item's whole stack takes one.
- **Which items:** only the wiki's "Storable items": sailing capes and tools, salvage, courier crates, bounty items, repair kits, cannonballs, ship drinks, fish, fish offcuts and crates, and fishing gear. Noted items aren't accepted.
- **Recovery losses:** courier crates, bounty items, salvage, fish and full fish crates are lost when a shipwright recovers the boat.

**Opening it:**
1. Op 1 "Open". You walk next to the hold and face it.
2. Varp 5204 (`sailing_boat_cargohold_inv`) is set to the boat's inventory: 963 for slot 1, up to 967 for slot 5. That inventory is sent in full.
3. Sound 10907, then script 917 `[-1, -1]`.
4. Interface 943 opens as the main modal and 944 as the side modal.
5. Events:
   - 943:10 slots 0-239, ops 1-6 and 10;
   - 944:1 slots 0-27, ops 1-6 and 10, plus drag;
   - 943:18 slots 0-4, op 1.
6. Text and title: 943:5 shows the capacity ("20"), and script 227 sets the title to "Cargo Hold: <boat name>".
7. The `busy` varbit (12393) is 1 while it's open.

**Closing:** varp 5205 and `busy` go back to 0, and 944 then 943 close.

**Items:**
- **Withdraw** is an op on 943:10 at the hold slot. **Deposit** is an op on 944:1 at the inventory slot, and the item goes to the hold's first free slot.
- **Quantity:** the 1 / 5 / 10 / X / All buttons (943:20-24) set `depositbox_mode` (varbit 4430) to 0, 1, 4, 3 and 2.
  - **Op 1 is the selected quantity.** Ops 2-6 are 1, 5, 10, X and All, with the selected one moved to op 1 (cache scripts 8873 and 8896). Op 10 is Examine.
  - **X** runs script 108 "Enter amount:" and reads the typed count.
  - Asking for more than there is moves what's there. Withdrawing 5 unstackable items takes them from several slots.
- **Whitelist:** varp 5205 is a bitmask of the inventory slots that can be deposited. It's rebuilt after every inventory change while the hold is open.
- **Repair kits:** the sidepanel's repair kit count (varbit 19210) is 5 uses per repair kit in the hold, and follows every change.
- **Refused:** "The cargo hold cannot store that item." (game message).
- **Deposit buttons** (943:13 Cargo, 14 Salvage, 15 Inventory):
  - Deposit Inventory moves everything storable, with sound 10905.
  - With nothing to move: "You have no cargo to deposit." / "You have no salvage to deposit.", with sound 2277.
- **Item stacking:** the "Item stacking" toggle (varbit 19592) sends nothing to the server. It only changes how the client draws the hold.
- **Warning:** "Dismiss" (944:8) sets varbit 19123 and hides the warning on the side panel.

**The tools compartment:** shared by all your boats, and taking no space. Taking a tool is op 1 on 943:18, with sound 2582.

| Slot | Tool | Item(s) | Message |
| --- | --- | --- | --- |
| 0 | Captain's log | 31986 | You collect your captain's log from the tools compartment. |
| 1 | Spyglass | 31803 | You collect a spyglass from the tools compartment. |
| 2 | Current duck | 31805 | not captured |
| 3 | Crowbar | 31807 | not captured |
| 4 | Diving gear | 7534 + 7535 | You collect some diving gear from the tools compartment. |

Depositing a tool, by Deposit Inventory or singly, puts it back in the compartment.

**Tool unlocks:** script 9138 shows a tool only once its quest progress is reached. The captain's log always shows.

| Tools row | Shown when |
| --- | --- |
| 8010 | varbit 18314 ≥ 50 (The Pandemonium, which also switches the log between 31985 and 31986 at 46) |
| 8011 | 18314 ≥ 50 and 18282 ≥ 40 |
| 8012 | 18314 ≥ 50 and 18317 ≥ 20 |
| 8013 | 18314 ≥ 50 and 1895 ≥ 40 |

## Messages

| Where | Type | Text |
| --- | --- | --- |
| Boarding | spam | You board your boat. |
| Recovery | game | Payment has been taken from your bank. |
| Recovery | npc say (Port Wizard) | Another recovery? This won't take long... |
| Recovery | dialogue (Junior Jim) | All done! The boat is now docked here at the Pandemonium. |
| Hull upgrade | message box | With the help of some workers, you swap out the hull of your boat. |
| Cargo hold | game | The cargo hold cannot store that item. |
| Cargo hold | game | You have no cargo to deposit. / You have no salvage to deposit. |
| Tools compartment | game | You collect your captain's log / a spyglass / some diving gear from the tools compartment. |

## Where tsps differs

- **Deck level:** people aboard stand on level 0 of the deck scene, not level 1. The tsps client already raises actors on a world entity by the deck height, so level 1 would lift them twice. Matching OSRS needs a client rendering change.
- **The HP-bar NPC** isn't placed: that needs NPC sync inside a boat's world view.
- **The boat's name varbits** (19149, 19150) aren't sent: their encoding is unknown.
- **The linen sail** isn't placed, because its live id is a fairy ring in revision 237.
- **The skiff and sloop spawn tile** (3075, 2987) is one tile east of the raft's. tsps only has the raft so far.
- **Cargo hold:**
  - `busy` isn't set while it's open, because plugins get no close hook to clear it.
  - Varbit 19134 isn't driven, so the loc's first op stays Open (no Deposit-held).
  - Guessed rather than captured:
    - the loc's "Deposit-all" (taken to mean everything storable);
    - the full-hold message ("Your cargo hold is full.");
    - a tool you haven't stored (nothing happens);
    - diving gear needing both parts to be stored.
  - The wiki's bounty items aren't listed, since no item name matched.
- **Boat selection and recovery:**
  - The bank isn't sent when interface 934 opens.
  - The Port Wizard's line is only shown overhead, not also in the chatbox.
  - Stored HP is always full, because boats don't take damage yet.
  - A boat sunk by a teleport, Escape or death sends "lost at sea" (253); capsizing (254) comes with boat damage. A boat at sea with its owner sends port 0.
  - Guessed rather than captured:
    - falling back to coins in the inventory ("Payment has been taken from your inventory.");
    - the message for not having enough coins.
  - None of the tool quests exist yet, so only the captain's log shows. The developer command `::sailingtools` sets the unlock varbits for your own client. The server doesn't check unlocks, so a hidden tool can still be deposited.

## Wanted captures

- Taking the helm, setting and trimming sails, steering and stopping.
- Teleporting from sea, Escape, and logging out and back in at sea.
- Disembarking at a dock gangplank.
- Buying a boat (Junior Jim's Buy-boat).
