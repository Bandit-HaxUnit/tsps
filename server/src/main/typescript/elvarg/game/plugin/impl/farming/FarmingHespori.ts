import type { Player } from "../../../entity/impl/player/Player";
import { NPC } from "../../../entity/impl/npc/NPC";
import { World } from "../../../World";
import { PrivateArea } from "../../../model/areas/impl/PrivateArea";
import { Boundary } from "../../../model/Boundary";
import { Location } from "../../../model/Location";
import { Item } from "../../../model/Item";
import { Animation } from "../../../model/Animation";
import { Graphic } from "../../../model/Graphic";
import { Projectile } from "../../../model/Projectile";
import { CombatMethod } from "../../../content/combat/method/CombatMethod";
import { CombatType } from "../../../content/combat/CombatType";
import { PendingHit } from "../../../content/combat/hit/PendingHit";
import { HitDamage } from "../../../content/combat/hit/HitDamage";
import { HitMask } from "../../../content/combat/hit/HitMask";
import { PrayerHandler } from "../../../content/PrayerHandler";
import { CombatFactory } from "../../../content/combat/CombatFactory";
import { CacheDefinitions } from "../../../cache/CacheDefinitions";
import { NpcIdentifiers } from "../../../../util/NpcIdentifiers";
import { PluginManager } from "../../../../plugins/PluginManager";
import { CACHE, CROPS, Patch, itemId } from "./FarmingData";
import { farmFor, stateFor, give, choose, award, clearPatch, requireTool, syncPatch } from "./FarmingPlugin";
import { cropRewards } from "./FarmingServices";

// Animation/projectile names verified in RuneLite gameval and this cache.
const ANIMATION = { SPAWN: 8221, SPECIAL: 8223, RANGED: 8224 };
const PROJECTILE = { RANGE: 1639, MAGIC: 1640, VINES: 1642 };
const EXIT = new Location(1232, 3728, 0);
class HesporiArea extends PrivateArea {
    constructor() { super([new Boundary(1216, 1279, 10048, 10111, 0)]); }
}
type Fight = { player: Player; patch: Patch; area: HesporiArea; boss: NPC; flowers: NPC[]; phase: number;
    attacks: number; vinesUntil: number; escapeClicks: number; deathCaptured?: boolean };
const FIGHTS = new WeakMap<Player, Fight>();
const NPC_FIGHTS = new WeakMap<NPC, Fight>();

