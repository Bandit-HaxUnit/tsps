import type { Player } from "../../../entity/impl/player/Player";
import type { PluginButtonClickEvent, PluginSpellOnObjectEvent } from "../../../../plugins/PluginTypes";
import { Spell } from "../../../content/combat/magic/Spell";
import { CacheDefinitions } from "../../../cache/CacheDefinitions";
import { MagicSpellbook } from "../../../model/MagicSpellbook";
import { Item } from "../../../model/Item";
import { Skill } from "../../../model/Skill";
import { Animation } from "../../../model/Animation";
import { CACHE, CROPS, Patch, itemId, patchKey } from "./FarmingData";
import { advanceFarm, nextGrowth } from "./FarmingModel";
import { farmFor, stateFor, cure, fertilize, clearPatch, syncPatch, choose } from "./FarmingPlugin";

const SPELLS: Record<string, { level: number; xp: number; runes: [string, number][] }> = {
    "cure plant": { level: 66, xp: 60, runes: [["Astral rune", 1], ["Earth rune", 8]] },
    "fertile soil": { level: 83, xp: 87, runes: [["Astral rune", 3], ["Nature rune", 2], ["Earth rune", 15]] },
    "resurrect crops": { level: 78, xp: 90, runes: [["Earth rune", 25], ["Blood rune", 8], ["Nature rune", 12], ["Soul rune", 8]] },
    "geomancy": { level: 65, xp: 60, runes: [["Astral rune", 3], ["Nature rune", 3], ["Earth rune", 8]] },
};
class FarmingSpell extends Spell {
    constructor(private key: string, private id: number) { super(); }
    spellId(): number { return this.id; }
    levelRequired(): number { return SPELLS[this.key].level; }
    baseExperience(): number { return SPELLS[this.key].xp; }
    itemsRequired(): Item[] { return SPELLS[this.key].runes.map(([name, amount]) => new Item(itemId(name), amount)); }
    equipmentRequired(): Item[] { return []; }
    startCast(): void {}
    getSpellbook(): MagicSpellbook { return this.key === "resurrect crops" ? MagicSpellbook.ARCEUUS : MagicSpellbook.LUNAR; }
    cast(player: Player): boolean {
        if (!this.canCast(player, true)) return false;
        player.performAnimation(new Animation(4413));
        player.getSkillManager().addExperiences(Skill.MAGIC, this.baseExperience());
        return true;
    }
}
export function farmingSpell(event: PluginSpellOnObjectEvent, patch: Patch): void {
    const key = CacheDefinitions.getSpellName(event.spellWidget, event.spellItemId)?.toLowerCase();
    if (!SPELLS[key] || key === "geomancy") return;
    event.handled = true;
    const { player } = event;
    advanceFarm(farmFor(player), Date.now());
    const state = stateFor(player, patch);
    if (patch.type.includes("COMPOST") || patch.type === "ANIMA") { player.sendMessage("That spell cannot affect this patch."); return; }
    if (key === "cure plant" && state.status !== "diseased") { player.sendMessage("The plant is not diseased."); return; }
    if (key === "fertile soil" && (state.weeds || state.compost || state.status === "dead" || ["GRAPES", "CORAL"].includes(patch.type))) {
        player.sendMessage("This patch cannot be treated now."); return;
    }
    if (key === "resurrect crops" && (state.status !== "dead" || state.resurrected)) { player.sendMessage("You cannot resurrect this crop."); return; }
    if (!new FarmingSpell(key, event.spellId).cast(player)) return;
    if (key === "cure plant") cure(player, patch, false);
    else if (key === "fertile soil") {
        const ultra = (farmFor(player).ultraFertile || player.getPacketSender().getVarbit(5960) > 0) && player.getInventory().getAmount(itemId("Volcanic ash")) >= 2;
        if (ultra) player.getInventory().deleteNumber(itemId("Volcanic ash"), 2);
        fertilize(player, patch, ultra ? 3 : 2, false);
    }
    else {
        const level = Math.min(99, player.getSkillManager().getCurrentLevel(Skill.MAGIC));
        if (Math.random() < 0.5 + (level - 78) / 84) {
            state.resurrected = true;
            state.status = "growing";
            state.nextAt = nextGrowth(Date.now(), CROPS.get(state.crop).minutes, farmFor(player).offset);
            player.sendMessage("You restore the crop to life.");
        } else { clearPatch(player, patch); player.sendMessage("The spell fails and clears the dead crop."); }
    }
    syncPatch(player, patch);
}
export function farmingButton(event: PluginButtonClickEvent): void {
    const key = CacheDefinitions.getSpellName(event.buttonId, -1)?.toLowerCase();
    if (key !== "geomancy") return;
    event.handled = true;
    if (!new FarmingSpell(key, event.buttonId).cast(event.player)) return;
    const farm = farmFor(event.player);
    advanceFarm(farm, Date.now());
    const patches = CACHE.patches.filter(p => farm.patches[patchKey(p)]?.crop);
    if (!patches.length) { event.player.sendMessage("You have no crops growing."); return; }
    choose(event.player, patches.map(p => {
        const s = farm.patches[patchKey(p)];
        return [`${CROPS.get(s.crop).name}: ${s.status}`, () => event.player.sendMessage(`Patch at ${p.x}, ${p.y}: ${s.status}${s.protected ? ", gardener protected" : ""}.`)];
    }));
}
