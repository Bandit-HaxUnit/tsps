import assert from "node:assert/strict";

import { CLIENT_TYPE_ANDROID, CLIENT_TYPE_ENHANCED, reportedClientType } from "../rs/cs2/ClientType";
import { WidgetsOverlay } from "../ui/devoverlay/WidgetsOverlay";

/**
 * As the enhanced client (clienttype 10) the game draws the top-left mouseover text itself
 * (cache script 4726, with varbit 12377 on), so the client's own text stays hidden: drawing
 * both showed it twice.
 */
assert.equal(reportedClientType(161), CLIENT_TYPE_ENHANCED, "the desktop layout is the enhanced client");
assert.equal(reportedClientType(601), CLIENT_TYPE_ANDROID, "the mobile layout is android");

const client: any = {
    showMouseOverText: true,
    menuOpen: false,
    widgetManager: { rootInterface: 161 },
    varManager: { getVarbit: () => 1 },
    menuActiveSimpleEntries: [{ option: "Walk here", target: "" }],
};
const overlay: any = Object.create(WidgetsOverlay.prototype);
Object.assign(overlay, {
    ctx: { getGameContext: () => ({ osrsClient: client }) },
    glRenderer: { width: 800, height: 600 },
    app: { width: 800 },
    overlayScaleX: 1,
    overlayScaleY: 1,
    getOverlayTextScale: () => ({ x: 1, y: 1 }),
});
assert.deepEqual(overlay.getMouseOverTextVisualState(false), { signature: "hidden" }, "the game's text is the only one");

// Other client types still get the client's own text.
client.widgetManager.rootInterface = 601;
assert.equal(overlay.getMouseOverTextVisualState(false).text, "Walk here");

console.log("mouseover text (enhanced client): ok");
