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
| `yarn ensure-cache` | Downloads/validates the cache the above need. |

Typical flow for an interface:

1. Find the group/component name in RuneLite's generated `InterfaceID.java`.
2. Confirm it against this cache with `yarn dump:widget <groupId>`.
3. If a value renders oddly, `yarn dump:cs2` the listener to see what drives it.

**Prefer feeding the varps/varbits a cache script already reads over writing component text
that the same script will overwrite a tick later.**

Item/NPC/object constants are generated from the live cache - regenerate with
`scripts/generate-identifiers.ts` rather than hand-editing, and `scripts/audit-identifiers.ts`
checks the names still match the cache.
