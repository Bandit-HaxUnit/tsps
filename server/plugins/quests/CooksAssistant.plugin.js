/**
 * Cook's Assistant.
 *
 * The words come from the osrsreboxed transcript data (npc-dialogues.json):
 *   stage 0 -> "Cook's Assistant" / "starting-off"
 *   stage 1 -> "Cook's Assistant" / "talking-to-the-cook-again"
 *   stage 2 -> "Cook (Lumbridge)" / "standard-dialogue-after-cook-s-assistant"
 *
 * This plugin only supplies the branching: which variant to play, how to answer
 * the wiki's prose conditions, and the game actions (start, hand in) keyed off the
 * dialogue runtime's choice/condition events. Collecting gameplay lives in the
 * Pickable / Windmill / DairyCow plugins; pots, buckets and eggs come from the
 * Lumbridge General Store (OSRS uses kitchen floor spawns for the egg).
 */
const { Skill } = require("../../src/main/typescript/elvarg/game/model/Skill");
const { registerQuest, refreshQuestList } = require("./QuestRuntime");

const COOK_NPC_ID = 4626;

const VARP_COOKS_ASSISTANT = 29;
const STAGE_STARTED = 1;
const STAGE_COMPLETE = 2;

const BUCKET_ITEM_ID = 1925;
const BUCKET_OF_MILK_ITEM_ID = 1927;
const POT_ITEM_ID = 1931;
const POT_OF_FLOUR_ITEM_ID = 1933;
const EGG_ITEM_ID = 1944;
const CAKE_ITEM_ID = 1891;

const REQUIRED_ITEMS = [
  { itemId: BUCKET_OF_MILK_ITEM_ID, label: "a bucket of milk" },
  { itemId: EGG_ITEM_ID, label: "an egg" },
  { itemId: POT_OF_FLOUR_ITEM_ID, label: "a pot of flour" },
];

/** Condition step ids in the transcript that mean "hand the ingredients over". */
const HAND_IN_CONDITION_IDS = new Set([
  "vci6DY", // starting-off: player already has the necessary items
  "_FB4HO", // talking-to-the-cook-again: player has brought all the ingredients
]);

/** The Cook transcript's hand-over lines, keyed to the item the player gives. */
const HANDOVER_LINE_ITEMS = new Map([
  ["Here's a bucket of milk.", BUCKET_OF_MILK_ITEM_ID],
  ["Here's a pot of flour.", POT_OF_FLOUR_ITEM_ID],
  ["Here's a fresh egg.", EGG_ITEM_ID],
]);

function hasAllIngredients(player) {
  const inventory = player.getInventory();
  return REQUIRED_ITEMS.every((requirement) => inventory.getAmount(requirement.itemId) > 0);
}

/**
 * "If the player has the ingredients:" is the else of "has not obtained anything
 * yet", so it means at least one - the nested has/has-not-all conditions below it
 * then pick whether to hand in or ask for the rest.
 */
function hasAnyIngredient(player) {
  const inventory = player.getInventory();
  return REQUIRED_ITEMS.some((requirement) => inventory.getAmount(requirement.itemId) > 0);
}

function buildJournal(player, quest) {
  const stage = quest.getStage(player);
  if (stage >= STAGE_COMPLETE) {
    return [
      "<str>It was the Duke of Lumbridge's birthday,</str>",
      "<str>and I brought his cook an egg, some flour</str>",
      "<str>and some milk for his birthday cake.</str>",
      "",
      "<str>I can now use the cook's high-quality range.</str>",
      "",
      "<col=ff0000>QUEST COMPLETE!</col>",
    ];
  }
  if (stage >= STAGE_STARTED) {
    const inventory = player.getInventory();
    const lines = [
      "It is the <col=800000>Duke of Lumbridge's</col> birthday.",
      "His <col=800000>cook</col> needs the following ingredients:",
      "",
    ];
    for (const ingredient of REQUIRED_ITEMS) {
      lines.push(
        inventory.getAmount(ingredient.itemId) > 0
          ? `<str>${ingredient.label}</str>`
          : ingredient.label
      );
    }
    return lines;
  }
  return [
    "I can start this quest by speaking to the",
    "<col=800000>Cook</col> in the kitchen on the ground floor",
    "of <col=800000>Lumbridge Castle</col>.",
    "",
    "There aren't any requirements for this quest.",
  ];
}

