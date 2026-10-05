import type {
    AttackTimerPluginConfig,
    AttackTimerPluginPersistence,
    AttackTimerPluginState,
} from "./types";

type AttackTimerPluginListener = () => void;

const DEFAULT_CONFIG: AttackTimerPluginConfig = Object.freeze({
    enabled: true,
});

/** Shows the ticks until the local player's next attack over their head (attackTimerState). */
export class AttackTimerPlugin {
    private readonly listeners = new Set<AttackTimerPluginListener>();
    private readonly persistence?: AttackTimerPluginPersistence;
    private config: AttackTimerPluginConfig;
    private state: AttackTimerPluginState;
    private version = 0;

    constructor(persistence?: AttackTimerPluginPersistence) {
        this.persistence = persistence;
        this.config = { enabled: persistence?.load()?.enabled ?? DEFAULT_CONFIG.enabled };
        this.state = { config: this.config, version: this.version };
    }

    subscribe(listener: AttackTimerPluginListener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    getState(): AttackTimerPluginState {
        return this.state;
    }

    isEnabled(): boolean {
        return this.config.enabled;
    }

    setConfig(nextConfig: Partial<AttackTimerPluginConfig>): void {
        this.config = { enabled: nextConfig.enabled ?? this.config.enabled };
        this.version++;
        this.state = { config: this.config, version: this.version };
        this.persistence?.save(this.config);
        for (const listener of this.listeners) listener();
    }
}
