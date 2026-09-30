import type { Player } from "../../../entity/impl/player/Player";
import { GameObject } from "../../../entity/impl/object/GameObject";
import { ObjectManager } from "../../../entity/impl/object/ObjectManager";
import { PrivateArea } from "../../../model/areas/impl/PrivateArea";
import { Boundary } from "../../../model/Boundary";
import { Location } from "../../../model/Location";
import { Animation } from "../../../model/Animation";
import { Skill } from "../../../model/Skill";
import { CacheDefinitions } from "../../../cache/CacheDefinitions";
import { ObjectIdentifiers as Objects } from "../../../../util/ObjectIdentifiers";
import { PluginManager } from "../../../../plugins/PluginManager";
import { CACHE, itemId } from "./FarmingData";
import { advanceTithe, TithePlant, titheDeposit } from "./FarmingModel";
import { farmFor, give, choose, award, water, requireTool } from "./FarmingPlugin";
import { giveSeedPack } from "./FarmingGuild";

const CROPS = [
    { name: "Golovanova", level: 34, xp: 6, object: Objects.GOLOVANOVA_SEEDLING },
    { name: "Bologano", level: 54, xp: 14, object: Objects.BOLOGANO_SEEDLING },
    { name: "Logavano", level: 74, xp: 23, object: Objects.LOGAVANO_SEEDLING },
];
const REWARDS: [string, number, number?][] = [["Farmer's strawhat", 75], ["Farmer's jacket", 150], ["Farmer's shirt", 150],
    ["Farmer's boro trousers", 125], ["Farmer's boots", 50], ["Compost", 1], ["Supercompost", 5], ["Grape seed", 2],
    ["Gricoller's can", 200], ["Seed box", 250], ["Herb sack", 250], ["Herb box", 30], ["Seed pack", 30], ["Bologa's blessing", 1, 20]];
