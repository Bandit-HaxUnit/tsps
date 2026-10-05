export interface AttackTimerPluginConfig {
    enabled: boolean;
}

export interface AttackTimerPluginState {
    config: AttackTimerPluginConfig;
    version: number;
}

export interface AttackTimerPluginPersistence {
    load(): Partial<AttackTimerPluginConfig> | undefined;
    save(config: AttackTimerPluginConfig): void;
}
