# Native Seed Vault

The Farming Guild Seed Vault opens the cache's storage modal 631 with side panel 630. It uses the existing saved farm.vault balances and shared Bank PIN guard.

## Evidence

- Normal RSProx 232/03150 and 238/04222 show inventory 626 before the modal pair, native quantity operations, favourites, placeholders and reordering.
- Cache 241 supplies current component names, scripts 2811–2834, inventory 626, capacity 104, seed-category objparam 709 and contract objparam 895. Script 7784 and group 906 provide the newer deposit-slot lock editor; no recording of that editor was used.
- Wiki Seed vault and Bank PIN provide storage eligibility and the PIN requirement.

## Behaviour

The PIN guard runs before creating or revealing storage. Native deposits and withdrawals recheck the owned modal pair, exact canonical farm state, location, life/status and PIN. Deposit plans operate on a complete slot-by-slot inventory clone and commit once; notes normalize to eligible seeds/saplings and metadata-bearing copies are left untouched. Full inventories and stack caps allow only safe amounts.

Saved order, holes/placeholders, eight favourites, chosen/custom quantity and deposit-slot locks supplement the existing balance map. Native dragging validates both current items. Zero cancels amount input; close, replacement, movement, trade, death, logout or a new PIN challenge prevents stale callbacks. PIN resume opens a fresh screen rather than replaying a transfer.

Search is implemented by the cache's own local text/filter script. Canonical Guild contracts feed the native type/completion bits on synchronization. Category 12 is sent on open, matching the observed normal opens; that is a documented change from the plan's initial category-persistence assumption. The recordings do not establish every reopen after changing category. Quantities, favourites and balances still persist.

The native lock editor mounts as a child popup without replacing the Vault session. Its 28-slot mask protects Deposit-all; explicit per-slot deposits remain available, following the cache's visible operations. Ignore-lock and right-click lock options persist in Farming settings and resend the shared native bits while the Vault is open.

## Verification

Eighteen tests use real Player, Inventory, ClientConnection, PacketSender and the map's actual Seed Vault, with all plugins loaded. They exercise PIN, exact-slot atomicity, notes, saplings in the last slot, metadata, caps, quantities, zero/stale prompts, saved-state reload, favourites, placeholders, drag and lock controls. The contract regression calls real Guild assignment/completion, but captures Patches.choose and invokes Jane's callback directly; Vault category clicks themselves are native input.

Legacy Vault menu assertions in the shared Bank PIN test are replaced with native keypad/transfer regressions, preserving wrong-PIN, no-state-before-unlock and remote-resume refusal. The remaining PIN and Leprechaun tests stay in their existing suite.

Independent Codex review identified the missing canonical contract bits; fixed, tested and re-reviewed clear. Native MCP opened 631+630, deposited 12 potato seeds, withdrew 1, opened 906 on 631:4 and set slot-mask bit 0. The test server saved and stopped gracefully. Client cache sweeps 630/631/906 report no VM errors, zero item ids or null text. Final full-suite counts are in the PR.

Final full suite: 8,208/8,208 passed, no failures or skips. All51 assignable Guild crop keys also resolve a valid native contract parameter.