class TitheArea extends PrivateArea {
    constructor() { super([new Boundary(1805, 1840, 3485, 3518, 0)]); }
}
type Plot = { base: typeof CACHE.scenery[number]; plant?: TithePlant; object?: GameObject };
type Game = { area: TitheArea; plots: Map<string, Plot> };
const GAMES = new WeakMap<Player, Game>();
function scoreFor(player: Player) { return farmFor(player).tithe ??= { points: 0, score: 0 }; }
function inField(player: Player): boolean {
    const p = player.getLocation();
    return p.getX() > 1805 && p.getX() <= 1840 && p.getY() >= 3485 && p.getY() <= 3518 && p.getZ() === 0;
}
function sync(player: Player): void {
    const score = scoreFor(player);
    player.getPacketSender().sendVarbit(4893, score.points).sendVarbit(4900, score.score);
}
function enter(player: Player): void {
    const area = new TitheArea();
    player.getArea()?.leave(player, false);
    area.enter(player);
    const plots = new Map<string, Plot>();
    for (const base of CACHE.scenery.filter(p => p.id === Objects.TITHE_PATCH && p.y >= 3485)) plots.set(`${base.x}:${base.y}`, { base });
    GAMES.set(player, { area, plots });
    player.getPacketSender().sendVarbit(4909, 1);
    sync(player);
}
function redraw(game: Game, plot: Plot): void {
    const p = plot.plant;
    const id = !p ? Objects.TITHE_PATCH : CROPS[p.crop].object + (p.stage === 3 ? 9 : p.stage * 3 + (p.dead ? 2 : p.watered ? 1 : 0));
    if (plot.object?.getId() === id) return;
    if (plot.object) {
        ObjectManager.deregister(plot.object, false);
        game.area.detach(plot.object);
    }
    const b = plot.base;
    plot.object = new GameObject(id, new Location(b.x, b.y, b.z), b.shape, b.face, game.area);
    ObjectManager.register(plot.object, true);
}
export function titheLogin({ player }: { player: Player }): void { if (inField(player)) enter(player); }
export function titheLogout({ player }: { player: Player }): void {
    const game = GAMES.get(player);
    if (!game) return;
    GAMES.delete(player);
    if (player.getArea() === game.area) game.area.leave(player, true);
    else game.area.destroy();
}
function leave(player: Player): void {
    titheLogout({ player });
    const inventory = player.getInventory();
    for (const crop of CROPS) for (const suffix of [" seed", " fruit"]) inventory.deleteNumber(itemId(crop.name + suffix), inventory.getAmount(itemId(crop.name + suffix)));
    inventory.deleteNumber(itemId("Gricoller's fertiliser"), inventory.getAmount(itemId("Gricoller's fertiliser")));
    scoreFor(player).score = 0;
    sync(player);
}
export function titheProcess({ player }: { player: Player }): void {
    const game = GAMES.get(player);
    if (!game) return;
    if (!inField(player) || player.getArea() !== game.area) { leave(player); return; }
    for (const plot of game.plots.values()) if (plot.plant) { advanceTithe(plot.plant, Date.now()); redraw(game, plot); }
}
export function titheObject(event: any): void {
    const { player, object } = event;
    const id = object.getId();
    if (id === Objects.FARM_DOOR) {
        event.handled = true;
        if (inField(player)) {
            choose(player, [["Leave and discard this batch", () => {
                if (!player.getLocation().isWithinDistance(object.getLocation(), 3)) return;
                leave(player); player.moveTo(new Location(1804, 3501, 0));
            }], ["Stay", () => {}]]);
        } else if (player.getSkillManager().getCurrentLevel(Skill.FARMING) < 34) player.sendMessage("You need level 34 Farming to enter.");
        else if (!CROPS.some(c => player.getInventory().contains(itemId(c.name + " seed")))) player.sendMessage("Take some seeds from the table first.");
        else {
            enter(player); player.moveTo(new Location(1806, 3501, 0));
            if (!player.getInventory().contains(itemId("Gricoller's fertiliser"))) give(player, itemId("Gricoller's fertiliser"));
        }
        return;
    }
    if (id === Objects.SEED_TABLE) {
        event.handled = true;
        choose(player, CROPS.map(c => [`${c.name} seeds (level ${c.level})`, () => {
            if (!player.getLocation().isWithinDistance(object.getLocation(), 4)) return;
            if (player.getSkillManager().getCurrentLevel(Skill.FARMING) < c.level) { player.sendMessage(`You need level ${c.level} Farming.`); return; }
            if (CROPS.some(other => other !== c && (player.getInventory().contains(itemId(other.name + " seed")) || player.getInventory().contains(itemId(other.name + " fruit"))))) {
                player.sendMessage("You can only use one type of seed at a time."); return;
            }
            choose(player, [100, 1000, 10000].map(amount => [`Take ${amount}`, () => {
                if (!player.getLocation().isWithinDistance(object.getLocation(), 4)) return;
                if (CROPS.some(other => other !== c && player.getInventory().contains(itemId(other.name + " seed")))) return;
                const count = Math.min(amount, 10000 - player.getInventory().getAmount(itemId(c.name + " seed")));
                if (count > 0) give(player, itemId(c.name + " seed"), count);
            }]));
        }]));
        return;
    }
    const game = GAMES.get(player);
    if (!game) return;
    if ([Objects.SACK_16, Objects.SACK_17].includes(id)) {
        event.handled = true;
        const crop = CROPS.find(c => player.getInventory().contains(itemId(c.name + " fruit")));
        if (!crop) { player.sendMessage("You have no fruit to deposit."); return; }
        const score = scoreFor(player), fruit = itemId(crop.name + " fruit");
        const result = titheDeposit(score.score, player.getInventory().getAmount(fruit), crop.xp);
        player.getInventory().deleteNumber(fruit, result.count);
        score.score = result.score;
        score.points = Math.min(16000, score.points + result.points);
        award(player, result.xp);
        player.getSkillManager().addExperiences(Skill.FARMING, result.bonus);
        sync(player);
        player.sendMessage(`You have ${score.score} fruit in the sack and ${score.points} reward points.`);
        return;
    }
    const plot = game.plots.get(`${event.location.x}:${event.location.y}`);
    if (!plot) return;
    event.handled = true;
    titheProcess({ player });
    const plant = plot.plant;
    if (!plant) return;
    if (plant.dead) { if (requireTool(player, "Spade")) { plot.plant = undefined; player.performAnimation(new Animation(830)); } }
    else if (plant.stage === 3) {
        if (give(player, itemId(CROPS[plant.crop].name + " fruit"))) {
            award(player, CROPS[plant.crop].xp);
            PluginManager.emitCustomEvent("farming:success", { player, petChance: 7494000 - player.getSkillManager().getMaxLevel(Skill.FARMING) * 25 });
            player.performAnimation(new Animation(2282));
            plot.plant = undefined;
        }
    } else if (!plant.watered && water(player)) plant.watered = true;
    redraw(game, plot);
}
export function titheItem(event: any): void {
    const game = GAMES.get(event.player);
    const plot = game?.plots.get(`${event.location.x}:${event.location.y}`);
    if (!plot) return;
    event.handled = true;
    const { player, itemId: id } = event;
    if (player.getInventory().forSlot(event.itemSlot)?.getId() !== id) return;
    titheProcess({ player });
    const crop = CROPS.findIndex(c => id === itemId(c.name + " seed"));
    if (crop >= 0 && !plot.plant) {
        if (player.getSkillManager().getCurrentLevel(Skill.FARMING) < CROPS[crop].level || !requireTool(player, "Seed dibber")) return;
        player.getInventory().deleteNumber(id, 1);
        plot.plant = { crop, stage: 0, watered: false, dead: false, fertilized: false, nextAt: Date.now() + 60000 };
        player.performAnimation(new Animation(2291));
    } else if (plot.plant && id === itemId("Spade")) {
        plot.plant = undefined; player.performAnimation(new Animation(830));
    } else if (plot.plant && !plot.plant.dead && plot.plant.stage < 3) {
        if (id === itemId("Gricoller's fertiliser") && !plot.plant.fertilized) {
            plot.plant.fertilized = true;
            plot.plant.nextAt = Date.now() + Math.max(0, plot.plant.nextAt - Date.now()) / 2;
            player.performAnimation(new Animation(2283));
        } else if (/watering can|Gricoller's can/i.test(CacheDefinitions.getItem(id).name) && !plot.plant.watered && water(player, id)) plot.plant.watered = true;
    }
    redraw(game, plot);
}
export function titheItemOnNpc(event: any): void {
    if (event.target.getDefinition()?.getName() !== "Farmer Gricoller") return;
    const reward = REWARDS.find(([name]) => name.startsWith("Farmer's") && itemId(name) === event.itemId);
    if (!reward) return;
    event.handled = true;
    const { player } = event, refund = Math.floor(reward[1] * 0.8);
    choose(player, [[`Return ${reward[0]} for ${refund} points`, () => {
        if (!player.getLocation().isWithinDistance(event.target.getLocation(), 5) || player.getInventory().forSlot(event.slot)?.getId() !== event.itemId) return;
        const score = scoreFor(player);
        if (score.points + refund > 16000) { player.sendMessage("Spend some reward points first."); return; }
        player.getInventory().deleteAtSlot(event.slot);
        score.points += refund; sync(player);
    }], ["Keep the item", () => {}]]);
}
export function titheNpc(event: any): void {
    if (event.definition?.getName() === "Bologa") {
        event.handled = true;
        const { player } = event, score = scoreFor(player);
        if (score.bologa) { player.sendMessage("You may buy my blessings from Farmer Gricoller."); return; }
        choose(player, [["Unlock grape blessings (75,000 coins)", () => {
            if (score.bologa || !player.getLocation().isWithinDistance(event.npc.getLocation(), 5)) return;
            if (player.getSkillManager().getCurrentLevel(Skill.PRAYER) < 50) { player.sendMessage("You need level 50 Prayer."); return; }
            if (!player.getEquipment().getItems().some(i => /zamorak|unholy/i.test(CacheDefinitions.getItem(i.getId()).name))) {
                player.sendMessage("Wear an item dedicated to Zamorak first."); return;
            }
            if (player.getInventory().getAmount(itemId("Coins")) < 75000) { player.sendMessage("You need 75,000 coins."); return; }
            player.getInventory().deleteNumber(itemId("Coins"), 75000);
            score.bologa = true; player.sendMessage("You can now purchase grape blessings from Gricoller.");
        }]]);
        return;
    }
    if (event.definition?.getName() !== "Farmer Gricoller") return;
    event.handled = true;
    const { player } = event;
    const score = scoreFor(player);
    player.sendMessage(`You have ${score.points} Tithe Farm reward points.`);
    const entries: [string, () => void][] = REWARDS.map(([name, cost, amount]) => [`${name} (${cost} points)`, () => {
        if (!player.getLocation().isWithinDistance(event.npc.getLocation(), 5)) return;
        if (score.points < cost) { player.sendMessage("You do not have enough points."); return; }
        if (name === "Herb sack" && player.getSkillManager().getCurrentLevel(Skill.HERBLORE) < 58) { player.sendMessage("You need level 58 Herblore."); return; }
        if (name === "Bologa's blessing" && !score.bologa) { player.sendMessage("First arrange for Bologa to bless your grapes."); return; }
        if (name === "Seed pack" ? giveSeedPack(player, 3, true) : give(player, itemId(name), amount ?? 1)) { score.points -= cost; sync(player); }
    }]);
    entries.push([score.autoWeedUnlocked ? "Toggle Auto-weed" : "Unlock Auto-weed (50 points)", () => {
        if (!player.getLocation().isWithinDistance(event.npc.getLocation(), 5)) return;
        if (!score.autoWeedUnlocked && score.points < 50) { player.sendMessage("You need 50 points."); return; }
        if (!score.autoWeedUnlocked) { score.points -= 50; score.autoWeedUnlocked = true; }
        farmFor(player).autoWeed = !farmFor(player).autoWeed;
        player.sendMessage(`Auto-weed is ${farmFor(player).autoWeed ? "enabled" : "disabled"}.`); sync(player);
    }]);
    choose(player, entries);
}
