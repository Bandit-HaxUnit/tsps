import assert from "node:assert/strict";

import { loadGameframePaneRedirect } from "../game/widgets/gameframePanes";
import { ClientScriptLoader } from "../game/cs2/ClientScriptLoader";
import { GAMEFRAME_LAYOUT_ENUM, GAMEFRAME_317_LABEL, GAMEFRAME_317_FIXED_LABEL, VARP_GAMEFRAME_317 } from "../common/ui/gameframeLayout";
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

console.log("gameframe pane and layout dropdown tests passed");
