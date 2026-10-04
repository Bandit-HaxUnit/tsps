import assert from "node:assert/strict";
import { uploadForumAvatar } from "../game/ForumAvatar";
import { PlayerChatheadFactory } from "../render/PlayerChatheadFactory";
import { PlayerAppearance, Gender } from "../rs/config/player/PlayerAppearance";
import { Model2DRenderer } from "../ui/model/Model2DRenderer";

async function main(): Promise<void> {
    (globalThis as any).location = { origin: "https://rsps.app" };
    (globalThis as any).window = { location: (globalThis as any).location };
    const source = new PlayerAppearance(Gender.FEMALE, [1, 2, 3, 4, 5], [10, 11, 12, 13, 14, 15, 16], [1163]);
    const client: any = { controlledPlayerServerId: 42,
        playerEcs: { getIndexForServerId: () => 0, getAppearance: () => source },
        modelLoader: {}, textureLoader: {}, idkTypeLoader: {}, objTypeLoader: {},
    };
    let session = { authenticated: true, hasAvatar: false, csrfToken: "forum-csrf" };
    const requests: { url: string; options?: RequestInit }[] = [];
    let captured: PlayerAppearance | undefined;
    let draws: number[][] = [];
    let missingModel = false;
    const originalGet = PlayerChatheadFactory.prototype.get;
    const originalRender = Model2DRenderer.prototype.renderModelInstanceToCanvasExtents;
    PlayerChatheadFactory.prototype.get = function (appearance) {
        captured = appearance;
        return missingModel ? undefined : {} as any;
    };
    Model2DRenderer.prototype.renderModelInstanceToCanvasExtents = () => ({ canvas: { width: 80, height: 100 } as any, offsetX: 0, offsetY: 0 });
    (globalThis as any).document = { createElement: () => ({
        width: 0, height: 0,
        getContext: () => ({ drawImage: (_image: unknown, ...bounds: number[]) => draws.push(bounds) }),
        toBlob: (cb: (image: Blob) => void) => cb(new Blob(["png"], { type: "image/png" })),
    }) };
    globalThis.fetch = async (url, options) => {
        requests.push({ url: String(url), options });
        return new Response(JSON.stringify(String(url).endsWith("/session") ? session : { updated: true }));
    };
    const clear = () => { requests.length = 0; captured = undefined; draws = []; };
    try {
        await uploadForumAvatar(client, "wss://other.example/game");
        assert.equal(requests.length, 0, "other worlds must not set a forum avatar");
        (globalThis as any).location.origin = "https://another.example";
        await uploadForumAvatar(client, "wss://worlds.rsps.app/game");
        assert.equal(requests.length, 0, "only the same-origin official client uses the forum session");
        (globalThis as any).location.origin = "https://rsps.app";
        session.authenticated = false;
        await uploadForumAvatar(client, "wss://worlds.rsps.app/game");
        assert.equal(requests.length, 1); assert.equal(captured, undefined, "forum guests are skipped");
        clear(); session.authenticated = true; session.hasAvatar = true;
        await uploadForumAvatar(client, "wss://worlds.rsps.app/game");
        assert.equal(requests.length, 1); assert.equal(captured, undefined, "existing avatars are skipped before rendering");
        clear(); session.hasAvatar = false;
        const upload = uploadForumAvatar(client, "wss://worlds.rsps.app/game");
        source.equip[0] = -1; source.colors[0] = 0;
        await upload;
        assert.equal(captured?.gender, Gender.FEMALE);
        assert.equal(captured?.equip[0], 1163, "helmet at logout survives ECS reset");
        assert.equal(captured?.colors[0], 1, "appearance colours are snapshotted");
        assert.deepEqual(draws.map(bounds => bounds.map(value => Math.round(value * 10) / 10)), [[19.2, 8, 89.6, 112]], "head fits inside the square without cropping helmet or face");
        assert.equal(requests.length, 2);
        const posted = requests[1];
        assert.equal(posted.url, "/api/rsps/avatar");
        assert.equal(posted.options?.method, "POST");
        assert.equal(posted.options?.credentials, "same-origin");
        assert.deepEqual(posted.options?.headers, { "X-CSRF-Token": "forum-csrf" });
        const body = posted.options?.body as FormData;
        assert.equal((body.get("avatar") as File).name, "chat-head.png");
        assert.deepEqual([...body.keys()], ["avatar"], "target account comes only from the forum session");
        clear(); missingModel = true;
        await uploadForumAvatar(client, "wss://worlds.rsps.app/game");
        assert.equal(requests.length, 1, "unavailable/partial models must not create an avatar");
        console.log("Forum avatar: official-world gating, login/avatar checks, logout appearance, portrait fit and CSRF upload passed.");
    } finally {
        PlayerChatheadFactory.prototype.get = originalGet;
        Model2DRenderer.prototype.renderModelInstanceToCanvasExtents = originalRender;
    }
}
void main();
