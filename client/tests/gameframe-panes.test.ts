import assert from "node:assert/strict";

import { loadGameframePaneRedirect } from "../game/widgets/gameframePanes";
import { ClientScriptLoader } from "../game/cs2/ClientScriptLoader";
import { GAMEFRAME_LAYOUT_ENUM, GAMEFRAME_317_LABEL, GAMEFRAME_317_FIXED_LABEL, VARP_GAMEFRAME_317 } from "../common/ui/gameframeLayout";
import { GameFrame317Plugin } from "../game/plugins/gameframe317/GameFrame317Plugin";
import { CacheSystem } from "../rs/cache/CacheSystem";
import { Dat2CacheLoaderFactory } from "../rs/cache/loader/Dat2CacheLoaderFactory";
import { VarManager } from "../rs/config/vartype/VarManager";
import { Cs2Vm } from "../rs/cs2/Cs2Vm";
import { Opcodes } from "../rs/cs2/Opcodes";
import { Script } from "../rs/cs2/Script";
import { loadCache, loadCacheInfos, loadCacheList } from "../scripts/cache/load-util";

const cacheInfo = loadCacheList(loadCacheInfos()).latest;
const cache = CacheSystem.fromFiles(cacheInfo, loadCache(cacheInfo).files);
const loaders = new Dat2CacheLoaderFactory(cacheInfo, "dat2", cache);
const enumLoader = loaders.getEnumTypeLoader();

assert.ok(enumLoader, "cache exposes an enum loader");

const modern = loadGameframePaneRedirect(enumLoader, 161);
assert.ok(modern, "stretch layout has a redirect");
assert.equal(modern.get(87), 87, "stretch is the identity mapping");

const fixed = loadGameframePaneRedirect(enumLoader, 548);
assert.ok(fixed, "fixed layout has a redirect");
assert.equal(fixed.get(87), 92, "settings side panel");
assert.equal(fixed.get(79), 84, "inventory side panel");
assert.equal(fixed.get(82), 87, "magic side panel");
assert.equal(fixed.get(96), 11, "chatbox");
assert.equal(fixed.get(61), 66, "quest tab icon");
assert.equal(fixed.get(7), -1, "components without a fixed slot map to -1");
assert.equal(fixed.has(22), false, "components absent from the fixed pane are unmapped");

const classic = loadGameframePaneRedirect(enumLoader, 164);
assert.ok(classic, "classic layout has a redirect");
assert.equal(classic.get(16), 16, "modal");
assert.equal(classic.get(96), 93, "chatbox");
assert.equal(classic.get(61), 54, "quest tab icon");
assert.equal(classic.get(89), 86, "music side panel");

assert.equal(loadGameframePaneRedirect(enumLoader, 601), undefined, "unknown roots have no redirect");

// Exercise the real cache's settings getter and the extended enum through CS2.
const scripts = new ClientScriptLoader({ getCacheSystem: () => cache });
const vars = new VarManager(loaders.getVarBitTypeLoader());
const widgets = { rootInterface: 161, beginBatch() {}, endBatch() {}, flushBatch() {} };
const vm = new Cs2Vm({
    loadScript: (id: number) => scripts.load(id),
    enumTypeLoader: enumLoader,
    varManager: vars,
    widgetManager: widgets,
    windowMode: 2,
} as any);

function run(ops: number[][]): void {
    const script = new Script();
    script.instructions = Int32Array.from([...ops.map(([op]) => op), Opcodes.RETURN]);
    script.intOperands = Int32Array.from([...ops.map(([, arg]) => arg ?? 0), 0]);
    vm.execute(script);
}

