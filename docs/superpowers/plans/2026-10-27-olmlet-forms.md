# Olmlet forms implementation plan

**Goal:** All eight cache241 Olmlet followers have their correct physical items, one ownership/recovery family, and one base collection entry. Preserve the existing dust unlock and legacy saved variants.

**Architecture:** Extend existing Pets metadata with a canonical family item ID. Keep its stable `item:20851` key so old unlocks/variant maps still load. Resolve legacy base-item variants only while their old base ownership record remains; newly recorded variant items summon their own form. Morph updates ownership immediately; physical item identity wins over a later family's saved preference. No core, generated data or client changes.

**Evidence:** Wiki Olmlet/Metamorphosis and 28 May2020 update establish the forms/unlock. Local pinned dump6e5033af and active cache establish items/follower NPCs/native actions; enum1711 is a menagerie mapping, not proof of the field interaction order. No indexed captures for olmpet/tekton_enraged_pet. Existing one-step native cycle is retained, inserting the two alternates beside their normal forms; exact official selection presentation/order remains unverified and is not claimed by this PR. No invented new interface/transcript.

**Constraints:** Own worktree only; no Claude/clues/Leagues/live edits. Follow docs/claude-pr-process.md and server/AGENTS.md. Separate ready PR after independent Codex review and checks. Stop own QA server/client/browser and clear own slot7 afterward.

## Tasks

- [ ] Add real cache/native tests for eight NPC/item pairs, dust gate, variant pickup/bank/withdraw/drop, collection/duplicate ownership, recovery and save/relog; watch failures on unchanged build.
- [ ] Update metadata and generic family/log resolution; preserve legacy key, explicit item identity and current recorded form. Test older saves and separately held duplicate base items.
- [ ] Build, run focused foundation and full suites; independently trace mutation, native operations and save paths. Give reviewer exact base/source fingerprints and require reviewer-chosen real adversarial transitions.
- [ ] Run actual rendering client/native controls for both new forms and pickup icons; retain evidence and limitations.
- [ ] Commit/push one ready PR with source/evidence/checks/limits in required layout. Attach it, release claim, stop helpers and clear reservation.

## Review focus

- An explicit physical form must survive real Bank transfer and another form's preference.
- Legacy base-item saves and `item:20851` dust unlock must still restore their old form.
- Alternate forms cannot become independent owned/reclaimable pets or extra log slots.
- Full inventory, another owner's click, death/trade state and repeated pickup cannot mint pets.
- #1417 active-follower persistence is independently pending; do not silently depend on or duplicate it. Verify integration if it merges during this work.
