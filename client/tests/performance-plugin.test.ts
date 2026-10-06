import assert from "node:assert/strict";

import { ConfigManager } from "../runelite/client/config/ConfigManager";
import { inject } from "../runelite/client/plugins/PluginInjector";
import { PerformanceConfig, PerformancePlugin } from "../game/plugins/performance/PerformancePlugin";

const plugin = new PerformancePlugin();
const config = inject(ConfigManager);

// Off by default: no frame cap and a full-resolution scene.
assert.equal(plugin.maxFps(), 0);
assert.equal(plugin.sceneScale(), 1);

plugin.setEnabledState(true);
assert.equal(plugin.maxFps(), 60);
assert.equal(plugin.sceneScale(), 0.75);

// Out-of-range stored values are clamped to the slider's range.
config.setConfigValue(PerformanceConfig, "maxFps", 20);
config.setConfigValue(PerformanceConfig, "sceneScale", 10);
assert.equal(plugin.maxFps(), 60);
assert.equal(plugin.sceneScale(), 0.5);
config.setConfigValue(PerformanceConfig, "maxFps", 500);
config.setConfigValue(PerformanceConfig, "sceneScale", 150);
assert.equal(plugin.maxFps(), 240);
assert.equal(plugin.sceneScale(), 1);

console.log("Performance plugin: off by default, clamps its frame cap and scene scale");
