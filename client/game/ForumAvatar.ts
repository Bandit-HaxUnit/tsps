import type { OsrsClient } from "./OsrsClient";
import { PlayerChatheadFactory } from "../render/PlayerChatheadFactory";
import { PlayerAppearance } from "../rs/config/player/PlayerAppearance";
import { Model2DRenderer } from "../ui/model/Model2DRenderer";

/** Best-effort avatar capture after World 1 approves logout, without delaying logout. */
export async function uploadForumAvatar(client: OsrsClient, serverUrl: string): Promise<void> {
    if (window.location.origin !== "https://rsps.app" || serverUrl !== "wss://worlds.rsps.app/game") return;
    const index = client.playerEcs.getIndexForServerId(client.controlledPlayerServerId);
    const source = index === undefined ? undefined : client.playerEcs.getAppearance(index);
    if (!source) return;
    // Logout clears the ECS immediately; keep the appearance worn at that instant.
    const appearance = new PlayerAppearance(source.gender, [...source.colors], [...source.kits], [...source.equip]);

    const response = await fetch("/api/rsps/session", { credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(5000) });
    if (!response.ok) return;
    const session = await response.json();
    if (!session.authenticated || session.hasAvatar) return;

    const factory = new PlayerChatheadFactory(client.modelLoader, client.textureLoader, client.idkTypeLoader, client.objTypeLoader);
    let model = factory.get(appearance);
    // Chat-head models stream separately from wearable models. Never upload a partial head.
    for (let attempt = 0; !model && attempt < 30; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        model = factory.get(appearance);
    }
    if (!model) return;
    const renderer = new Model2DRenderer(client.objTypeLoader, client.modelLoader, client.textureLoader);
    const portrait = renderer.renderModelInstanceToCanvasExtents(model, { xan2d: 128, yan2d: 128, zoom2d: 600, orthographic: true });
    if (!portrait || portrait.canvas.width < 2 || portrait.canvas.height < 2) return;

    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const scale = 112 / Math.max(portrait.canvas.width, portrait.canvas.height);
    const width = portrait.canvas.width * scale;
    const height = portrait.canvas.height * scale;
    ctx.drawImage(portrait.canvas, (128 - width) / 2, (128 - height) / 2, width, height);
    const image = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!image) return;
    const body = new FormData();
    body.append("avatar", image, "chat-head.png");
    const uploaded = await fetch("/api/rsps/avatar", {
        method: "POST", credentials: "same-origin", headers: { "X-CSRF-Token": session.csrfToken },
        body, signal: AbortSignal.timeout(5000),
    });
    if (!uploaded.ok) throw new Error(`Forum avatar upload failed (${uploaded.status})`);
}
