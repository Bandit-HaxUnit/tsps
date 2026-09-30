import type { PluginApi, PluginObjectInteractionEvent, PluginItemOnObjectEvent, PluginItemOnItemEvent, PluginNpcInteractionEvent, PluginItemOnNpcEvent, PluginSpellOnObjectEvent } from "../../../../plugins/PluginTypes";
import { PluginManager } from "../../../../plugins/PluginManager";
import type { Player } from "../../../entity/impl/player/Player";
import { CacheDefinitions } from "../../../cache/CacheDefinitions";
import { ObjectDefinition } from "../../../definition/ObjectDefinition";
import { Item } from "../../../model/Item";
import { Animation } from "../../../model/Animation";
import { Skill } from "../../../model/Skill";
import { Flag } from "../../../model/Flag";
import { Location } from "../../../model/Location";
import { DialogueChainBuilder } from "../../../model/dialogues/builders/DialogueChainBuilder";
import { OptionDialogue } from "../../../model/dialogues/entries/impl/OptionDialogue";
import { CACHE, CROPS, SEEDS, Patch, Crop, patchKey, itemId, initializeFarmingData, WATERABLE, COMPOSTABLE_YIELD, WOOD_TREES } from "./FarmingData";
import { Farm, PatchState, emptyPatch, advanceFarm, nextGrowth, patchValue, startingLives, saveLifeChance, activeAnima, MINUTE } from "./FarmingModel";
import { binAction, binValue, farmingItemPair, farmingNpc, farmingItemOnNpc, farmingItemAction, growSeedlings, useBottomless, cropRewards, waterContainers, humidified } from "./FarmingServices";
import { farmingSpell, farmingButton } from "./FarmingSpells";
import { titheObject, titheItem, titheNpc, titheProcess, titheLogin, titheLogout, titheItemOnNpc } from "./FarmingTithe";
import { guildNpc, guildItemOnNpc, rewardItem, completeContract, harvestContract, storagePair, storageAction, storeCrop, guildObject } from "./FarmingGuild";
import { NpcIdentifiers } from "../../../../util/NpcIdentifiers";
import { harvestHespori, HesporiCombat, hesporiCanAttack, hesporiHitRoll, hesporiHit, hesporiInput, hesporiProcess,
    hesporiLoot, hesporiLogout, hesporiDeathDrop, hesporiNpc, hesporiCave, hesporiPlayerDeath, hesporiDamage } from "./FarmingHespori";

export const FARM_ATTRIBUTE = "farming:state";
const ANIM = { RAKE: 2273, PLANT: 2291, SAPLING: 2272, WATER: 2293, DIG: 830, HARVEST: 2282, HERB: 2286, COMPOST: 2283, CURE: 2288, PRUNE: 2275 };
type Work = { patch: Patch; action: "rake" | "harvest"; nextAt: number; position: Location };
const WORK = new WeakMap<Player, Work>();
const SYNC = new WeakMap<Player, { x: number; y: number; z: number; at: number }>();

