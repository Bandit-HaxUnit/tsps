import type {
    AnimationSmoothingPluginConfig,
    AnimationSmoothingPluginPersistence,
    AnimationSmoothingPluginState,
} from "./types";

type AnimationSmoothingPluginListener = () => void;

const DEFAULT_CONFIG: AnimationSmoothingPluginConfig = Object.freeze({
    enabled: false,
});

/** Player poses that break when blended. */
const EXCLUDED_PLAYER_SEQUENCES = new Set([244]);
/** NPC animations that break when blended (hellhound defence and others). */
const EXCLUDED_NPC_SEQUENCES = new Set([6566, 8270, 8271, 5583]);
/** NPCs whose idle poses break when blended: the wyrm and the tree spirits. */
const EXCLUDED_NPC_IDLES = new Set([8610, 1163, 6380, 6319]);

/**
 * Animation smoothing, as in RuneLite: keyframe animations of players and NPCs are blended
 * toward their next frame by how far into the current frame they are, instead of jumping from
 * frame to frame. The renderers ask smoothsPlayer/smoothsNpc per animation.
 */
export class AnimationSmoothingPlugin {
    private readonly listeners = new Set<AnimationSmoothingPluginListener>();
    private readonly persistence?: AnimationSmoothingPluginPersistence;
    private config: AnimationSmoothingPluginConfig;
    private state: AnimationSmoothingPluginState;
    private version = 0;

    constructor(persistence?: AnimationSmoothingPluginPersistence) {
        this.persistence = persistence;
        this.config = { enabled: persistence?.load()?.enabled ?? DEFAULT_CONFIG.enabled };
        this.state = { config: this.config, version: this.version };
    }

    subscribe(listener: AnimationSmoothingPluginListener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    getState(): AnimationSmoothingPluginState {
        return this.state;
    }

    isEnabled(): boolean {
        return this.config.enabled;
    }

    setConfig(nextConfig: Partial<AnimationSmoothingPluginConfig>): void {
        this.config = { enabled: nextConfig.enabled ?? this.config.enabled };
        this.version++;
        this.state = { config: this.config, version: this.version };
        this.persistence?.save(this.config);
        for (const listener of this.listeners) listener();
    }

    /** Whether a player's animation (action or movement) is blended. */
    smoothsPlayer(seqId: number): boolean {
        return this.config.enabled && !EXCLUDED_PLAYER_SEQUENCES.has(seqId);
    }

    /** Whether graphics (spotanims on actors and the ground, and projectiles) are blended. */
    smoothsGraphics(): boolean {
        return this.config.enabled;
    }

    /** Whether an NPC's animation is blended; `action` is false for its movement/idle pose. */
    smoothsNpc(npcTypeId: number, seqId: number, action: boolean): boolean {
        if (!this.config.enabled || EXCLUDED_NPC_SEQUENCES.has(seqId)) return false;
        return action || !EXCLUDED_NPC_IDLES.has(npcTypeId);
    }
}
