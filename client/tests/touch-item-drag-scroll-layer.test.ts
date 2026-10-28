import assert from "node:assert/strict";

import { isInTouchScrollLayer } from "../game/widgets/input/widgetTouchScrollInput";

// A bank-like list: a layer wired to scrollbar_vertical (wheel script 36) with more to show.
const bankItems = { uid: 1, type: 0, height: 100, scrollHeight: 400, parentUid: -1, onScroll: [36, 2, 1, 32] };
const bankItem = { uid: 3, type: 5, itemId: 995, parentUid: 1 };
// The LMS loadout grid (br_loadout:ainventory): a plain layer, nothing to scroll.
const loadout = { uid: 10, type: 0, height: 200, scrollHeight: 0, parentUid: -1 };
const loadoutItem = { uid: 11, type: 5, itemId: 385, parentUid: 10 };

const widgets = new Map<number, any>([bankItems, bankItem, loadout, loadoutItem].map((w) => [w.uid, w]));
const widgetManager = { getWidgetByUid: (uid: number) => widgets.get(uid) } as any;

assert.equal(isInTouchScrollLayer(bankItem, widgetManager), true, "bank items keep swipe scrolling");
assert.equal(isInTouchScrollLayer(loadoutItem, widgetManager), false, "loadout items drag");

// A list with everything already in view does not take the swipe.
bankItems.scrollHeight = 50;
assert.equal(isInTouchScrollLayer(bankItem, widgetManager), false, "nothing to scroll: drag");

console.log("Touch item drag scroll layer test passed");