function spawn(fight: Fight, id: number, x: number, y: number): NPC {
    const npc = PluginManager.spawnNpc({ id, x, y, z: 0, owner: fight.player, ownerOnly: true, wanderRadius: 0 }) as NPC;
    (npc as any).__skipDefaultRespawn = true;
    npc.getMovementQueue().setBlockMovement(true);
    fight.area.enter(npc);
    NPC_FIGHTS.set(npc, fight);
    return npc;
}
function flowers(fight: Fight): void {
    for (const flower of fight.flowers) World.getRemoveNPCQueue().push(flower);
    fight.flowers = [[-3, -3], [-3, 5], [5, -3], [5, 5]].map(([x, y]) =>
        spawn(fight, NpcIdentifiers.FLOWER, fight.patch.x + x, fight.patch.y + y));
    fight.phase++;
}
export function harvestHespori(player: Player, patch: Patch): void {
    if (!requireTool(player, "Spade")) return;
    const state = stateFor(player, patch);
    if (state.hesporiLoot) {
        while (state.hesporiLoot.length) {
            const drop = state.hesporiLoot[0];
            if (!give(player, drop.itemId, drop.amount)) return;
            state.hesporiLoot.shift();
        }
        award(player, CROPS.get("HESPORI").harvest);
        cropRewards(player, CROPS.get("HESPORI"));
        clearPatch(player, patch);
        return;
    }
    if (FIGHTS.has(player) || state.status !== "grown") return;
    if (farmFor(player).deathbank?.length) {
        player.sendMessage("Collect your items from Arno before starting another fight."); return;
    }
    const area = player.getArea() instanceof HesporiArea ? player.getArea() as HesporiArea : new HesporiArea();
    if (player.getArea() !== area) { player.getArea()?.leave(player, false); area.enter(player); }
    const fight: Fight = { player, patch, area, boss: null, flowers: [], phase: 0, attacks: 0, vinesUntil: 0, escapeClicks: 0 };
    FIGHTS.set(player, fight);
    fight.boss = spawn(fight, NpcIdentifiers.HESPORI, patch.x, patch.y);
    fight.boss.setHitpoints(300);
    fight.boss.performAnimation(new Animation(ANIMATION.SPAWN));
    flowers(fight);
    fight.boss.getCombat().attack(player);
    state.hesporiFight = true;
    syncPatch(player, patch);
}
export class HesporiCombat extends CombatMethod {
    private style = CombatType.RANGED;
    private special = false;
    type(): CombatType { return this.style; }
    attackSpeed(): number { return 6; }
    attackDistance(): number { return 16; }
    canAttack(npc: NPC, target: any): boolean { return NPC_FIGHTS.get(npc)?.player === target; }
    start(npc: NPC, target: Player): void {
        const fight = NPC_FIGHTS.get(npc);
        if (!fight) return;
        // ponytail: approximate the documented 30–40 second entangle window; exact scheduling needs an OSRS capture.
        this.special = ++fight.attacks % 9 === 0;
        this.style = Math.random() < 0.5 ? CombatType.RANGED : CombatType.MAGIC;
        npc.performAnimation(new Animation(this.style === CombatType.RANGED && !this.special ? ANIMATION.RANGED : ANIMATION.SPECIAL));
        Projectile.createProjectile(npc, target, this.special ? PROJECTILE.VINES : this.style === CombatType.RANGED ? PROJECTILE.RANGE : PROJECTILE.MAGIC, 40, 65, 31, 43).sendProjectile();
        if (this.special) {
            fight.vinesUntil = World.getProcessCycle() + 10;
            fight.escapeClicks = 0;
            target.getMovementQueue().setBlockMovement(true).reset();
            target.getCombat().reset();
            target.performGraphic(new Graphic(1643));
            target.sendMessage("Hespori entangles you in some vines!");
        }
    }
    hits(npc: NPC, target: Player): PendingHit[] {
        if (this.special) return [];
        const ranged = this.style === CombatType.RANGED;
        return Array.from({ length: ranged ? 2 : 1 }, (_, index) => {
            const hit = new PendingHit(npc, target, this, 2 + index);
            const prayer = target.getPrayerActive()[ranged ? PrayerHandler.PROTECT_FROM_MISSILES : PrayerHandler.PROTECT_FROM_MAGIC];
            const damage = hit.isAccurate() ? Math.floor(Math.random() * (ranged ? 9 : 15)) : 0;
            hit.setTotalDamage(Math.min(target.getHitpoints(), prayer ? Math.floor(damage / 4) : damage));
            return hit;
        });
    }
    handleAfterHitEffects(hit: PendingHit): void {
        // ponytail: poison severity is documented; its proc probability remains an estimate.
        if (hit.getTotalDamage() > 0 && Math.random() < 0.125) CombatFactory.poisonEntity(hit.getTarget(), 4);
    }
}
export function hesporiHitRoll(event: any): void {
    const fight = NPC_FIGHTS.get(event.attacker);
    if (fight?.boss === event.attacker) event.bypassProtectionPrayer = true;
    const defending = NPC_FIGHTS.get(event.target);
    if (defending?.flowers.includes(event.target)) event.forceAccurate = true;
}
export function hesporiCanAttack(event: any): void {
    if (NPC_FIGHTS.get(event.attacker)?.flowers.includes(event.attacker)) { event.allow = false; return; }
    const fight = NPC_FIGHTS.get(event.target);
    if (!fight) return;
    if (fight.player !== event.attacker || fight.vinesUntil || (event.target === fight.boss && fight.flowers.some(n => n.getHitpoints() > 0))) event.allow = false;
}
export function hesporiHit(event: any): void {
    const fight = NPC_FIGHTS.get(event.target);
    if (!fight) return;
    if (fight.flowers.includes(event.target)) event.target.setHitpoints(0);
    else if (event.target === fight.boss && fight.phase < 3) {
        const remaining = fight.boss.getHitpoints() - fight.boss.getCombat().getHitQueue().getQueuedDamage();
        if (remaining > 0 && remaining <= 300 - fight.phase * 100) flowers(fight);
    }
}
export function hesporiDamage(event: any): void {
    const fight = NPC_FIGHTS.get(event.target);
    if (fight?.flowers.includes(event.target)) event.hit.setTotalDamage(event.target.getHitpoints());
}
export function hesporiInput(event: any): void {
    const fight = FIGHTS.get(event.player);
    if (!fight?.vinesUntil || !["move", "npc_option", "spell_on_npc"].includes(event.packet.type)) return;
    event.handled = true;
    if (++fight.escapeClicks < 6) { event.player.sendMessage("You feel the vines loosen slightly as you try to move."); return; }
    releaseVines(fight);
    event.player.sendMessage("You break free of the vines.");
}
function releaseVines(fight: Fight): void {
    fight.vinesUntil = 0;
    fight.player.getMovementQueue().setBlockMovement(false);
}
export function hesporiProcess({ player }: { player: Player }): void {
    const fight = FIGHTS.get(player);
    if (!fight) return;
    if (player.getArea() !== fight.area) { hesporiLogout({ player }); return; }
    if (fight.vinesUntil && World.getProcessCycle() >= fight.vinesUntil) {
        releaseVines(fight);
        player.getCombat().getHitQueue().addPendingDamage([new HitDamage(40 + Math.floor(Math.random() * 11), HitMask.RED)]);
    }
}
export function hesporiLoot(event: any): void {
    const fight = NPC_FIGHTS.get(event.npc);
    if (!fight || fight.boss !== event.npc) return;
    event.handled = true;
    // The existing drop table supplies the main roll. Anima is one guaranteed roll, not three independent rolls.
    const anima = ["Attas seed", "Iasor seed", "Kronos seed"].map(itemId);
    const loot = event.drops.filter((d: any) => !anima.includes(d.itemId) && d.itemId !== itemId("Tangleroot"));
    loot.push({ itemId: anima[Math.floor(Math.random() * anima.length)], amount: 1 + Math.floor(Math.random() * 2) });
    stateFor(fight.player, fight.patch).hesporiLoot = loot.map(({ itemId, amount, noted }) => ({
        itemId: noted && CacheDefinitions.getItem(itemId).note >= 0 ? CacheDefinitions.getItem(itemId).note : itemId,
        amount,
    }));
    stateFor(fight.player, fight.patch).hesporiFight = false;
    releaseVines(fight);
    for (const flower of fight.flowers) World.getRemoveNPCQueue().push(flower);
    FIGHTS.delete(fight.player);
    syncPatch(fight.player, fight.patch);
    fight.player.sendMessage("The Hespori is defeated. Clear the patch to collect your harvest.");
}
export function hesporiLogout({ player }: { player: Player }): void {
    const fight = FIGHTS.get(player);
    if (!fight) return;
    stateFor(player, fight.patch).hesporiFight = false;
    releaseVines(fight);
    for (const npc of [fight.boss, ...fight.flowers]) World.getRemoveNPCQueue().push(npc);
    FIGHTS.delete(player);
}
export function hesporiDeathDrop(event: any): void {
    const fight = FIGHTS.get(event.player);
    if (!fight || !event.dropEligible) return;
    const farm = farmFor(event.player);
    if (!fight.deathCaptured) { farm.deathbank = []; farm.deathbankPaid = false; fight.deathCaptured = true; }
    farm.deathbank.push({ id: event.item.getId(), amount: event.item.getAmount(), meta: Item.cloneMeta(event.item.getMeta()) });
    event.suppressDefaultDrop = true;
    event.handled = true;
}
export function hesporiPlayerDeath(event: any): void {
    if (!FIGHTS.has(event.player) && (PluginManager.emitShouldDropItemsOnDeath(event.player, event.killer) ?? true)) {
        farmFor(event.player).deathbank = [];
    }
}
export function hesporiNpc(event: any): void {
    if (event.definition?.getName() !== "Arno" || event.definition.getActions()?.[event.clickType - 1]?.toLowerCase() !== "collect") return;
    event.handled = true;
    const { player } = event;
    const farm = farmFor(player);
    if (!farm.deathbank?.length) { player.sendMessage("Arno has no items for you."); return; }
    choose(player, [[farm.deathbankPaid ? "Collect your items" : "Retrieve items (25,000 coins)", () => {
        if (!player.getLocation().isWithinDistance(event.npc.getLocation(), 5)) return;
        if (!farm.deathbankPaid) {
            if (player.getInventory().getAmount(itemId("Coins")) < 25000) { player.sendMessage("You need 25,000 coins."); return; }
            player.getInventory().deleteNumber(itemId("Coins"), 25000);
            farm.deathbankPaid = true;
        }
        while (farm.deathbank.length && player.getInventory().getFreeSlots()) {
            const saved = farm.deathbank.shift();
            player.getInventory().addItem(new Item(saved.id, saved.amount, saved.meta));
        }
    }]]);
}
export function hesporiCave(event: any): void {
    const { player, location, definition } = event;
    if (!definition?.getName()?.toLowerCase().includes("cave") || location.x < 1216 || location.x > 1279) return;
    const action = definition.getInteractions()?.[event.clickType - 1]?.toLowerCase();
    if (location.y > 10048 && location.y < 10112 && ["exit", "quick-exit"].includes(action)) {
        event.handled = true;
        hesporiLogout({ player });
        player.getArea()?.leave(player, false);
        player.moveTo(EXIT.clone());
    } else if (location.y > 3700 && location.y < 3730 && action === "enter") {
        event.handled = true;
        const area = new HesporiArea();
        player.getArea()?.leave(player, false);
        area.enter(player);
        player.moveTo(new Location(1243, 10081, 0));
    }
}
