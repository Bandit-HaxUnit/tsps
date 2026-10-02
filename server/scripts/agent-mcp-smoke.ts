import * as assert from "node:assert/strict";

const { buildMcpServer } = require("../plugins/agent/AgentMcp.plugin.js");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { InMemoryTransport } = require("@modelcontextprotocol/sdk/inMemory.js");

const location = (x: number, y: number, z = 0) => ({ getX: () => x, getY: () => y, getZ: () => z });
const item = (id: number, amount = 1) => ({
    getId: () => id,
    getAmount: () => amount,
    getDefinition: () => ({ getName: () => `item ${id}` }),
});
const skill = { getName: () => "Woodcutting" };

const clientMessages: string[] = [];
const packetSender = { sendMessage: (message: string) => clientMessages.push(message) };
let movingTicks = 0;
const player = {
    getUsername: () => "Agent1",
    getIndex: () => 1,
    getMovementQueue: () => ({ hasPendingWork: () => movingTicks-- > 0 }),
    getDialogueManager: () => ({ isActive: () => dialogueOpen }),
    getInterfaceId: () => -1,
    performAnimation: (_animation: unknown) => {},
    getLocation: () => location(3222, 3218),
    getHitpoints: () => 10,
    getRunEnergy: () => 100,
    getPacketSender: () => packetSender,
    getSkillManager: () => ({ getCurrentLevel: () => 1, getMaxLevel: () => 1, getExperience: () => 0 }),
    getInventory: () => ({ getItems: () => [item(1351), null, item(-1)] }),
    getEquipment: () => ({ getItems: () => [] }),
};
let dialogueOpen = false;
const npc = {
    getIndex: () => 7,
    getId: () => 3106,
    getLocation: () => location(3225, 3220),
    getCurrentDefinition: () => ({ getName: () => "Man", getActions: () => ["Talk-to", null, "Attack", "Pickpocket"] }),
};
const tree = { getId: () => 1276, getLocation: () => location(3220, 3216) };
const dispatched: any[] = [];

const core = {
    World: {
        // One tick per millisecond, matching GAME_ENGINE_PROCESSING_CYCLE_RATE below.
        getProcessCycle: () => Date.now(),
        getPlayerByName: (name: string) => (name.toLowerCase() === "agent1" ? player : undefined),
        getPlayers: () => ({ stream: () => [player] }),
        getNpcs: () => ({ stream: () => [npc, null], get: (index: number) => (index === 7 ? npc : undefined) }),
        getItems: () => [{ getItem: () => item(526), getPosition: () => location(3223, 3218) }],
    },
    MapObjects: {
        mapObjects: new Map([["3220,3216,0", [tree]]]),
        getHash: (x: number, y: number, z: number) => `${x},${y},${z}`,
    },
    ObjectDefinition: { forPlayer: () => ({ getName: () => "Tree", getInteractions: () => ["Chop down", null] }) },
    ItemDefinition: { forId: (id: number) => ({ getName: () => `item ${id}` }) },
    Skill: { values: () => [skill] },
    GameConstants: { GAME_ENGINE_PROCESSING_CYCLE_RATE: 1 },
    dispatchClientMessages: (target: unknown, messages: unknown[]) => {
        assert.equal(target, player);
        dispatched.push(...messages);
        return true;
    },
};

const call = async (client: any, name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: args });
    const text = result.content[0].text;
    return { error: !!result.isError, text, value: result.isError ? null : JSON.parse(text) };
};

