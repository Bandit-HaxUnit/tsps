import type { Player } from "../../../entity/impl/player/Player";
import type { PluginItemOnItemEvent, PluginNpcInteractionEvent, PluginItemOnNpcEvent, PluginItemActionEvent } from "../../../../plugins/PluginTypes";
import { CacheDefinitions } from "../../../cache/CacheDefinitions";
import { Item } from "../../../model/Item";
import { ItemIdentifiers } from "../../../../util/ItemIdentifiers";
import { Skill } from "../../../model/Skill";
import { Equipment } from "../../../model/container/impl/Equipment";
import type { NPC } from "../../../entity/impl/npc/NPC";
import { ItemOnGroundManager } from "../../../entity/impl/grounditem/ItemOnGroundManager";
import { CACHE, CROPS, Crop, Patch, patchKey, itemId, WOOD_TREES, petRate } from "./FarmingData";
import { PluginManager } from "../../../../plugins/PluginManager";
import { PatchState, MINUTE, nextGrowth } from "./FarmingModel";
import { farmFor, stateFor, give, choose, award, requireTool, water, clearPatch, nearPatch, fertilize } from "./FarmingPlugin";

const COMPOST_NAMES = ["", "Compost", "Supercompost", "Ultracompost", "Rotten tomato"];
const SUPER = new Set(["Pineapple", "Tenti pineapple", "Watermelon", "Coconut", "Coconut shell", "Papaya fruit", "Calquat fruit", "Poison ivy berries", "White berries", "Jangerberries", "Mushroom", "Dragonfruit", "Snape grass", "Celastrus bark", "White lily", "White tree fruit", "Oak roots", "Willow roots", "Maple roots", "Yew roots", "Magic roots"]);
const COMPOST = new Set(["Weeds", "Grain", "Kebab", "Varlamorian kebab", "Flax", "Redberries", "Cadava berries", "Dwellberries", "Potato", "Onion", "Cabbage", "Tomato", "Sweetcorn", "Strawberry", "Lemon", "Lime", "Cooking apple", "Banana", "Orange", "Curry leaf", "Peach", "Watermelon slice", "Barley malt", "Hammerstone hops", "Asgarnian hops", "Jute fibre", "Kelda hops", "Yanillian hops", "Krandorian hops", "Wildblood hops", "Marigolds", "Rosemary", "Nasturtiums", "Woad leaf", "Limpwurt root", "Willow branch", "Rotten apple", "Apple mush", "Seaweed", "Edible seaweed", "Giant seaweed", "Potato cactus", "Leaves", "Oak leaves", "Willow leaves", "Maple leaves", "Yew leaves", "Magic leaves"]);
const SUPER_HERBS = new Set(["TOADFLAX", "AVANTOE", "KWUARM", "SNAPDRAGON", "HUASCA", "CADANTINE", "LANTADYME", "DWARF_WEED", "TORSTOL"]);
const TOOL_CAPACITY: Record<string, number> = { "Rake": 100, "Seed dibber": 100, "Spade": 100, "Secateurs": 100, "Magic secateurs": 100,
    "Gardening trowel": 100, "Plant cure": 1000, "Bucket": 1000, "Compost": 1000, "Supercompost": 1000, "Ultracompost": 1000,
    "Gricoller's can": 1, "Bottomless compost bucket": 1 };
const CONTAINERS: [string, string, number][] = [["Potato", "Potatoes", 10], ["Onion", "Onions", 10], ["Cabbage", "Cabbages", 10],
    ["Cooking apple", "Apples", 5], ["Banana", "Bananas", 5], ["Orange", "Oranges", 5], ["Strawberry", "Strawberries", 5], ["Tomato", "Tomatoes", 5]];

export function cropRewards(player: Player, crop: Crop): void {
    const base = petRate(crop);
    if (!base) return;
    const level = Math.min(99, player.getSkillManager().getCurrentLevel(Skill.FARMING));
    PluginManager.emitCustomEvent("farming:success", { player, skill: Skill.FARMING,
        petChance: (base - 25 * level) / (player.getSkillManager().getExperience(Skill.FARMING) >= 200000000 ? 15 : 1) });
    if (crop.type === "HESPORI" || farmFor(player).disableHesporiSeeds) return;
    const denominator = ["BARLEY", "HAMMERSTONE"].includes(crop.key) ? 244 : crop.key === "LIMPWURT" ? 449 : Math.floor(base / 500);
    if (Math.random() < 1 / denominator) {
        if (player.getInventory().getFreeSlots() || player.getInventory().contains(itemId("Hespori seed"))) give(player, itemId("Hespori seed"));
        else ItemOnGroundManager.registers(player, new Item(itemId("Hespori seed")));
        player.sendMessage("You find a Hespori seed!");
    }
}

