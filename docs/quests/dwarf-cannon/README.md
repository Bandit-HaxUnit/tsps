---
quest: Dwarf Cannon
key: dwarf_cannon
status: in-progress
tested:
tester: agent
model:
commit:
cache: osrs-241_2026-10-20
start:
travel:
---

# Dwarf Cannon

Only bounded native checks of the helper and Nulodion purchase; no full route.

## Findings

- **fixed** Helper recovery fix merged after bounded native checks. [#1246](https://github.com/RSPSApp/tsps/pull/1246)

## Runs

### date not recorded · agent · model not recorded

- **Source:** issue [#728](https://github.com/RSPSApp/tsps/issues/728) active (q027); moved here from its ledger on 2026-10-29. Proven against plugin hashes, not a commit, so a later plugin change is not flagged automatically.
- **Checked:** helper replay, legacy saved-stage repair, Nulodion purchase and relog (bounded).
- **Not checked:** Not a full natural route or current-source reward proof.
- **PRs:** [#1114](https://github.com/RSPSApp/tsps/pull/1114), [#1246](https://github.com/RSPSApp/tsps/pull/1246).
