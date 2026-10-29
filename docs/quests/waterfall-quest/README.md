---
quest: Waterfall Quest
key: waterfall_quest
status: in-progress
tested:
tester: agent
model:
commit:
cache: osrs-241_2026-10-20
start:
travel:
---

# Waterfall Quest

Raft, rope crossing and dead-tree ledge route reached the waterfall door, which refused entry without the amulet. Supplemental route evidence only.

## Findings

- **open** Upstairs bookcase/book-read step regression and native review. https://github.com/RSPSApp/tsps/issues/1262

## Runs

### date not recorded · agent · model not recorded

- **Source:** issue [#728](https://github.com/RSPSApp/tsps/issues/728) supplemental (q131); moved here from its ledger on 2026-10-29. Proven against plugin hashes, not a commit, so a later plugin change is not flagged automatically.
- **Result:** varp 65 = 2 (route); 2 -> 3 in bounded bookcase check.
- **Checked:** River Swim downstream with no state change, relog, bookcase full-bag refusal/retry and lost-book recovery (bounded).
- **Not checked:** No cave entry, completion or reward claim; Bookcase check used developer-arranged stage, position and inventory.
- **PRs:** [#1187](https://github.com/RSPSApp/tsps/pull/1187).