function binFor(state: PatchState) {
    return state.bin ??= { count: 0, super: 0, tomatoes: 0, tier: 1, closedAt: 0, open: false };
}
export function binValue(patch: Patch, state: PatchState): number {
    const bin = binFor(state);
    if (!bin.count) return 0;
    const prefix = patch.type === "BIG_COMPOST" ? "BIG_" : "";
    const key = prefix + ["", "COMPOST", "SUPERCOMPOST", "ULTRACOMPOST", "ROTTEN_TOMATO"][bin.tier];
    const states = CACHE.states[patch.type][key];
    if (bin.open) return states.HARVESTABLE[bin.count - 1];
    if (bin.closedAt) return states.GROWING[Date.now() - bin.closedAt >= (bin.tier === 2 ? 90 : 60) * MINUTE ? 2 : 0];
    return states.FILLING[bin.count - 1];
}
export function binAction(player: Player, patch: Patch, action: string, usedId?: number): void {
    const bin = binFor(stateFor(player, patch));
    const capacity = patch.type === "BIG_COMPOST" ? 30 : 15;
    const inventory = player.getInventory();
    if (action === "close") {
        if (bin.count !== capacity) { player.sendMessage(`The bin needs ${capacity} items before you can close it.`); return; }
        if (!bin.closedAt) bin.closedAt = Date.now();
        bin.open = false;
        return;
    }
    if (action === "open") {
        if (!bin.closedAt || Date.now() - bin.closedAt < (bin.tier === 2 ? 90 : 60) * MINUTE) { player.sendMessage("The contents have not finished rotting."); return; }
        bin.open = true;
        return;
    }
    if (usedId === itemId("Volcanic ash")) {
        const amount = capacity === 30 ? 50 : 25;
        if (bin.tier !== 2 || !bin.open || inventory.getAmount(usedId) < amount) {
            player.sendMessage(`Use ${amount} volcanic ash on an open bin of supercompost.`); return;
        }
        inventory.deleteNumber(usedId, amount); bin.tier = 3;
        return;
    }
    if (usedId && /^Compost potion\([1-4]\)$/.test(CacheDefinitions.getItem(usedId).name)) {
        if (!bin.open || bin.tier !== 1) { player.sendMessage("Use this on an open bin of compost."); return; }
        dose(player, usedId); bin.tier = 2;
        return;
    }
    const bottomless = usedId !== undefined && CacheDefinitions.getItem(usedId).name === "Bottomless compost bucket";
    if (usedId === itemId("Bucket") || action === "empty" || action === "take" || bottomless) {
        if (!bin.open || !bin.count) { player.sendMessage("Open a finished compost bin first."); return; }
        if (bottomless) {
            if (bin.tier === 4 || !chargeBottomless(player, bin.tier)) return;
        } else {
            if (!inventory.contains(itemId("Bucket"))) { player.sendMessage("You need an empty bucket."); return; }
            inventory.deleteNumber(itemId("Bucket"), 1);
            inventory.addItem(new Item(itemId(COMPOST_NAMES[bin.tier])));
        }
        award(player, [0, 4.5, 8.5, 10, 4.5][bin.tier]);
        if (--bin.count === 0) stateFor(player, patch).bin = undefined;
        return;
    }
    if (usedId) {
        if (bin.closedAt || bin.open || bin.count >= capacity) { player.sendMessage("You cannot add anything else to this bin."); return; }
        const name = CacheDefinitions.getItem(usedId).name;
        const herb = [...CROPS.values()].find(c => c.type === "HERB" && (c.produce === usedId || CacheDefinitions.getItem(c.produce).name.replace(/^Grimy /, "").toLowerCase() === name.toLowerCase()));
        const superItem = SUPER.has(name) || (herb && SUPER_HERBS.has(herb.key));
        if (!superItem && !COMPOST.has(name) && !herb) {
            player.sendMessage("That cannot be composted."); return;
        }
        inventory.deleteNumber(usedId, 1);
        bin.count++;
        if (superItem) bin.super++;
        if (name === "Tomato") bin.tomatoes++;
        bin.tier = bin.super === bin.count ? 2 : bin.tomatoes === bin.count ? 4 : 1;
        return;
    }
    player.sendMessage(`The compost bin contains ${bin.count}/${capacity} items${bin.closedAt && !bin.open ? ", rotting" : ""}.`);
}
function dose(player: Player, id: number): void {
    const name = CacheDefinitions.getItem(id).name;
    const count = Number(name.match(/\((\d)\)$/)[1]);
    player.getInventory().deleteNumber(id, 1);
    player.getInventory().addItem(new Item(itemId(count > 1 ? `Compost potion(${count - 1})` : "Vial")));
}
function chargeBottomless(player: Player, tier: number): boolean {
    const bucket = player.getInventory().getItems().find(i => CacheDefinitions.getItem(i.getId()).name === "Bottomless compost bucket");
    if (!bucket) return false;
    const charges = Number(bucket.getMetaValue("farming:charges") ?? 0);
    if (charges > 0 && bucket.getMetaValue("farming:tier") !== tier) { player.sendMessage("Empty the bucket before changing compost type."); return false; }
    if (charges > 9998) { player.sendMessage("The bucket is full."); return false; }
    bucket.setMetaValue("farming:charges", charges + 2).setMetaValue("farming:tier", tier);
    bucket.setId(ItemIdentifiers.BOTTOMLESS_COMPOST_BUCKET_4);
    player.getInventory().refreshItems();
    return true;
}
export function useBottomless(player: Player, patch: Patch, id: number): void {
    const bucket = player.getInventory().getItems().find(i => i.getId() === id);
    const charges = Number(bucket?.getMetaValue("farming:charges") ?? 0);
    if (!charges) { player.sendMessage("The bucket is empty."); return; }
    if (fertilize(player, patch, Number(bucket.getMetaValue("farming:tier")), false)) {
        bucket.setMetaValue("farming:charges", charges - 1);
        if (charges === 1) bucket.setId(ItemIdentifiers.BOTTOMLESS_COMPOST_BUCKET);
        player.getInventory().refreshItems();
    }
}
export function farmingItemPair(event: PluginItemOnItemEvent): void {
    const { player, usedItemId: a, usedWithItemId: b } = event;
    const inventory = player.getInventory();
    if (!inventory.contains(a) || !inventory.contains(b)) return;
    const names = [CacheDefinitions.getItem(a).name, CacheDefinitions.getItem(b).name];
    if (([a, b].includes(ItemIdentifiers.HAY_SACK) && names.includes("Bronze spear")) || ([a, b].includes(ItemIdentifiers.HAY_SACK_2) && names.includes("Watermelon"))) {
        event.handled = true;
        if (player.getSkillManager().getCurrentLevel(Skill.FARMING) < 23) { player.sendMessage("You need level 23 Farming."); return; }
        inventory.deleteNumber(a, 1); inventory.deleteNumber(b, 1);
        const finished = names.includes("Watermelon");
        inventory.addItem(new Item(finished ? itemId("Scarecrow") : ItemIdentifiers.HAY_SACK_2));
        if (finished) award(player, 25);
        return;
    }
    const crop = [...CROPS.values()].find(c => c.sapling && (c.seed === a || c.seed === b));
    if (crop && (a === itemId("Filled plant pot") || b === itemId("Filled plant pot"))) {
        event.handled = true;
        if (!requireTool(player, "Gardening trowel")) return;
        if (player.getSkillManager().getCurrentLevel(Skill.FARMING) < crop.level) { player.sendMessage(`You need level ${crop.level} Farming.`); return; }
        inventory.deleteNumber(crop.seed, 1);
        inventory.deleteNumber(itemId("Filled plant pot"), 1);
        inventory.addItem(new Item(crop.seedling));
        return;
    }
    const seedling = [...CROPS.values()].find(c => c.seedling === a || c.seedling === b);
    if (seedling) {
        const can = a === seedling.seedling ? b : a;
        if (!/^Watering can\(|^Magic watering can$|^Gricoller's can$/.test(CacheDefinitions.getItem(can).name)) return;
        event.handled = true;
        if (!water(player, can)) return;
        const slot = a === seedling.seedling ? event.usedItemSlot : event.usedWithItemSlot;
        inventory.forSlot(slot).setId(seedling.wateredSeedling).setMetaValue("farming:saplingAt", nextGrowth(Date.now(), 5, farmFor(player).offset));
        inventory.refreshItems();
        return;
    }
    const compostTier = COMPOST_NAMES.slice(1, 4).findIndex(name => itemId(name) === a || itemId(name) === b) + 1;
    if (compostTier && [a, b].some(id => CacheDefinitions.getItem(id).name === "Bottomless compost bucket")) {
        event.handled = true;
        if (chargeBottomless(player, compostTier)) {
            inventory.deleteNumber(itemId(COMPOST_NAMES[compostTier]), 1);
            inventory.addItem(new Item(itemId("Bucket")));
        }
        return;
    }
    if (compostTier === 2 && (a === itemId("Volcanic ash") || b === itemId("Volcanic ash"))) {
        event.handled = true;
        if (inventory.getAmount(itemId("Volcanic ash")) < 2) { player.sendMessage("You need two volcanic ash."); return; }
        inventory.deleteNumber(itemId("Volcanic ash"), 2);
        inventory.deleteNumber(itemId("Supercompost"), 1);
        inventory.addItem(new Item(itemId("Ultracompost")));
        return;
    }
    const potion = [a, b].find(id => /^Compost potion\([1-4]\)$/.test(CacheDefinitions.getItem(id).name));
    if (compostTier === 1 && potion) {
        event.handled = true;
        dose(player, potion);
        inventory.deleteNumber(itemId("Compost"), 1);
        inventory.addItem(new Item(itemId("Supercompost")));
        return;
    }
    for (const [produce, plural, capacity] of CONTAINERS) {
        if (a !== itemId(produce) && b !== itemId(produce)) continue;
        const container = a === itemId(produce) ? b : a;
        const name = CacheDefinitions.getItem(container).name;
        const current = name === (capacity === 10 ? "Empty sack" : "Basket") ? 0 : name.startsWith(`${plural}(`) ? Number(name.match(/\((\d+)\)/)?.[1]) : -1;
        if (current < 0 || current >= capacity) continue;
        event.handled = true;
        const amount = Math.min(capacity - current, inventory.getAmount(itemId(produce)));
        inventory.deleteNumber(itemId(produce), amount);
        inventory.deleteNumber(container, 1);
        inventory.addItem(new Item(itemId(`${plural}(${current + amount})`)));
        return;
    }
}
export function growSeedlings(player: Player, now: number): void {
    const seedlings = new Map([...CROPS.values()].filter(c => c.wateredSeedling).map(c => [c.wateredSeedling, c]));
    for (const container of [player.getInventory(), ...player.getBanks()]) {
        let changed = false;
        for (const item of container.getItems()) {
            const crop = seedlings.get(item.getId());
            if (!crop) continue;
            const at = item.getMetaValue<number>("farming:saplingAt");
            if (!at) item.setMetaValue("farming:saplingAt", nextGrowth(now, 5, farmFor(player).offset));
            else if (now >= at) { item.setId(crop.sapling).setMetaValue("farming:saplingAt", undefined); changed = true; }
        }
        if (changed) container.refreshItems();
    }
}
export function waterContainers({ containers }: { containers: Map<number, number> }): void {
    for (const crop of CROPS.values()) if (crop.seedling) containers.set(crop.seedling, crop.wateredSeedling);
    for (let charges = 1; charges < 8; charges++) containers.set(itemId(`Watering can(${charges})`), itemId("Watering can(8)"));
}
export function humidified({ player }: { player: Player }): void {
    // Assign the same persistent farming-clock deadline used for hand-watered seedlings.
    growSeedlings(player, Date.now());
}
function withdrawTools(player: Player, npc: NPC): void {
    const stored = farmFor(player).tools;
    const entries: [string, () => void][] = Object.entries(stored).filter(([, count]) => count > 0).map(([id, count]) => [
        `${CacheDefinitions.getItem(+id).name} (${count})`, () => {
            if (!player.getLocation().isWithinDistance(npc.getLocation(), 5)) return;
            const amount = Math.min(stored[id], player.getInventory().getFreeSlots(), 28);
            if (!amount) return;
            const meta = farmFor(player).toolMeta?.[id];
            if (meta) {
                player.getInventory().addItem(new Item(+id, 1, Item.cloneMeta(meta)));
                stored[id]--; delete farmFor(player).toolMeta[id];
            } else if (give(player, +id, amount)) stored[id] -= amount;
        },
    ]);
    for (const [id, count] of Object.entries(stored)) {
        const definition = CacheDefinitions.getItem(+id);
        if (!count || definition.note < 0 || farmFor(player).toolMeta?.[id]) continue;
        entries.push([`Withdraw noted ${definition.name} (${count})`, () => {
            if (!player.getLocation().isWithinDistance(npc.getLocation(), 5)) return;
            const amount = stored[id];
            if (amount && give(player, definition.note, amount)) stored[id] -= amount;
        }]);
    }
    if (!entries.length) { player.sendMessage("Use farming tools or compost on me to store them."); return; }
    choose(player, entries);
}
function storeTool(player: Player, slot: number): boolean {
    const inventory = player.getInventory(), item = inventory.forSlot(slot);
    if (!item || item.getId() < 0) return false;
    const definition = CacheDefinitions.getItem(item.getId());
    const id = definition.noteTemplate >= 0 ? definition.note : item.getId();
    const name = CacheDefinitions.getItem(id).name;
    const watering = /^Watering can|^Gricoller's can$/.test(name);
    const capacity = TOOL_CAPACITY[name] ?? (watering ? 1 : 0);
    if (!capacity) return false;
    const farm = farmFor(player), tools = farm.tools;
    const used = Object.entries(tools).reduce((sum, [key, count]) => {
        const other = CacheDefinitions.getItem(+key).name;
        return sum + (watering ? /^Watering can|^Gricoller's can$/.test(other) ? count : 0
            : /secateurs/i.test(name) ? /secateurs/i.test(other) ? count : 0 : other === name ? count : 0);
    }, 0);
    const amount = Math.min(inventory.getAmount(item.getId()), capacity - used);
    if (amount <= 0) { player.sendMessage("I cannot store any more of those."); return true; }
    if (capacity === 1) {
        (farm.toolMeta ??= {})[id] = Item.cloneMeta(item.getMeta());
        inventory.deleteAtSlot(slot);
    } else inventory.deleteNumber(item.getId(), amount);
    tools[id] = (tools[id] ?? 0) + amount;
    return true;
}
export function farmingItemOnNpc(event: PluginItemOnNpcEvent): void {
    const { player, target, itemId: id } = event;
    if (!target.getDefinition()?.getName()?.toLowerCase().includes("leprechaun")) return;
    event.handled = true;
    if (!player.getInventory().contains(id)) return;
    const definition = CacheDefinitions.getItem(id);
    const unnoted = definition.noteTemplate >= 0 ? definition.note : id;
    const name = CacheDefinitions.getItem(unnoted).name;
    if (storeTool(player, event.slot)) return;
    const harvested = name === "Willow branch" || [...CROPS.values()].some(c => c.sapling === id || (!WOOD_TREES.has(c.type) && c.produce === id)
        || (c.type === "HERB" && CacheDefinitions.getItem(c.produce).name.replace(/^Grimy /, "").toLowerCase() === name.toLowerCase()));
    const loc = target.getLocation();
    if (name === "Cabbage" && loc.getX() > 3040 && loc.getX() < 3070 && loc.getY() > 3280 && loc.getY() < 3320) {
        player.sendMessage("I won't note cabbages here!"); return;
    }
    if (!harvested || definition.noteTemplate >= 0 || definition.note < 0) { player.sendMessage("I can note harvested produce and store farming tools."); return; }
    const amount = player.getInventory().getAmount(id);
    player.getInventory().deleteNumber(id, amount);
    player.getInventory().addItem(new Item(definition.note, amount));
}
export function farmingNpc(event: PluginNpcInteractionEvent): void {
    const { player, npc, definition } = event;
    const name = definition?.getName() ?? npc.getDefinition()?.getName() ?? "";
    const action = definition?.getActions()?.[event.clickType - 1]?.toLowerCase();
    if (name === "Otto Godblessed" && action === "talk-to") {
        event.handled = true;
        choose(player, [["Learn barbarian Farming", () => {
            if (!player.getLocation().isWithinDistance(npc.getLocation(), 5)) return;
            const training = farmFor(player).barbarian ??= { planting: 0, smashing: 0, autoSmash: false };
            if (!training.planting) { training.planting = 1; player.sendMessage("Plant a seed bare-handed, without carrying a seed dibber, then return to Otto."); }
            else if (training.planting === 1) player.sendMessage("First successfully plant a seed bare-handed. Grapes do not count.");
            else {
                training.planting = 3;
                player.getPacketSender().sendVarbit(9609, 3);
                if (player.getSkillManager().getMaxLevel(Skill.FARMING) < 15) { player.sendMessage("You need level 15 Farming to learn pot-smashing."); return; }
                if (!training.smashing) {
                    training.smashing = 1; training.autoSmash = true;
                    player.sendMessage("Plant a sapling and smash its empty pot, then return. Spirit trees do not count for training.");
                } else if (training.smashing === 1) player.sendMessage("Plant a sapling and smash its empty pot before returning.");
                else { training.smashing = 3; player.sendMessage("You have completed your barbarian Farming training."); }
                player.getPacketSender().sendVarbit(9610, training.smashing).sendVarbit(9614, training.autoSmash ? 1 : 0);
            }
        }], ["Toggle automatic pot-smashing", () => {
            if (!player.getLocation().isWithinDistance(npc.getLocation(), 5)) return;
            const training = farmFor(player).barbarian;
            if (!training?.smashing) { player.sendMessage("Learn pot-smashing first."); return; }
            training.autoSmash = !training.autoSmash;
            player.getPacketSender().sendVarbit(9614, training.autoSmash ? 1 : 0);
            player.sendMessage(`Automatic pot-smashing is ${training.autoSmash ? "enabled" : "disabled"}.`);
        }]]);
        return;
    }
    if (name === "Arno" && action === "talk-to") {
        event.handled = true;
        const farm = farmFor(player);
        choose(player, [[`${farm.disableHesporiSeeds ? "Enable" : "Disable"} Hespori seed drops`, () => {
            farm.disableHesporiSeeds = !farm.disableHesporiSeeds;
            player.sendMessage(`Hespori seed drops ${farm.disableHesporiSeeds ? "disabled" : "enabled"}.`);
        }]]);
        return;
    }
    if (/leprechaun/i.test(name)) {
        event.handled = true;
        if (action === "deposit-all") {
            for (let slot = 0; slot < player.getInventory().capacity(); slot++) storeTool(player, slot);
            return;
        }
        withdrawTools(player, npc);
        return;
    }
    if (action !== "pay" && action !== "pay-fare" && action !== "talk-to") return;
    const pos = npc.getLocation();
    const patches = CACHE.patches.filter(p => p.z === pos.getZ() && Math.abs(p.x - pos.getX()) <= 20 && Math.abs(p.y - pos.getY()) <= 20);
    const relevant = patches.filter(p => {
        const s = farmFor(player).patches[patchKey(p)];
        const c = s?.crop && CROPS.get(s.crop);
        return c && (c.payment.length || WOOD_TREES.has(c.type) || c.type === "FRUIT_TREE");
    });
    // Gardener NPCs advertise Pay; never hijack unrelated NPC conversations near a patch.
    if (!definition?.getActions()?.some(option => option?.toLowerCase() === "pay")) return;
    event.handled = true;
    if (!relevant.length) { player.sendMessage("Plant a crop before asking me to look after it."); return; }
    choose(player, relevant.map(p => {
        const state = stateFor(player, p);
        const crop = CROPS.get(state.crop);
        const remove = state.status === "grown" && (WOOD_TREES.has(crop.type) || crop.type === "FRUIT_TREE");
        return [`${remove ? "Clear" : "Protect"} ${crop.name} (${p.x}, ${p.y})`, () => {
            if (!nearPatch(player, p) || stateFor(player, p) !== state) return;
            if (remove) {
                if (!state.checked) { player.sendMessage("Check the tree's health first."); return; }
                const price = crop.type === "REDWOOD" ? 2000 : 200;
                if (player.getInventory().getAmount(itemId("Coins")) < price) { player.sendMessage(`You need ${price} coins.`); return; }
                player.getInventory().deleteNumber(itemId("Coins"), price); clearPatch(player, p); return;
            }
            if (state.protected || state.status === "dead" || state.status === "grown" || !crop.payment.length) {
                player.sendMessage("That crop does not need my protection."); return;
            }
            if (!pay(player, crop.payment)) return;
            state.protected = true;
            if (state.status === "diseased") { state.status = "growing"; state.nextAt = nextGrowth(Date.now(), crop.minutes, farmFor(player).offset); }
            player.sendMessage("I'll look after that patch for you.");
        }];
    }));
}
function pay(player: Player, payment: [number, number][]): boolean {
    const inventory = player.getInventory();
    for (const [id, amount] of payment) {
        const note = CacheDefinitions.getItem(id).note;
        if (inventory.getAmount(id) + (note >= 0 ? inventory.getAmount(note) : 0) < amount) {
            player.sendMessage(`Payment: ${payment.map(([i, n]) => `${n} ${CacheDefinitions.getItem(i).name}`).join(", ")}.`); return false;
        }
    }
    for (const [id, amount] of payment) {
        const unnoted = Math.min(amount, inventory.getAmount(id));
        if (unnoted) inventory.deleteNumber(id, unnoted);
        if (amount > unnoted) inventory.deleteNumber(CacheDefinitions.getItem(id).note, amount - unnoted);
    }
    return true;
}
export function farmingItemAction(event: PluginItemActionEvent): void {
    const { player, itemId: id } = event;
    const container = event.interfaceId === Equipment.INVENTORY_INTERFACE_ID ? player.getEquipment() : player.getInventory();
    const item = container.forSlot(event.slot);
    if (!item || item.getId() !== id) return;
    const name = CacheDefinitions.getItem(id).name;
    const action = (event.option ?? CacheDefinitions.getItem(id).inventoryActions?.[event.clickType - 1])?.toLowerCase();
    if (name === "Amulet of bounty" && ["check", "break"].includes(action)) {
        event.handled = true;
        if (action === "check") player.sendMessage(`Your amulet of bounty has ${farmFor(player).bountyCharges ?? 10} charges.`);
        else { player.getInventory().deleteAtSlot(event.slot); farmFor(player).bountyCharges = 10; }
        return;
    }
    if (name === "Ash covered tome" && action === "read") {
        event.handled = true;
        farmFor(player).ultraFertile = true;
        player.getPacketSender().sendVarbit(5960, 1);
        player.getInventory().deleteAtSlot(event.slot);
        player.sendMessage("You learn to use two volcanic ash with Fertile Soil to apply ultracompost.");
        return;
    }
    if (name === "Amulet of nature" && action === "rub") {
        event.handled = true;
        const bound = farmFor(player).boundPatch;
        const patch = CACHE.patches.find(p => patchKey(p) === bound);
        if (!patch) player.sendMessage("Use the amulet on a farming patch to bind it.");
        else {
            const state = stateFor(player, patch);
            player.sendMessage(`Your bound patch: ${state.crop ? `${CROPS.get(state.crop).name}, ${state.status}` : "empty"}.`);
        }
        return;
    }
    if (name === "Gricoller's can" && action === "check") {
        event.handled = true;
        player.sendMessage(`The can contains ${item.getMetaValue("farming:water") ?? 0} doses of water.`);
        return;
    }
    if (name === "Bottomless compost bucket" && action === "check") {
        event.handled = true;
        player.sendMessage(`The bucket contains ${item.getMetaValue("farming:charges") ?? 0} compost charges.`);
        return;
    }
    if (name === "Bottomless compost bucket" && action === "empty") {
        event.handled = true;
        choose(player, [["Discard all compost", () => {
            if (!player.getInventory().getItems().includes(item)) return;
            item.setMetaValue("farming:charges", 0).setMetaValue("farming:tier", 0);
            item.setId(ItemIdentifiers.BOTTOMLESS_COMPOST_BUCKET);
            player.getInventory().refreshItems();
        }], ["Keep the compost", () => {}]]);
        return;
    }
    for (const [produce, plural, capacity] of CONTAINERS) {
        if (!name.startsWith(`${plural}(`) || action !== "empty") continue;
        event.handled = true;
        const count = Number(name.match(/\((\d+)\)/)?.[1]);
        if (!give(player, itemId(produce), count)) return;
        player.getInventory().deleteNumber(id, 1);
        player.getInventory().addItem(new Item(itemId(capacity === 10 ? "Empty sack" : "Basket")));
        return;
    }
}
