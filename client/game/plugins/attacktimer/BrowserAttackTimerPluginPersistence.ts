import type { AttackTimerPluginConfig, AttackTimerPluginPersistence } from "./types";

export function createBrowserAttackTimerPluginPersistence(
    storageKey: string,
): AttackTimerPluginPersistence | undefined {
    if (typeof window === "undefined" || typeof window.localStorage === "undefined") {
        return undefined;
    }

    return {
        load: (): Partial<AttackTimerPluginConfig> | undefined => {
            try {
                const raw = window.localStorage.getItem(storageKey);
                return raw ? (JSON.parse(raw) as Partial<AttackTimerPluginConfig>) : undefined;
            } catch {
                return undefined;
            }
        },
        save: (config: AttackTimerPluginConfig): void => {
            try {
                window.localStorage.setItem(storageKey, JSON.stringify(config));
            } catch {}
        },
    };
}