for (let i = 0; i < 2; i++) {
    run([[Opcodes.ICONST, GAMEFRAME_LAYOUT_ENUM], [Opcodes.ENUM_GETOUTPUTCOUNT]]);
    assert.equal(vm.intStack[0], 5, "Add the 317 options only once");
}
run([[Opcodes.ICONST, GAMEFRAME_LAYOUT_ENUM], [Opcodes.ICONST, 3], [Opcodes.ENUM_STRING]]);
assert.equal(vm.stringStack[0], GAMEFRAME_317_LABEL);
run([...[105, 115, GAMEFRAME_LAYOUT_ENUM, 3].map(value => [Opcodes.ICONST, value]), [Opcodes.ENUM]]);
assert.equal(vm.stringStack[0], GAMEFRAME_317_LABEL);
run([[Opcodes.ICONST, GAMEFRAME_LAYOUT_ENUM], [Opcodes.ICONST, 4], [Opcodes.ENUM_STRING]]);
assert.equal(vm.stringStack[0], GAMEFRAME_317_FIXED_LABEL);
assert.deepEqual(enumLoader.load(GAMEFRAME_LAYOUT_ENUM).stringValues, [
    "Fixed - Classic layout", "Resizable - Classic layout", "Resizable - Modern layout", GAMEFRAME_317_LABEL, GAMEFRAME_317_FIXED_LABEL,
]);

for (const [root, stone, frame317, expected] of [
    [548, 1, 0, 0], [164, 0, 0, 1], [161, 1, 0, 2], [161, 1, 1, 3], [548, 1, 1, 4], [548, 1, 0, 0], [161, 1, 0, 2],
]) {
    widgets.rootInterface = root;
    vars.setVarbit(4607, stone);
    vars.setVarp(VARP_GAMEFRAME_317, frame317);
    run([[Opcodes.ICONST, 12], [Opcodes.INVOKE, 3962]]);
    assert.equal(vm.intStackSize, 1, "Layout getter must preserve the stack contract");
    assert.equal(vm.intStack[0], expected);
}
vars.setVarp(VARP_GAMEFRAME_317, 1);
vars.setVarp(1107, 42);
run([[Opcodes.ICONST, 55], [Opcodes.INVOKE, 3962]]);
assert.equal(vm.intStack[0], 42, "Other settings still use the cache getter with 317 enabled");

// Render calls and tab hits share the widget transform, without needing WebGL.
(GameFrame317Plugin.prototype as any).loadAssets = async () => {};
const fixedWidgets = new Map([
    [17, { rawX: 547 }], [9, { rawX: 516 }], [11, { rawWidth: 519 }],
]);
const actions: any[] = [];
const reportStone = { spriteId: 3057 };
const frameWidgets = {
    ...widgets,
    rootInterface: 548,
    getWidgetByUid: (uid: number) => uid === ((162 << 16) | 32) ? reportStone : fixedWidgets.get(uid & 0xffff),
    invalidateWidget() {},
};
const plugin = new GameFrame317Plugin({
    widgetManager: frameWidgets, varManager: vars, camera: { yaw: 0 },
    handleWidgetAction: (action: any) => actions.push(action),
});
const internals = plugin as any;
internals.ready = true;
for (const name of ["backtop1", "invback", "mapback", "chat_section", "chat_selected", "chat_hover", "chat_selected_hover", "redstone3", "osrs_clan", "osrs_account", "osrs_friends"]) {
    internals.textures.set(name, { name, tex: {}, w: 30, h: 30 });
}
const draws: any[] = [];
const hits: any[] = [];
const tabs: number[] = [];
const context = {
    renderer: {
        drawTexture: (...args: any[]) => draws.push(args),
        drawTextureQuads: (...args: any[]) => draws.push(args),
        drawRect: (...args: any[]) => draws.push([{ name: "chatBacking" }, ...args]),
    },
    renderScaleX: 2, renderScaleY: 2, renderOffsetX: 10, renderOffsetY: 20,
    anchors: {}, clicks: { register: (hit: any) => hits.push(hit) },
    switchTab: (tab: number) => tabs.push(tab),
};
vars.setVarcInt(171, 3);
vars.setVarcInt(41, 0);
vars.setVarcInt(42, -1);
assert.equal(plugin.gameFrame.isGameFrameActive(), true);
plugin.updateWidgetLayout();
assert.deepEqual([...fixedWidgets.values()], [{ rawX: 553 }, { rawX: 521 }, { rawWidth: 519 }]);
plugin.gameFrame.drawGameFrame(context as any);
assert.deepEqual(draws.find(([t]) => t.name === "invback").slice(1, 3), [1116, 430]);
const chatDraws = draws.filter(([t]) => t.name.startsWith("chat_"));
assert.equal(chatDraws.length, 9, "Draw parchment and eight individually styled stones");
assert.deepEqual(Array.from(chatDraws[0][1]).filter((_, i) => i % 4 < 2), [
    10, 696, 1048, 696, 1048, 970, 10, 970,
], "Fixed parchment keeps its original bounds at DPR 2");
assert.deepEqual(chatDraws.slice(1).map(([t]) => t.name), Array(8).fill("chat_section"));
assert.equal(chatDraws[1][1][0], 10);
assert.equal(chatDraws[8][1][8], 1048);
for (const [, quad, count] of chatDraws.slice(1)) {
    assert.equal(count, 1);
    assert.equal(quad[1], 970);
    assert.equal(quad[9], 1026, "Stones retain their 28px height and fixed bottom edge");
    assert.ok(Math.abs(quad[3] - 600 / 725) < 0.000001);
    assert.ok(Math.abs(quad[11] - 705 / 725) < 0.000001, "Trim blank padding below the stones");
}
const backingIndex = draws.findIndex(([t]) => t.name === "chatBacking");
assert.deepEqual(draws[backingIndex].slice(1), [10, 696, 1038, 330, [0, 0, 0, 1]],
    "Opaque backing prevents old chat borders bleeding through the translucent PNG");
