import * as assert from "node:assert/strict";

const { registerQuest } = require("../plugins/quests/QuestRuntime.js");

const attributes = new Map<string, unknown>();
const sent = {
    configs: [] as Array<[number, number]>,
    jingles: [] as number[],
    questLists: [] as any[],
    strings: [] as Array<[string, number]>,
    items: [] as Array<[number, number, number]>,
    interfaces: [] as number[],
    messages: [] as string[],
    granted: [] as Array<[number, number]>,
    rewarded: false,
};
const player = {
    getAttribute: (key: string) => attributes.get(key),
    setAttribute: (key: string, value: unknown) => attributes.set(key, value),
    sendMessage: (message: string) => sent.messages.push(message),
    getInventory: () => ({
        adds: (id: number, amount: number) => sent.granted.push([id, amount]),
    }),
    getPacketSender: () => ({
        sendConfig: (id: number, value: number) => sent.configs.push([id, value]),
        sendJingle: (id: number) => sent.jingles.push(id),
        sendQuestList: (groups: any) => sent.questLists.push(groups),
        sendInterfaceFlagsRange: () => {},
        sendString: (text: string, uid: number) => sent.strings.push([text, uid]),
        sendInterfaceRemoval: () => {},
        sendInterface: (id: number) => sent.interfaces.push(id),
        sendItemOnInterfaces: (uid: number, item: number, amount: number) => sent.items.push([uid, item, amount]),
        sendInterfaceScript: () => {},
        sendSubInterface: () => {},
        closeSubInterface: () => {},
    }),
};

const persisted: string[] = [];
const api = {
    persistAttribute: (key: string) => persisted.push(key),
    onInterfaceActionButton: () => {},
    onCustomEvent: () => {},
};

const quest = registerQuest(api, {
    key: "test_quest",
    name: "Test Quest",
    varpId: 29,
    startedValue: 1,
    completionValue: 2,
    questPoints: 1,
    xpRewards: [{ skillId: 7, amount: 300, label: "Cooking" }],
    rewardItemId: 1891,
    buildJournal: () => ["line one", "line two"],
    onReward: () => {
        sent.rewarded = true;
    },
});

assert.deepEqual([...persisted].sort(), ["quest.points", "quest.test_quest.stage"], "persists stage + points");

assert.equal(quest.getStage(player), 0, "new players start at stage 0");
assert.equal(quest.isComplete(player), false);

quest.setStage(player, 1);
assert.equal(quest.getStage(player), 1);
assert.equal(quest.isStarted(player), true);
assert.deepEqual(sent.configs.at(-1), [29, 1], "stage mirrors to the quest varp");

assert.equal(quest.complete(player), true);
assert.equal(quest.isComplete(player), true);
assert.equal(quest.getStage(player), 2);
assert.deepEqual(sent.configs.at(-1), [101, 1], "quest points varp");
assert.equal(sent.rewarded, true, "reward hook runs");
assert.deepEqual(sent.granted, [[1891, 1]], "reward item is added to the inventory");
assert.ok(sent.jingles.length > 0, "plays the completion jingle");
assert.ok(sent.interfaces.includes(153), "opens the completion scroll");
assert.ok(sent.items.some(([uid, item]) => uid === ((153 << 16) | 5) && item === 1891), "scroll shows the reward item");
assert.equal(quest.complete(player), false, "completing twice is a no-op");

const groups = sent.questLists.at(-1);
assert.equal(groups[0].quests[0].key, "test_quest");
assert.equal(groups[0].quests[0].status, 2, "quest list shows complete");
assert.equal(groups[0].quests[0].displayName, "Test Quest");

console.info("quest runtime smoke passed");