module.exports = {
  name: "CooksAssistant",
  register(api) {
    const quest = registerQuest(api, {
      key: "cooks_assistant",
      name: "Cook's Assistant",
      varpId: VARP_COOKS_ASSISTANT,
      startedValue: STAGE_STARTED,
      completionValue: STAGE_COMPLETE,
      questPoints: 1,
      xpRewards: [{ skillId: Skill.COOKING.getIndex(), amount: 300, label: "Cooking" }],
      rewardItemId: CAKE_ITEM_ID,
      rewardItemLabel: "A cake",
      buildJournal,
      onReward: (player) => player.getSkillManager().addExperiences(Skill.COOKING, 300),
    });

    // Which transcript variant the Cook plays, by quest stage.
    api.onNpcDialogueVariant(({ npcId, player }) => {
      if (npcId !== COOK_NPC_ID) return null;
      const stage = quest.getStage(player);
      if (stage >= STAGE_COMPLETE) return "standard-dialogue-after-cook-s-assistant";
      if (stage >= STAGE_STARTED) return "talking-to-the-cook-again";
      return "starting-off";
    });

    // Answer the Cook transcript's prose conditions.
    api.onNpcDialogueCondition(({ npcId, player, text }) => {
      if (npcId !== COOK_NPC_ID) return null;
      const value = String(text).toLowerCase();
      const inventory = player.getInventory();
      const has = (itemId) => inventory.getAmount(itemId) > 0;
      if (value.includes("does not have an empty pot")) return !has(POT_ITEM_ID);
      if (value.includes("has an empty pot")) return has(POT_ITEM_ID);
      if (value.includes("does not have an empty bucket")) return !has(BUCKET_ITEM_ID);
      if (value.includes("has an empty bucket")) return has(BUCKET_ITEM_ID);
      if (value.includes("already has the necessary items")) return hasAllIngredients(player);
      if (value.includes("doesn't have the necessary items")) return !hasAllIngredients(player);
      if (value.includes("has not obtained anything yet")) {
        return !has(BUCKET_OF_MILK_ITEM_ID) && !has(EGG_ITEM_ID) && !has(POT_OF_FLOUR_ITEM_ID);
      }
      if (value.includes("hasn't handed in at least one item")) {
        return has(BUCKET_OF_MILK_ITEM_ID) || has(EGG_ITEM_ID) || has(POT_OF_FLOUR_ITEM_ID);
      }
      if (value.includes("has brought all the ingredients")) return hasAllIngredients(player);
      if (value.includes("has not brought all the ingredients")) return !hasAllIngredients(player);
      if (value.includes("has the ingredients")) return hasAnyIngredient(player);
      if (value.includes("free-to-play world")) return true;
      if (value.includes("members' world")) return false;
      return null;
    });

    // The transcript always reads all three "Here's a ..." hand-over lines; drop
    // the ones for ingredients the player is not carrying.
    api.onCustomEvent("npc-dialogue:line", (event) => {
      if (event.npcId !== COOK_NPC_ID) return;
      const itemId = HANDOVER_LINE_ITEMS.get(event.text);
      if (itemId !== undefined && event.player.getInventory().getAmount(itemId) <= 0) {
        event.skip = true;
      }
    });

    // The transcript's "Yes." choice carries this quest slug.
    api.onCustomEvent("npc-dialogue:hook", ({ player, npcId, hook }) => {
      if (npcId !== COOK_NPC_ID || hook !== "quest:cook-s-assistant:start") return;
      quest.setStage(player, STAGE_STARTED);
    });

    // Handing the ingredients over completes the quest.
    api.onCustomEvent("npc-dialogue:condition", ({ player, npcId, stepId }) => {
      if (npcId !== COOK_NPC_ID || !HAND_IN_CONDITION_IDS.has(stepId)) return;
      if (!hasAllIngredients(player)) return;
      for (const requirement of REQUIRED_ITEMS) {
        player.getInventory().deleteNumber(requirement.itemId, 1);
      }
      player.sendMessage("You give some milk, an egg and some flour to the cook.");
      quest.complete(player);
    });

    api.onPlayerLogin(({ player }) => refreshQuestList(player));
  },
};
