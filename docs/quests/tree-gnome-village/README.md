---
quest: Tree Gnome Village
key: tree_gnome_village
status: passed
tested: 2026-10-23
tester: agent
model:
commit:
cache: osrs-241_2026-10-20
start: checkpoint
travel:
---

# Tree Gnome Village

Trackers, ballista, wall, tower and warlord fights were played naturally, ending in the real gnome chorus. Rewards paid once and persisted.

## Findings

- **fixed** Elkoy's guide landing, maze railing and the owned warlord encounter were corrected.

## Runs

### 2026-10-23 · agent · model not recorded

- **Source:** issue [#728](https://github.com/RSPSApp/tsps/issues/728) active (q117); moved here from its ledger on 2026-10-29. Proven against plugin hashes, not a commit, so a later plugin change is not flagged automatically.
- **Start:** checkpoint: fresh King Bolren start; earned checkpoints linked without reset.
- **Result:** varp 111 = 9; QP 0->2, Attack +11,450 XP, Gnome amulet.
- **Checked:** repeat dialogue, relog, logout/offline.
- **Not checked:** HP1 aids after real damage; Recovery, optional branches, ceremony camera/timing and overlay unchecked; Initial varp 111 = 0 inferred.
- **PRs:** [#1182](https://github.com/RSPSApp/tsps/pull/1182).
