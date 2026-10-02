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
const player = {
    getUsername: () => "Agent1",
    getLocation: () => location(3222, 3218),
    getHitpoints: () => 10,
    getRunEnergy: () => 100,
    getPacketSender: () => packetSender,
    getSkillManager: () => ({ getCurrentLevel: () => 1, getMaxLevel: () => 1, getExperience: () => 0 }),
    getInventory: () => ({ getItems: () => [item(1351), null, item(-1)] }),
    getEquipment: () => ({ getItems: () => [] }),
};
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

    await call(client, "walk_to", { player: "agent1", x: 3230, y: 3230, run: true });
    await call(client, "npc_option", { player: "agent1", index: 7, option: "pickpocket" });
    await call(client, "object_option", { player: "agent1", id: 1276, x: 3220, y: 3216, option: "Chop down" });
    await call(client, "inventory_option", { player: "agent1", slot: 0, option: "Wield" });
    await call(client, "chat", { player: "agent1", text: "::tele 3222 3218" });
    assert.deepEqual(dispatched, [
        { type: "move", worldX: 3230, worldY: 3230, modifierFlags: 2 },
        { type: "npc_option", index: 7, clickType: 4 },
        { type: "object_option", id: 1276, x: 3220, y: 3216, action: "Chop down" },
        { type: "inventory_action", slot: 0, itemId: 1351, widgetId: 3214, option: "Wield" },
        { type: "chat", text: "::tele 3222 3218", messageType: "public" },
    ]);

    const missingOption = await call(client, "npc_option", { player: "agent1", index: 7, option: "Trade" });
    assert.ok(missingOption.error && missingOption.text.includes("Talk-to, Attack, Pickpocket"));
    assert.ok((await call(client, "observe", { player: "nobody" })).error);
    assert.ok((await call(client, "inventory_option", { player: "agent1", slot: 1, option: "Eat" })).error);

    const waited = (await call(client, "wait_ticks", { player: "agent1", ticks: 2 })).value;
    assert.equal(waited.x, 3222);

    await client.close();
    console.log("agent-mcp smoke passed");
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