export function farmFor(player: Player): Farm {
    let farm = player.getAttribute(FARM_ATTRIBUTE) as Farm;
    if (!farm) {
        farm = { offset: Math.floor(Math.random() * 31) * MINUTE, patches: {}, tools: {}, autoWeed: false };
        player.setAttribute(FARM_ATTRIBUTE, farm);
    }
    return farm;
}
export function stateFor(player: Player, patch: Patch): PatchState {
    const farm = farmFor(player);
    return farm.patches[patchKey(patch)] ??= emptyPatch(Date.now(), farm, ["GRAPES", "CORAL", "SEAWEED"].includes(patch.type) ? 0 : 3);
}
export function hasTool(player: Player, name: string): boolean {
    const id = itemId(name);
    return player.getInventory().contains(id) || player.getEquipment().contains(id);
}
export function requireTool(player: Player, name: string): boolean {
    if (name === "Seed dibber" && farmFor(player).barbarian?.planting === 3) return true;
    if (hasTool(player, name)) return true;
    player.sendMessage(`You need a ${name.toLowerCase()} to do that.`);
    return false;
}
export function award(player: Player, xp: number): void {
    // Keep the server's configured XP rate; the table contains unmultiplied OSRS XP.
    const worn = new Set(player.getEquipment().getItems().map(i => CacheDefinitions.getItem(i.getId()).name));
    const pieces: [boolean, number][] = [[worn.has("Farmer's strawhat"), 0.004],
        [worn.has("Farmer's jacket") || worn.has("Farmer's shirt"), 0.008],
        [worn.has("Farmer's boro trousers"), 0.006], [worn.has("Farmer's boots"), 0.002]];
    const bonus = pieces.reduce((total, [equipped, boost]) => total + (equipped ? boost : 0), 0) + (pieces.every(([equipped]) => equipped) ? 0.005 : 0);
    player.getSkillManager().addExperiences(Skill.FARMING, xp * (1 + bonus));
}
export function give(player: Player, id: number, count = 1): boolean {
    const inventory = player.getInventory();
    const stackable = CacheDefinitions.getItem(id).stackability !== 0;
    if ((!stackable && inventory.getFreeSlots() < count) || (stackable && (inventory.getAmount(id) + count > 2147483647 || inventory.isFull() && !inventory.contains(id)))) {
        inventory.full();
        return false;
    }
    inventory.addItem(new Item(id, count));
    return true;
}
export function choose(player: Player, entries: [string, () => void][], page = 0): void {
    const shown = entries.slice(page * 4, page * 4 + 4);
    if (entries.length > 4) shown.push(["More options", () => choose(player, entries, (page + 1) * 4 >= entries.length ? 0 : page + 1)]);
    player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new OptionDialogue(0, {
        executeOption(option) {
            player.getPacketSender().sendInterfaceRemoval();
            shown[Number(option)]?.[1]();
        },
    }, ...shown.map(([text]) => text))));
}
export function clearPatch(player: Player, patch: Patch): void {
    const farm = farmFor(player);
    farm.patches[patchKey(patch)] = emptyPatch(Date.now(), farm);
    syncPatch(player, patch);
}
export function syncPatch(player: Player, patch: Patch): void {
    const state = stateFor(player, patch);
    const value = patch.type.includes("COMPOST") ? binValue(patch, state) : patchValue(patch, state);
    if (value !== undefined && player.getPacketSender().getVarbit(patch.varbit) !== value) player.getPacketSender().sendVarbit(patch.varbit, value);
}
function findPatch(id: number, location: { x: number; y: number; z: number }): Patch | undefined {
    return CACHE.patches.find(p => p.id === id && p.z === location.z && location.x >= p.x && location.x <= p.maxX && location.y >= p.y && location.y <= p.maxY)
        ?? CACHE.patches.find(p => p.type === "REDWOOD" && CacheDefinitions.getObject(id).transformVarbit === p.varbit
            && Math.abs(p.x - location.x) < 12 && Math.abs(p.y - location.y) < 12);
}
function requireAxe(player: Player): boolean {
    if ([...player.getInventory().getItems(), ...player.getEquipment().getItems()].some(i => / axe(?:\b|$)/i.test(CacheDefinitions.getItem(i.getId()).name))) return true;
    player.sendMessage("You need an axe to do that."); return false;
}
function animate(player: Player, animation: number): void { player.performAnimation(new Animation(animation)); }
function gate(player: Player): boolean {
    if (!player.getClickDelay().elapsedTime(600)) return false;
    player.getClickDelay().reset();
    return true;
}
export function nearPatch(player: Player, patch: Patch): boolean {
    const loc = player.getLocation();
    return loc.getZ() === patch.z && loc.getX() >= patch.x - 16 && loc.getX() <= patch.maxX + 16 && loc.getY() >= patch.y - 16 && loc.getY() <= patch.maxY + 16;
}
function startWork(player: Player, patch: Patch, action: Work["action"]): void {
    const work = { patch, action, nextAt: Date.now(), position: player.getLocation().clone() };
    WORK.set(player, work);
    workStep(player, work);
}
function workStep(player: Player, work: Work): void {
    if (player.getHitpoints() <= 0 || player.busy() || !player.getLocation().equals(work.position) || player.getMovementQueue().isMovings()) {
        WORK.delete(player);
        return;
    }
    if (Date.now() < work.nextAt) return;
    const again = work.action === "rake" ? rake(player, work.patch) : harvest(player, work.patch);
    work.nextAt = Date.now() + 1800;
    if (!again) WORK.delete(player);
    syncPatch(player, work.patch);
}
function rake(player: Player, patch: Patch): boolean {
    const state = stateFor(player, patch);
    if (state.crop || state.scarecrow || !state.weeds || !requireTool(player, "Rake")) return false;
    if (!give(player, itemId("Weeds"))) return false;
    state.weeds--;
    state.nextAt = nextGrowth(Date.now(), 5, farmFor(player).offset);
    animate(player, ANIM.RAKE);
    award(player, 4);
    return state.weeds > 0;
}
function plant(player: Player, patch: Patch, id: number): void {
    const crop = SEEDS.get(id);
    const state = stateFor(player, patch);
    if (state.crop || state.scarecrow) { player.sendMessage("There is already something growing here."); return; }
    if (state.weeds) { player.sendMessage("You need to rake the weeds out first."); return; }
    if (!crop || crop.type !== patch.type) { player.sendMessage("That cannot be planted in this patch."); return; }
    if (player.getSkillManager().getCurrentLevel(Skill.FARMING) < crop.level) { player.sendMessage(`You need level ${crop.level} Farming to plant that.`); return; }
    const barbarian = farmFor(player).barbarian;
    const bareHanded = !crop.sapling && crop.type !== "GRAPES" && barbarian?.planting > 0 && !hasTool(player, "Seed dibber");
    if (!bareHanded && !requireTool(player, crop.sapling ? "Spade" : "Seed dibber")) return;
    if (patch.type === "GRAPES" && !state.compost) { player.sendMessage("Treat the vine patch with saltpetre first."); return; }
    if (crop.type === "SPIRIT_TREE") {
        const level = player.getSkillManager().getMaxLevel(Skill.FARMING);
        const limit = level >= 99 ? Infinity : level >= 91 ? 2 : 1;
        if (Object.values(farmFor(player).patches).filter(s => s.crop === crop.key).length >= limit) {
            player.sendMessage("You cannot grow any more spirit trees at your Farming level."); return;
        }
    }
    if (player.getInventory().getAmount(id) < crop.seedCount) { player.sendMessage(`You need ${crop.seedCount} seeds to plant this crop.`); return; }
    // ponytail: the training failure rate is unpublished; use an even roll until measured.
    if (bareHanded && barbarian.planting === 1 && Math.random() < 0.5) {
        player.getInventory().deleteNumber(id, crop.seedCount);
        player.sendMessage("You crush the seeds while trying to plant them bare-handed."); return;
    }
    let seedCount = crop.seedCount;
    if (patch.type === "ALLOTMENT" && player.getEquipment().contains(itemId("Amulet of bounty")) && Math.random() < 0.25) {
        seedCount = 1;
        const farm = farmFor(player);
        farm.bountyCharges = (farm.bountyCharges ?? 10) - 1;
        if (!farm.bountyCharges) {
            player.getEquipment().deleteNumber(itemId("Amulet of bounty"), 1).refreshItems();
            player.getUpdateFlag().flag(Flag.APPEARANCE);
            farm.bountyCharges = 10;
            player.sendMessage("Your amulet of bounty crumbles to dust.");
        } else player.sendMessage("Your amulet of bounty saves two seeds.");
    }
    player.getInventory().deleteNumber(id, seedCount);
    if (crop.sapling) {
        if (barbarian?.smashing && barbarian.autoSmash) {
            player.sendMessage("You smash the empty plant pot to dust.");
            if (barbarian.smashing === 1 && crop.type !== "SPIRIT_TREE") barbarian.smashing = 2;
        } else player.getInventory().addItem(new Item(itemId("Plant pot")));
    }
    if (bareHanded && barbarian.planting === 1) {
        barbarian.planting = 2;
        player.sendMessage("You feel you have learned more of barbarian ways. Otto might wish to talk to you more.");
    }
    Object.assign(state, { crop: crop.key, stage: 0, status: "growing", checked: false, protected: false, watered: false,
        lives: 0, plantedAt: Date.now(), nextAt: nextGrowth(Date.now(), crop.minutes, farmFor(player).offset) });
    // Herbs award their planting XP only after the final herb is picked.
    if (crop.type !== "HERB") award(player, crop.plant);
    animate(player, crop.sapling ? ANIM.SAPLING : ANIM.PLANT);
    player.sendMessage(`You plant the ${crop.name.toLowerCase()}.`);
}
export function water(player: Player, id?: number): boolean {
    const inventory = player.getInventory();
    const can = inventory.getItems().find(i => (!id || i.getId() === id) && (CacheDefinitions.getItem(i.getId()).name?.match(/^Watering can\([1-8]\)$/)
        || i.getId() === itemId("Magic watering can") || i.getId() === itemId("Gricoller's can")));
    if (!can) { player.sendMessage("You need a watering can containing water."); return false; }
    const name = CacheDefinitions.getItem(can.getId()).name;
    if (name === "Gricoller's can") {
        const charges = Number(can.getMetaValue("farming:water") ?? 0);
        if (!charges) { player.sendMessage("Your can is empty."); return false; }
        can.setMetaValue("farming:water", charges - 1);
    }
    const charges = name.match(/^Watering can\(([1-8])\)$/);
    if (charges) can.setId(itemId(+charges[1] === 1 ? "Watering can" : `Watering can(${+charges[1] - 1})`));
    inventory.refreshItems();
    animate(player, ANIM.WATER);
    return true;
}
function waterPatch(player: Player, patch: Patch, id?: number): void {
    const state = stateFor(player, patch);
    if (!state.crop || state.status !== "growing" || !WATERABLE.has(patch.type)) { player.sendMessage("This patch does not need watering."); return; }
    if (state.watered) { player.sendMessage("This crop is already watered."); return; }
    if (water(player, id)) state.watered = true;
}
export function fertilize(player: Player, patch: Patch, tier: number, consume = true): boolean {
    const state = stateFor(player, patch);
    if (state.weeds || state.compost || state.status === "dead" || ["ANIMA", "GRAPES", "CORAL"].includes(patch.type)) {
        player.sendMessage(state.compost ? "This patch has already been treated." : "You cannot compost this patch now."); return false;
    }
    if (consume) {
        const id = itemId(["", "Compost", "Supercompost", "Ultracompost"][tier]);
        if (!player.getInventory().contains(id)) return false;
        player.getInventory().deleteNumber(id, 1);
        player.getInventory().addItem(new Item(itemId("Bucket")));
    }
    state.compost = tier;
    if (state.status === "grown" && COMPOSTABLE_YIELD.has(patch.type)) state.lives += tier;
    award(player, [0, 18, 26, 36][tier]);
    animate(player, ANIM.COMPOST);
    syncPatch(player, patch);
    return true;
}
export function cure(player: Player, patch: Patch, useItem = true): boolean {
    const state = stateFor(player, patch);
    if (useItem && state.crop === "WILLOW" && state.status === "grown" && state.checked && !state.stump) {
        if (!hasTool(player, "Secateurs") && !requireTool(player, "Magic secateurs")) return false;
        const now = Date.now();
        const elapsed = Math.floor((now - (state.branchAt ?? now)) / (5 * MINUTE));
        state.branches = Math.min(6, (state.branches ?? 6) + elapsed);
        state.branchAt = (state.branchAt ?? now) + elapsed * 5 * MINUTE;
        if (!state.branches) { player.sendMessage("There are no branches ready to cut yet."); return false; }
        if (!give(player, itemId("Willow branch"))) return false;
        state.branches--; animate(player, ANIM.PRUNE); return true;
    }
    if (state.status !== "diseased") { player.sendMessage("This plant is not diseased."); return false; }
    if (useItem) {
        const pruning = ["TREE", "FRUIT_TREE", "BUSH", "HARDWOOD_TREE", "SPIRIT_TREE", "CALQUAT", "CELASTRUS", "REDWOOD", "CORAL"].includes(patch.type)
            && (hasTool(player, "Secateurs") || hasTool(player, "Magic secateurs"));
        if (!pruning) {
            if (!player.getInventory().contains(itemId("Plant cure"))) { player.sendMessage("You need plant cure to cure this plant."); return false; }
            player.getInventory().deleteNumber(itemId("Plant cure"), 1);
            player.getInventory().addItem(new Item(itemId("Vial")));
        }
        animate(player, pruning ? ANIM.PRUNE : ANIM.CURE);
        if (pruning && Math.random() < 0.25) { player.sendMessage("There are still some diseased leaves left."); return false; }
    }
    state.status = "growing";
    state.nextAt = nextGrowth(Date.now(), CROPS.get(state.crop).minutes, farmFor(player).offset);
    syncPatch(player, patch);
    return true;
}
function healthCheck(player: Player, patch: Patch): void {
    const state = stateFor(player, patch);
    const crop = CROPS.get(state.crop);
    if (!crop || state.status !== "grown" || state.checked) return;
    state.checked = true;
    award(player, crop.check);
    cropRewards(player, crop);
    player.sendMessage(`The ${crop.name.toLowerCase()} is healthy.`);
    PluginManager.emitCustomEvent("farming:check-health", { player, crop: crop.key, patch });
}
function harvest(player: Player, patch: Patch): boolean {
    const state = stateFor(player, patch);
    const crop = CROPS.get(state.crop);
    if (!crop || state.status !== "grown") return false;
    if (crop.check && !state.checked) { healthCheck(player, patch); return false; }
    if (crop.type === "HESPORI") { harvestHespori(player, patch); return false; }
    if (crop.produce < 0 || WOOD_TREES.has(crop.type) || state.lives <= 0) return false;
    if (["CRYSTAL_TREE", "CELASTRUS"].includes(crop.type) && !requireAxe(player)) return false;
    if (["ALLOTMENT", "HERB", "HOPS", "BELLADONNA"].includes(crop.type) && !requireTool(player, "Spade")) return false;
    const level = player.getSkillManager().getCurrentLevel(Skill.FARMING);
    if (crop.type === "BELLADONNA" && !player.getEquipment().getItems().some(i => /gloves|gauntlets|vambraces/i.test(CacheDefinitions.getItem(i.getId()).name))) {
        player.sendMessage("You need to wear gloves to pick poisonous nightshade."); return false;
    }
    const attas = activeAnima(farmFor(player), Date.now()) === "ATTAS";
    let amount = crop.key === "WOAD" ? 3 : crop.key === "LIMPWURT" ? 3 + Math.floor(Math.floor(Math.random() * level) * (hasTool(player, "Magic secateurs") ? 1.1 : 1) * (attas ? 1.05 : 1) / 10)
        // ponytail: uniform belladonna roll matches published level bounds; refine its distribution when published.
        : crop.type === "BELLADONNA" ? 6 + Math.floor(Math.random() * (Math.floor(level / 8) + 1))
        : crop.type === "CRYSTAL_TREE" ? 16 + state.compost * 4 + Math.floor(Math.random() * 5) : 1;
    let produce = crop.produce;
    const blessing = crop.type === "GRAPES" && player.getInventory().contains(itemId("Bologa's blessing"));
    if (blessing) produce = itemId("Zamorak's grapes");
    const sack = crop.type === "HERB" && player.getInventory().getItems().find(i => i.getId() === itemId("Open herb sack"));
    if (!(sack && storeCrop(player, sack, produce, amount)) && !give(player, produce, amount)) return false;
    if (blessing) player.getInventory().deleteNumber(itemId("Bologa's blessing"), 1);
    animate(player, patch.type === "HERB" ? ANIM.HERB : ANIM.HARVEST);
    award(player, crop.harvest * (["FLOWER", "BELLADONNA"].includes(crop.type) ? 1 : amount));
    const variable = COMPOSTABLE_YIELD.has(crop.type) || ["BUSH", "CACTUS", "GRAPES", "CORAL"].includes(crop.type);
    const cape = player.getEquipment().contains(itemId("Farming cape")) || player.getEquipment().contains(itemId("Farming cape(t)"));
    const vars = player.getPacketSender();
    const diary = crop.type !== "HERB" ? 0 : patch.x === 2813 && patch.y === 3463
        ? vars.getVarbit(4478) ? 25 : vars.getVarbit(4477) ? 17 : vars.getVarbit(4476) ? 10 : 0
        : [1738, 1238].includes(patch.x) && vars.getVarbit(7927) ? 10 : 0;
    const chance = saveLifeChance(crop, level, hasTool(player, "Magic secateurs"), cape, diary, attas);
    if (!variable || Math.random() >= chance) state.lives--;
    if (["FLOWER", "BELLADONNA", "CRYSTAL_TREE"].includes(crop.type)) state.lives = 0;
    if (state.lives === 0) {
        if (crop.type === "HERB") award(player, crop.plant);
        if (!crop.check) cropRewards(player, crop);
        PluginManager.emitCustomEvent("farming:harvest", { player, crop: crop.key, patch });
        if (crop.type === "GRAPES") state.status = "dead";
        else if (!crop.regrow && crop.type !== "CELASTRUS") clearPatch(player, patch);
        return false;
    }
    return true;
}
function dig(player: Player, patch: Patch): void {
    const state = stateFor(player, patch);
    if (!requireTool(player, "Spade")) return;
    if (state.scarecrow) {
        if (give(player, itemId("Scarecrow"))) { state.scarecrow = false; syncPatch(player, patch); }
        return;
    }
    if (!state.crop) return;
    const crop = CROPS.get(state.crop);
    if (crop.type === "REDWOOD" && state.status === "grown") { player.sendMessage("Ask Alexandra to remove the redwood tree."); return; }
    if (state.status === "dead" || state.stump) {
        if (state.stump && crop.type === "TREE") {
            const roots = 1 + Math.min(3, Math.floor((player.getSkillManager().getCurrentLevel(Skill.FARMING) - crop.level) / 15));
            if (!give(player, itemId(`${crop.name} roots`), Math.max(1, roots))) return;
        }
        clearPatch(player, patch); animate(player, ANIM.DIG); return;
    }
    if ((WOOD_TREES.has(crop.type) || crop.type === "FRUIT_TREE") && state.status === "grown") {
        player.sendMessage("Chop the tree down before digging out the stump, or pay a gardener to remove it."); return;
    }
    choose(player, [["Yes, dig up this crop", () => {
        if (!nearPatch(player, patch) || stateFor(player, patch) !== state || !requireTool(player, "Spade")) return;
        clearPatch(player, patch);
        animate(player, ANIM.DIG);
    }], [`Leave the ${crop.name.toLowerCase()} growing`, () => {}]]);
}
function inspect(player: Player, patch: Patch): void {
    const state = stateFor(player, patch);
    const crop = CROPS.get(state.crop);
    player.sendMessage(crop ? `${crop.name}: ${state.status}${state.protected ? ", protected by a gardener" : ""}.`
        : state.scarecrow ? "A scarecrow protects nearby sweetcorn." : state.weeds ? "This patch needs weeding." : "This patch is ready for planting.");
    player.sendMessage(`Soil: ${["untreated", "compost", "supercompost", "ultracompost"][state.compost]}.${state.watered ? " The crop is watered." : ""}`);
}
function objectInteraction(event: PluginObjectInteractionEvent): void {
    const { player, object, location } = event;
    WORK.delete(player);
    hesporiCave(event);
    if (!event.handled) titheObject(event);
    if (!event.handled) guildObject(event);
    if (event.handled) return;
    if (location.x === 1224 && location.y === 3755 && event.definition?.getName() === "Rope ladder") {
        event.handled = true;
        const redwood = CACHE.patches.find(p => p.type === "REDWOOD");
        if (location.z === 0 && !stateFor(player, redwood).checked) { player.sendMessage("The redwood tree must be fully grown and health-checked first."); return; }
        player.moveTo(new Location(1225, 3755, location.z === 0 ? 1 : 0)); return;
    }
    const patch = findPatch(object.getId(), location);
    if (!patch) return;
    event.handled = true;
    advanceFarm(farmFor(player), Date.now());
    if (!gate(player)) return;
    const action = ObjectDefinition.forPlayer(object.getId(), player)?.getInteractions()?.[event.clickType - 1]?.toLowerCase() ?? "";
    if (patch.type.includes("COMPOST")) { binAction(player, patch, action); syncPatch(player, patch); return; }
    const state = stateFor(player, patch);
    if (action === "rake") startWork(player, patch, "rake");
    else if (action === "inspect") inspect(player, patch);
    else if (action === "guide") player.sendMessage(`This patch grows: ${[...CROPS.values()].filter(c => c.type === patch.type).map(c => `${c.name} (${c.level})`).join(", ")}.`);
    else if (action === "check-health") healthCheck(player, patch);
    else if (action === "water") waterPatch(player, patch);
    else if (action === "cure" || action === "prune") cure(player, patch);
    else if (action === "clear" && state.hesporiLoot) harvestHespori(player, patch);
    else if (["clear", "dig-up", "dig", "remove"].includes(action)) dig(player, patch);
    else if (action === "travel" && state.checked) spiritTravel(player);
    else if (action === "chop-down" && patch.type === "CRYSTAL_TREE") startWork(player, patch, "harvest");
    else if (action === "chop" && patch.type === "CELASTRUS" && state.status === "grown" && !state.lives && requireAxe(player)) {
        state.stump = true; state.nextAt = Number.MAX_SAFE_INTEGER; animate(player, 879);
    }
    else if ((["chop-down", "chop down", "chop"].includes(action) || action === "cut" && patch.type === "REDWOOD") && state.status === "grown" && state.checked) {
        const crop = CROPS.get(state.crop);
        PluginManager.emitCustomEvent("woodcutting:chop", { player, object, logId: WOOD_TREES.has(patch.type) ? crop.produce : itemId("Logs"), removeOnly: patch.type === "FRUIT_TREE", handled: false });
    }
    else if (["harvest", "pick", "pick-from", "collect", "pick-fruit", "pick-apple", "pick-banana", "pick-orange", "pick-leaf", "pick-pineapple", "pick-papaya", "pick-coconut", "pick-dragonfruit", "pick-spine", "pick-cactus", "take", "cut"].includes(action)) startWork(player, patch, "harvest");
    else inspect(player, patch);
    syncPatch(player, patch);
}
function itemOnObject(event: PluginItemOnObjectEvent): void {
    const { player, itemId: id, object, location } = event;
    WORK.delete(player);
    titheItem(event);
    if (event.handled) return;
    const patch = findPatch(object.getId(), location);
    if (!patch) {
        const name = ObjectDefinition.forPlayer(object.getId(), player)?.getName()?.toLowerCase() ?? "";
        if (/hay(?: bale|stack)?/.test(name) && id === itemId("Empty sack")) {
            event.handled = true;
            player.getInventory().deleteAtSlot(event.itemSlot);
            player.getInventory().addItem(new Item(itemId("Hay sack"))); return;
        }
        if (["fountain", "sink", "waterpump", "water barrel", "well"].includes(name) && /^(?:Watering can(?:\([1-8]\))?|Gricoller's can)$/.test(CacheDefinitions.getItem(id).name)) {
            event.handled = true;
            if (player.getInventory().forSlot(event.itemSlot)?.getId() === id) {
                const can = player.getInventory().forSlot(event.itemSlot);
                if (CacheDefinitions.getItem(id).name === "Gricoller's can") can.setMetaValue("farming:water", 1000);
                else can.setId(itemId("Watering can(8)"));
                player.getInventory().refreshItems();
            }
        }
        return;
    }
    event.handled = true;
    if (!gate(player) || !player.getInventory().contains(id)) return;
    advanceFarm(farmFor(player), Date.now());
    const state = stateFor(player, patch);
    if (patch.type.includes("COMPOST")) { binAction(player, patch, "", id); syncPatch(player, patch); return; }
    if (SEEDS.has(id)) plant(player, patch, id);
    else if (id === itemId("Rake")) startWork(player, patch, "rake");
    else if (id === itemId("Spade") && patch.type === "HESPORI" && state.status === "grown") harvestHespori(player, patch);
    else if (id === itemId("Spade")) dig(player, patch);
    else if (id === itemId("Plant cure") || id === itemId("Secateurs") || id === itemId("Magic secateurs")) cure(player, patch);
    else if (/^Watering can\(|^Magic watering can$|^Gricoller's can$/.test(CacheDefinitions.getItem(id).name)) waterPatch(player, patch, id);
    else if (CacheDefinitions.getItem(id).name === "Bottomless compost bucket") useBottomless(player, patch, id);
    else if (id === itemId("Amulet of nature")) {
        farmFor(player).boundPatch = patchKey(patch);
        farmFor(player).boundStatus = state.crop ? state.status : "empty";
        player.sendMessage("You bind the amulet to this patch.");
    }
    else if (["Compost", "Supercompost", "Ultracompost"].some((name, i) => id === itemId(name) && fertilize(player, patch, i + 1))) { /* applied */ }
    else if (id === itemId("Saltpetre") && patch.type === "GRAPES" && !state.crop && !state.compost && requireTool(player, "Gardening trowel")) {
        player.getInventory().deleteNumber(id, 1); state.compost = 1;
    } else if (id === itemId("Scarecrow") && patch.type === "FLOWER" && !state.crop && !state.weeds && !state.scarecrow) {
        if (player.getSkillManager().getCurrentLevel(Skill.FARMING) < 23) { player.sendMessage("You need level 23 Farming."); return; }
        player.getInventory().deleteNumber(id, 1); state.scarecrow = true;
    } else if (id === itemId("Plant pot") && !state.crop && !state.weeds && requireTool(player, "Gardening trowel")) {
        player.getInventory().deleteNumber(id, 1); player.getInventory().addItem(new Item(itemId("Filled plant pot")));
    } else player.sendMessage("Nothing interesting happens.");
    syncPatch(player, patch);
}
function itemOnItem(event: PluginItemOnItemEvent): void { WORK.delete(event.player); storagePair(event); if (!event.handled) farmingItemPair(event); }
function npcInteraction(event: PluginNpcInteractionEvent): void {
    WORK.delete(event.player);
    hesporiNpc(event);
    if (!event.handled) titheNpc(event);
    if (!event.handled) guildNpc(event);
    if (!event.handled) farmingNpc(event);
}
function itemOnNpc(event: PluginItemOnNpcEvent): void {
    WORK.delete(event.player);
    titheItemOnNpc(event);
    if (!event.handled) guildItemOnNpc(event);
    if (!event.handled) farmingItemOnNpc(event);
}
function spellOnObject(event: PluginSpellOnObjectEvent): void {
    WORK.delete(event.player);
    const patch = findPatch(event.object.getId(), event.location);
    if (patch) farmingSpell(event, patch);
}
function spiritTravel(player: Player): void {
    const farm = farmFor(player);
    choose(player, CACHE.patches.filter(p => p.type === "SPIRIT_TREE" && farm.patches[patchKey(p)]?.checked)
        .map(p => [`Spirit tree (${p.x}, ${p.y})`, () => player.moveTo(new Location(p.x - 1, p.y, p.z))]));
}
function validateTree(event: { player: Player; object: any; allow: boolean }): void {
    const pos = event.object.getLocation();
    const patch = findPatch(event.object.getId(), { x: pos.getX(), y: pos.getY(), z: pos.getZ() });
    if (!patch) return;
    const state = stateFor(event.player, patch);
    event.allow = state.status === "grown" && state.checked && !state.stump;
}
function depleteTree(event: { player: Player; object: any; respawnTicks: number; handled: boolean }): void {
    const pos = event.object.getLocation();
    const patch = findPatch(event.object.getId(), { x: pos.getX(), y: pos.getY(), z: pos.getZ() });
    if (!patch) return;
    event.handled = true;
    const state = stateFor(event.player, patch);
    state.stump = true;
    state.nextAt = Date.now() + event.respawnTicks * 600;
    syncPatch(event.player, patch);
}
function playerProcess({ player }: { player: Player }): void {
    const previous = SYNC.get(player);
    const pos = player.getLocation();
    const now = Date.now();
    const grow = !previous || now - previous.at >= 5000;
    if (grow || previous.x !== pos.getX() || previous.y !== pos.getY() || previous.z !== pos.getZ()) {
        const farm = farmFor(player);
        if (grow) {
            if (player.getPacketSender().getVarbit(7925)) farm.hosidiusProtected = true;
            if (player.getPacketSender().getVarbit(4465)) farm.faladorProtected = true;
            if (player.getPacketSender().getVarp(4130) >= 16000) farm.fortisProtected = true;
            advanceFarm(farm, now); growSeedlings(player, now);
            const bound = farm.patches[farm.boundPatch];
            const status = bound?.crop ? bound.status : "empty";
            if (farm.boundStatus !== status && ["diseased", "dead", "grown"].includes(status) && hasTool(player, "Amulet of nature")) {
                player.sendMessage(`Your amulet of nature hums: the crop in your bound patch is ${status}.`);
            }
            farm.boundStatus = status;
        }
        const nearest = new Map<number, { patch: Patch; distance: number }>();
        for (const patch of CACHE.patches) {
            if (patch.z !== pos.getZ()) continue;
            const distance = Math.max(Math.abs((patch.x + patch.maxX) / 2 - pos.getX()), Math.abs((patch.y + patch.maxY) / 2 - pos.getY()));
            if (distance <= 64 && (!nearest.has(patch.varbit) || nearest.get(patch.varbit).distance > distance)) nearest.set(patch.varbit, { patch, distance });
        }
        for (const { patch } of nearest.values()) syncPatch(player, patch);
        SYNC.set(player, { x: pos.getX(), y: pos.getY(), z: pos.getZ(), at: grow ? now : previous.at });
    }
    const work = WORK.get(player);
    if (work) workStep(player, work);
}
function login(event: { player: Player }): void {
    for (const state of Object.values(farmFor(event.player).patches)) state.hesporiFight = false;
    SYNC.delete(event.player); playerProcess(event);
}
function logout({ player }: { player: Player }): void { WORK.delete(player); SYNC.delete(player); hesporiLogout({ player }); }
function cancelWork({ player }: { player: Player }): void { WORK.delete(player); }

export const name = "Farming";
export function register(api: PluginApi): void {
    api.persistAttribute(FARM_ATTRIBUTE);
    api.onServerStartup(initializeFarmingData);
    api.onPlayerLogin(login);
    api.onPlayerLogin(titheLogin);
    api.onPlayerProcess(playerProcess);
    api.onPlayerProcess(hesporiProcess);
    api.onPlayerProcess(titheProcess);
    api.onPlayerLogout(logout);
    api.onPlayerLogout(titheLogout);
    api.onPlayerLevelUp(cancelWork);
    api.onObjectInteraction(objectInteraction);
    api.onItemOnObject(itemOnObject, { noted: false });
    api.onItemOnItem(itemOnItem, { noted: false });
    api.onNpcInteraction(npcInteraction);
    api.onItemOnNpc(itemOnNpc);
    api.onItemAction(farmingItemAction);
    api.onItemAction(rewardItem);
    api.onItemAction(storageAction);
    api.onSpellOnObject(spellOnObject);
    api.onButtonClick(farmingButton);
    api.onCustomEvent("woodcutting:validate-tree", validateTree);
    api.onCustomEvent("farming:check-health", completeContract);
    api.onCustomEvent("farming:harvest", harvestContract);
    api.onCustomEvent("woodcutting:deplete-tree", depleteTree);
    api.onCustomEvent("magic:water-containers", waterContainers);
    api.onCustomEvent("magic:humidified", humidified);
    api.onCustomEvent("player:world-input", hesporiInput);
    api.onCustomEvent("player:world-input", cancelWork);
    api.onCustomEvent("npc-drops:generated", hesporiLoot);
    api.onCanAttack(hesporiCanAttack);
    api.onCombatHitRoll(hesporiHitRoll);
    api.onCombatHitResolved(hesporiHit);
    api.onPlayerDealtDamage(hesporiDamage);
    api.onPlayerDeathItemDrop(hesporiDeathDrop);
    api.onPlayerDeath(hesporiPlayerDeath);
    api.registerNpcCombatMethodProvider(NpcIdentifiers.HESPORI, HesporiCombat, { singleton: false });
}
