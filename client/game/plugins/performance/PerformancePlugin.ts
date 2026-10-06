import { ConfigGroup, ConfigItem } from "@runelite/client/config/ConfigItem";
import { Plugin, type PluginDescriptor } from "@runelite/client/plugins/Plugin";
import { inject } from "@runelite/client/plugins/PluginInjector";

export const PerformanceConfig = ConfigGroup("performance", {
    maxFps: ConfigItem({
        name: "Max FPS",
        description: "Frames per second to draw at most. Lower keeps laptops cooler and steadier.",
        units: " fps",
        range: { min: 60, max: 240 },
        position: 1,
        default: 60,
    }),
    sceneScale: ConfigItem({
        name: "Scene resolution",
        description:
            "Draws the 3D scene at this share of the screen's resolution and scales it up. " +
            "The interface stays sharp. Lower is faster on weak graphics.",
        units: "%",
        range: { min: 50, max: 100 },
        position: 2,
        default: 75,
    }),
});

/**
 * Frame-rate cap and scene resolution scale for slower machines, as RuneLite's FPS Control and
 * GPU resolution scaling. The frame limiter and the scene framebuffer ask it each frame.
 */
export class PerformancePlugin extends Plugin {
    static descriptor: PluginDescriptor = {
        name: "Performance",
        description: "Caps the frame rate and lowers the 3D scene's resolution.",
        tags: ["fps", "resolution", "performance"],
        enabledByDefault: false,
        configKey: "performanceplugin",
    };

    static config = PerformanceConfig;

    private readonly config = inject(PerformanceConfig);

    /** The frame-rate cap, or 0 for none. */
    maxFps(): number {
        return this.isEnabled() ? Math.max(60, Math.min(240, this.config.maxFps() | 0)) : 0;
    }

    /** Desktop scene resolution as a fraction of the canvas (0.5–1). */
    sceneScale(): number {
        return this.isEnabled() ? Math.max(0.5, Math.min(1, this.config.sceneScale() / 100)) : 1;
    }
}