assert.equal(draws[backingIndex + 1][0].name, "chat_section");
assert.deepEqual(draws.find(([t]) => t.name === "redstone3").slice(1, 3), [1262, 356]);
assert.equal(draws.filter(([t]) => t.name.startsWith("osrs_")).length, 3);
assert.equal(hits.length, 14);
assert.deepEqual(hits[0].rect, { x: 1096, y: 362, w: 68, h: 68 });
for (const hit of hits) hit.onClick();
assert.deepEqual(tabs, Array.from({ length: 14 }, (_, i) => i));
assert.equal(plugin.gameFrame.widgetRules!().find(rule => rule.contentType === 1339)?.hide, true);
vars.setVarp(VARP_GAMEFRAME_317, 0);
plugin.updateWidgetLayout();
assert.deepEqual([...fixedWidgets.values()], [{ rawX: 547 }, { rawX: 516 }, { rawWidth: 519 }]);
assert.equal(plugin.gameFrame.isGameFrameActive(), false);
frameWidgets.rootInterface = 161;
vars.setVarp(VARP_GAMEFRAME_317, 1);
assert.equal(plugin.gameFrame.isGameFrameActive(), true);
assert.equal(plugin.gameFrame.widgetRules!().find(rule => rule.contentType === 1339)?.hide, false);
draws.length = hits.length = 0;
plugin.gameFrame.drawGameFrame({ ...context, anchors: {
    tabContent: { x: 900, y: 300, width: 190, height: 261 },
    chat: { x: 0, y: 500, width: 519, height: 130 },
} } as any);
assert.equal(draws.some(([t]) => t.name === "backtop1"), false, "Resizable keeps its composite frame");
assert.equal(draws.some(([t]) => t.name === "chatBacking"), false, "Resizable keeps its existing transparency");
assert.deepEqual(draws.find(([t]) => t.name === "redstone3").slice(1, 3), [1956, 546]);
assert.equal(hits.length, 14);
assert.equal(plugin.handleClientCommand("317"), true);
assert.equal(plugin.handleClientCommand("osrs"), true);
assert.deepEqual(actions.map(action => action.slot), [4, 3]);

console.log("gameframe pane and layout dropdown tests passed");
