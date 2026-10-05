import type { AnimationSmoothingPluginConfig, AnimationSmoothingPluginPersistence } from "./types";

export function createBrowserAnimationSmoothingPluginPersistence(
    storageKey: string,
): AnimationSmoothingPluginPersistence | undefined {
    if (typeof window === "undefined" || typeof window.localStorage === "undefined") {
        return undefined;
    }

    return {
        load: (): Partial<AnimationSmoothingPluginConfig> | undefined => {
            try {
                const raw = window.localStorage.getItem(storageKey);
                return raw
                    ? (JSON.parse(raw) as Partial<AnimationSmoothingPluginConfig>)
                    : undefined;
            } catch {
                return undefined;
            }
        },
        save: (config: AnimationSmoothingPluginConfig): void => {
            try {
                window.localStorage.setItem(storageKey, JSON.stringify(config));
            } catch {}
        },
    };
}