(async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await buildMcpServer(core).connect(serverTransport);
    const client = new Client({ name: "smoke", version: "1.0.0" });
    await client.connect(clientTransport);

    const { tools } = await client.listTools();
    assert.ok(tools.some((tool: any) => tool.name === "observe"));

    // Game messages are recorded once an agent has touched the player, and still reach the client.
    let { value: snapshot } = await call(client, "observe", { player: "agent1" });
    player.getPacketSender().sendMessage("You swing your axe at the tree.");
    assert.deepEqual(clientMessages, ["You swing your axe at the tree."]);

    snapshot = (await call(client, "observe", { player: "agent1" })).value;
    assert.equal(snapshot.x, 3222);
    assert.deepEqual(snapshot.skills.Woodcutting, { level: 1, max: 1, xp: 0 });
    assert.deepEqual(snapshot.inventory, [{ slot: 0, id: 1351, name: "item 1351", amount: 1 }]);
    assert.deepEqual(snapshot.npcs[0].options, ["Talk-to", "Attack", "Pickpocket"]);
    assert.deepEqual(snapshot.objects, [{ id: 1276, name: "Tree", options: ["Chop down"], x: 3220, y: 3216 }]);
    assert.equal(snapshot.groundItems[0].id, 526);
    assert.deepEqual(snapshot.messages, ["You swing your axe at the tree."]);
    assert.deepEqual((await call(client, "observe", { player: "agent1" })).value.messages, []);

    // The mock player never moves, so a walk elsewhere reports stuck and a walk to its own tile arrives.
    assert.equal((await call(client, "walk_to", { player: "agent1", x: 3230, y: 3230, run: true })).value.result, "stuck");
    assert.equal((await call(client, "walk_to", { player: "agent1", x: 3222, y: 3218 })).value.result, "arrived");
    await call(client, "npc_option", { player: "agent1", index: 7, option: "pickpocket" });
    await call(client, "object_option", { player: "agent1", id: 1276, x: 3220, y: 3216, option: "Chop down" });
    await call(client, "inventory_option", { player: "agent1", slot: 0, option: "Wield" });
    await call(client, "inventory_option", { player: "agent1", item: "ITEM 1351", option: "Drop" });
    await call(client, "chat", { player: "agent1", text: "::tele 3222 3218" });
    const interacted = (await call(client, "interact", { player: "agent1", target: "man", option: "Attack" })).value;
    assert.deepEqual(interacted.clicked, { kind: "npc", name: "Man", x: 3225, y: 3220 });
    assert.equal(interacted.result, "idle");
    await call(client, "interact", { player: "agent1", target: "Tree", option: "chop down" });
    await call(client, "interact", { player: "agent1", target: "item 526", option: "Take" });
    assert.deepEqual(dispatched, [
        { type: "move", worldX: 3230, worldY: 3230, modifierFlags: 2 },
        { type: "move", worldX: 3222, worldY: 3218, modifierFlags: 0 },
        { type: "npc_option", index: 7, clickType: 4 },
        { type: "object_option", id: 1276, x: 3220, y: 3216, action: "Chop down" },
        { type: "inventory_action", slot: 0, itemId: 1351, widgetId: 3214, option: "Wield" },
        { type: "inventory_action", slot: 0, itemId: 1351, widgetId: 3214, option: "Drop" },
        { type: "chat", text: "::tele 3222 3218", messageType: "public" },
        { type: "npc_option", index: 7, clickType: 3 },
        { type: "object_option", id: 1276, x: 3220, y: 3216, action: "Chop down" },
        { type: "ground_item_action", itemId: 526, x: 3223, y: 3218, option: "Take" },
    ]);

    const wrongOption = await call(client, "interact", { player: "agent1", target: "Man", option: "Trade" });
    assert.ok(wrongOption.error && wrongOption.text.includes("Talk-to, Attack, Pickpocket"));
    const unknown = await call(client, "interact", { player: "agent1", target: "Goblin", option: "Attack" });
    assert.ok(unknown.error && unknown.text.includes("Man, Tree"));
    assert.ok((await call(client, "inventory_option", { player: "agent1", item: "Shrimps", option: "Eat" })).error);

    const missingOption = await call(client, "npc_option", { player: "agent1", index: 7, option: "Trade" });
    assert.ok(missingOption.error && missingOption.text.includes("Talk-to, Attack, Pickpocket"));
    assert.ok((await call(client, "observe", { player: "nobody" })).error);
    assert.ok((await call(client, "inventory_option", { player: "agent1", slot: 1, option: "Eat" })).error);

    const waited = (await call(client, "wait_ticks", { player: "agent1", ticks: 2 })).value;
    assert.equal(waited.x, 3222);
    assert.deepEqual(waited.busy, []);

    // Busy keeps an interact waiting: 3 ticks of movement, then an animation, then idle.
    movingTicks = 3;
    (player as any).performAnimation({});
    const busyWait = (await call(client, "interact", { player: "agent1", target: "Tree", option: "Chop down" })).value;
    assert.equal(busyWait.result, "idle");
    assert.ok(busyWait.ticks > 3, `waited ${busyWait.ticks} ticks`);
    (player as any).performAnimation({});
    assert.deepEqual((await call(client, "wait_ticks", { player: "agent1", ticks: 1 })).value.busy, ["animating"]);

    // An open dialogue ends the wait so the agent can answer it.
    dialogueOpen = true;
    const talked = (await call(client, "interact", { player: "agent1", target: "Man", option: "Talk-to" })).value;
    assert.equal(talked.result, "dialogue");
    dialogueOpen = false;

    await client.close();
    console.log("agent-mcp smoke passed");
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
