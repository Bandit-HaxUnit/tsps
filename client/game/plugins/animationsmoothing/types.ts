export interface AnimationSmoothingPluginConfig {
    enabled: boolean;
}

export interface AnimationSmoothingPluginState {
    config: AnimationSmoothingPluginConfig;
    version: number;
}

export interface AnimationSmoothingPluginPersistence {
    load(): Partial<AnimationSmoothingPluginConfig> | undefined;
    save(config: AnimationSmoothingPluginConfig): void;
}
