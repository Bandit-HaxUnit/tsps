# Finding ids in the cache

Interface, sprite, enum, clientscript, animation and gfx ids come from the cache in
`server/caches`, never from guesswork or stale RSPS constants. The dump scripts exist so you
do not have to guess - each one documents its own output in its file header:

| Command | What it answers |
| --- | --- |
| `yarn dump:widget <groupId>` | Every component in an interface group: type, parent, sprite, text, and the CS2 listeners attached to it. |
| `yarn dump:cs2 <scriptId>` | Disassembles a clientscript - which varp/varbit renders a value, and whether a script will overwrite text the server sends. |
| `yarn dump:enum <enumId>` | A cache enum's key -> value pairs, for the lookup tables the client's own scripts read. |
| `yarn dump:seq [<seqId...>]` | Animation sequences: frame count/ids, priority and loop count - what an attack animation lookup needs. |
| `yarn dump:spotanim [<spotanimId...>]` | Graphics (spotanim) configs: the model and sequence each gfx plays. |
| `yarn dump:item-combat-styles` | Refreshes `data/definitions/item-combat-styles.json` from cache dbtable 78, preserving server-owned fields. |
| `yarn remap:components <cache dir>` | Every interface component whose id differs in another cache revision, matched by gameval name, and the literal `(group << 16) \| component` ids in our code that would point elsewhere. Read-only. |
| `yarn ensure-cache` | Downloads/validates the cache the above need. |

Typical flow for an interface:

1. Find the group/component name: the cache's own gamevals name them (`chatbox:chatmodal`),
   which is what rsprox prints in captures; RuneLite's generated `InterfaceID.java` too.
2. Confirm it against this cache with `yarn dump:widget <groupId>`.
3. If a value renders oddly, `yarn dump:cs2` the listener to see what drives it.

**Prefer feeding the varps/varbits a cache script already reads over writing component text
that the same script will overwrite a tick later.**

Item/NPC/object constants are generated from the live cache - regenerate with
`scripts/generate-identifiers.ts` rather than hand-editing (run `--dry-run` first: it reports
added/changed/removed names and keeps existing names stable), and `scripts/audit-identifiers.ts`
checks the names still match the cache.

## Gamevals

The OSRS cache carries Jagex's own names for its ids in index 24 (one archive per kind: objs,
npcs, locs, seqs, spotanims, varps, varbits, dbrows, and interfaces with their components).
`game/cache/Gamevals.ts` reads them: `componentName(uid)` / `componentId("chatbox:chatmodal")`
and `namesOf(GamevalKind.SEQ)`. They are the names rsprox prints (`human_reachforladder`,
`slayertower_door`), so a capture maps straight onto ids.

## Updating the cache revision

`target.txt` names the cache. Before moving to a newer one:

- Config and clientscript opcode meanings for the new revision: https://github.com/zwyz/osrs-cache
  (`data/commands/*.txt` for every CS2 command with its signature,
  `src/main/java/osrs/unpack/config/*Unpacker.java` for config opcodes).
- What changed in the client per revision: rsprot's `WHATSNEW.md` (https://github.com/blurite/rsprot).
- `yarn remap:components <new cache dir>` for interface components that moved.
- `scripts/generate-identifiers.ts --dry-run` for item/NPC/object names that moved or vanished.
- Worktrees share `server/caches` through a symlink and `ensure-cache` rewrites `caches.json`
  for every one of them: try a new revision in a worktree with its own `server/caches`.
