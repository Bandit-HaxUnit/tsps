import assert from "node:assert/strict";
import { test } from "node:test";

import { Opcodes } from "../rs/cs2/Opcodes";
import { createHandlerMap } from "../rs/cs2/handlers";
import { getEnumOverride, getStructOverride, loadFromPayload } from "../common/gamemode/GamemodeContentStore";

/** Server-sent structs and enums (a league's relic catalog) stand in for the cache's in the cs2 config ops. */
function context(extra: Record<string, unknown> = {}) {
    const ctx: any = {
        intStack: new Array(64).fill(0),
        stringStack: new Array(64).fill(null),
        intStackSize: 0,
        stringStackSize: 0,
        pushInt(v: number) { this.intStack[this.intStackSize++] = v | 0; },
        pushString(v: any) { this.stringStack[this.stringStackSize++] = v; },
        popInt() { return this.intStack[--this.intStackSize]; },
        popString() { return this.stringStack[--this.stringStackSize]; },
        ...extra,
    };
    return ctx;
}

const handlers = createHandlerMap();
const run = (opcode: number, ctx: any) => handlers.get(opcode)!(ctx, 0, "");

const cacheEnums: Record<number, any> = {
    5702: { keys: [0, 1], intValues: [1136, 1137], defaultInt: -1, outputCount: 2 },
};
const params: Record<number, any> = {
    877: { isString: () => false, defaultInt: 0 },
    879: { isString: () => true, defaultString: "" },
    880: { isString: () => true, defaultString: "" },
};
const cacheStructs: Record<number, any> = {
    1136: { params: new Map([[877, 600]]) },
};

test("enum overrides replace a cache enum or define a new id, for ints and strings", () => {
    loadFromPayload({
        gamemodeId: "test",
        datasets: [{
            key: "enumOverrides",
            rows: [
                { enumId: 5702, valueType: "J", defaultValue: -1, entries: [[0, 200001], [1, 200002], [2, 200003]] },
                { enumId: 200100, valueType: "J", defaultValue: -1, entries: [[1, 300001], [2, 300002], [3, 300003]] },
                { enumId: 200200, valueType: "s", defaultValue: "none", entries: [[1, "Superior Sorcerer"]] },
            ],
        }],
    });
    assert.equal(getEnumOverride(5702)?.outputCount, 3);
    const ctx = context({ enumTypeLoader: { load: (id: number) => cacheEnums[id] } });
    // enum(inputtype, outputtype, enum, key)
    ctx.pushInt(105); ctx.pushInt(105); ctx.pushInt(5702); ctx.pushInt(2);
    run(Opcodes.ENUM, ctx);
    assert.equal(ctx.popInt(), 200003, "a third tier the cache enum never had");
    ctx.pushInt(105); ctx.pushInt(105); ctx.pushInt(200100); ctx.pushInt(3);
    run(Opcodes.ENUM, ctx);
    assert.equal(ctx.popInt(), 300003, "a virtual enum keyed 1..3, as the relic enums are");
    ctx.pushInt(105); ctx.pushInt(105); ctx.pushInt(200100); ctx.pushInt(9);
    run(Opcodes.ENUM, ctx);
    assert.equal(ctx.popInt(), -1, "its default for a missing key");
    ctx.pushInt(200100);
    run(Opcodes.ENUM_GETOUTPUTCOUNT, ctx);
    assert.equal(ctx.popInt(), 3);
    ctx.pushInt(105); ctx.pushInt(200100);
    run(Opcodes.ENUM_GETINPUTS, ctx);
    const inputs = ctx.popString();
    assert.deepEqual([0, 1, 2].map((i) => inputs.getInt(i)), [1, 2, 3], "enum_getinputs sees the override's keys");
    ctx.pushInt(200200); ctx.pushInt(1);
    run(Opcodes.ENUM_STRING, ctx);
    assert.equal(ctx.popString(), "Superior Sorcerer");
    ctx.pushInt(200200); ctx.pushInt(2);
    run(Opcodes.ENUM_STRING, ctx);
    assert.equal(ctx.popString(), "none");
});

test("struct overrides replace a cache struct's params or define a new struct", () => {
    loadFromPayload({
        gamemodeId: "test",
        datasets: [{
            key: "structOverrides",
            rows: [
                { structId: 1136, params: { 877: 500 } },
                { structId: 300001, params: { 879: "Superior Sorcerer", 880: "Magic weapons attack at speed 2." } },
            ],
        }],
    });
    assert.equal(getStructOverride(1136, 877), 500);
    assert.equal(getStructOverride(1136, 879), undefined, "other params fall through to the cache");
    const ctx = context({
        paramTypeLoader: { load: (id: number) => params[id] },
        structTypeLoader: { load: (id: number) => cacheStructs[id] },
    });
    ctx.pushInt(1136); ctx.pushInt(877);
    run(Opcodes.STRUCT_PARAM, ctx);
    assert.equal(ctx.popInt(), 500, "Trailblazer Reloaded's tier 2 cost over the cache's 600");
    ctx.pushInt(300001); ctx.pushInt(879);
    run(Opcodes.STRUCT_PARAM, ctx);
    assert.equal(ctx.popString(), "Superior Sorcerer");
    ctx.pushInt(300001); ctx.pushInt(880);
    run(Opcodes.STRUCT_PARAM, ctx);
    assert.equal(ctx.popString(), "Magic weapons attack at speed 2.");
});

test("a payload without the datasets keeps them; an empty dataset clears them", () => {
    loadFromPayload({ gamemodeId: "test", datasets: [{ key: "worldMapPlayers", rows: [] }] });
    assert.equal(getStructOverride(300001, 879), "Superior Sorcerer");
    assert.equal(getEnumOverride(200100)?.outputCount, 3);
    loadFromPayload({ gamemodeId: "test", datasets: [{ key: "structOverrides", rows: [] }, { key: "enumOverrides", rows: [] }] });
    assert.equal(getStructOverride(300001, 879), undefined);
    assert.equal(getEnumOverride(200100), undefined);
});
