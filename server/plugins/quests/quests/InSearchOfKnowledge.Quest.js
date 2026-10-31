/**
 * In Search of Knowledge (members miniquest, Forthos Dungeon).
 *
 * The monk Brother Aimeri (8704 injured / 8705 healed, one 8717 spawn whose transform
 * varbit 8393 is the feeding counter) is fed five pieces of cooked food, then starts the
 * miniquest. The three musty bookshelves (34847 sun, 34848 moon, 34849 temple, 34850
 * empty) hand out the tomes; pages drop from the dungeon's monsters and are used on
 * their tome (varbits 8399-8401 count 0-4). Completed tomes are given to Logosia (7044),
 * who hands over the lamp of knowledge (23516, 10,000 XP in a skill level 40+).
 *
 * State comes from the cache's Forthos varp 2231:
 *   8403 hosdun_knowledge_search  1 started, 2 tomes handed in, 3 complete
 *   8393 hosdun_aimeri_status     0-4 injured, 5 healed
 *   8399/8400/8401                sun/moon/temple pages, 0-4
 *   8404/8405/8406                moon/sun/temple tome returned
 *  10245 hosdun_page_prevention  1 stop receiving pages from dungeon drops
 * The varbits are mirrored from saved attributes so page/tome/fed progress survives a
 * relog (PacketSender's varp map is per session); the quest stage itself is persisted by
 * registerQuest. Behaviour follows the OSRS Wiki and Quick guide; the wording is from
 * Transcript:In Search of Knowledge and Transcript:Brother Aimeri.
 */
module.exports = function registerInSearchOfKnowledgeQuest(api) {
  const {
    DialogueChainBuilder, ItemStatementDialogue, NpcDialogue, PlayerDialogue,
    ItemIdentifiers: Items, NpcIdentifiers: Npcs, ObjectIdentifiers: Objects,
  } = api.core;
  const { registerQuest, startTranscript } = require("../QuestRuntime");

  const VARBIT_STAGE = 8403;
  const VARBIT_AIMERI = 8393;
  const VARBIT_PAGE_PREVENTION = 10245;

  const STAGE_STARTED = 1;
  const STAGE_HANDED_IN = 2;
  const STAGE_COMPLETE = 3;
  const AIMERI_FED = 5;
  const PAGES_REQUIRED = 4;

  const SUN_PAGE = Items.TATTERED_SUN_PAGE; // 23512
  const MOON_PAGE = Items.TATTERED_MOON_PAGE; // 23510
  const TEMPLE_PAGE = Items.TATTERED_TEMPLE_PAGE; // 23514
  const SUN_TOME = Items.TOME_OF_THE_SUN; // 23506
  const MOON_TOME = Items.TOME_OF_THE_MOON; // 23504
  const TEMPLE_TOME = Items.TOME_OF_THE_TEMPLE; // 23508
  const LAMP_OF_KNOWLEDGE = Items.LAMP_OF_KNOWLEDGE; // 23516
  const COINS = Items.COINS; // 995

  /**
   * The cache's transformed Aimeri ids. Interaction events carry the resolved variant,
   * so both are accepted; 8717 itself is the nameless spawn.
   */
  const AIMERI_INJURED = Npcs.BROTHER_AIMERI; // 8704
  const AIMERI_HEALED = Npcs.BROTHER_AIMERI_2; // 8705
  const LOGOSIA = Npcs.LOGOSIA; // 7044

  const SUN_BOOKCASE = Objects.MUSTY_BOOKSHELF; // 34847
  const MOON_BOOKCASE = Objects.MUSTY_BOOKSHELF_2; // 34848
  const TEMPLE_BOOKCASE = Objects.MUSTY_BOOKSHELF_3; // 34849
  const EMPTY_BOOKCASE = Objects.MUSTY_BOOKSHELF_4; // 34850

  const AIMERI_PAGE = "Brother Aimeri";
  const LOGOSIA_PAGE = "Logosia";

  const PAGES_ATTRIBUTE = "in-search-of-knowledge:pages";
  const RETURNED_ATTRIBUTE = "in-search-of-knowledge:tomes-returned";
  const FED_ATTRIBUTE = "in-search-of-knowledge:aimeri-fed";
  const PREVENTION_ATTRIBUTE = "in-search-of-knowledge:page-prevention";
  const PAGES_DEFAULT = Object.freeze({ sun: 0, moon: 0, temple: 0 });

  const LAMP_MIN_LEVEL = 40;
  const LAMP_XP = 10_000;
  const PAGE_VALUE = 1_000;
  const MAX_STACK_AMOUNT = 0x7fffffff;

  /**
   * Aimeri accepts cooked fish, meat and vegetables (Wiki). The cache only exposes
   * an Eat action, so classify by the item name: sweets, cakes, bread, fruit and
   * drinks are not in these families.
   */
  const FISH_FOOD_NAME = /fish|shrimp|sardine|anchov|herring|mackerel|trout|cod|pike|salmon|tuna|lobster|bass|swordfish|monkfish|shark|turtle|manta|angler|crab|eel|karambwan|jubbly|bluefin|bream|haddock|halibut|marlin|squid|paddlefish|loach|carp|krill|roe|caviar|fillet|yellowfin|brawk|pysk|leckish|kyren|mycil|roqed|suphi/i;
  const MEAT_FOOD_NAME = /meat|chicken|rabbit|kebbit|graahk|kyatt|larupia|chompy|oomlie|beef|steak|sausage|bacon|ham|turkey|carne|kebab|jerky|snail|frog|locust|antelope|lizard|fox|shish|bird|\bbat\b|worm|spider|grub|toad|snake/i;
  const VEGETABLE_FOOD_NAME = /cabbage|onion|potato|tomato|sweetcorn|corn|pumpkin|mushroom|seaweed|veg|vegetable|chilli|chili|spinach|eggplant|avocado|carrot|pepper|beet|artichoke|asparagus|broccoli|cauliflower|celery|cucumber|leek|lettuce|parsnip|\bpeas?\b|radish|turnip|zucchini|\btom\b/i;
  /** Stews, curries and pies whose name does not carry the ingredient word. */
  const WHOLE_DISH_FOOD_NAMES = new Set([
    "Admiral pie", "Botanical pie", "Curry", "Garden pie", "Stew", "Wild pie",
  ]);

  const TOMES = Object.freeze([
    {
      kind: "sun", name: "Tome of the Sun", tome: SUN_TOME, page: SUN_PAGE,
      pagesVarbit: 8399, returnedVarbit: 8405, bookshelf: SUN_BOOKCASE,
      found: "You find a tome with a symbol of the sun.",
    },
    {
      kind: "moon", name: "Tome of the Moon", tome: MOON_TOME, page: MOON_PAGE,
      pagesVarbit: 8400, returnedVarbit: 8404, bookshelf: MOON_BOOKCASE,
      found: "You find a tome with a symbol of the moon.",
    },
    {
      kind: "temple", name: "Tome of the Temple", tome: TEMPLE_TOME, page: TEMPLE_PAGE,
      pagesVarbit: 8401, returnedVarbit: 8406, bookshelf: TEMPLE_BOOKCASE,
      found: "You find a tome with a strange symbol on it.",
    },
  ]);
  const TOME_BY_ID = new Map(TOMES.map((entry) => [entry.tome, entry]));
  const TOME_BY_PAGE = new Map(TOMES.map((entry) => [entry.page, entry]));
  const SHELF_BY_ID = new Map(TOMES.map((entry) => [entry.bookshelf, entry]));
  const PAGE_IDS = new Set(TOMES.map((entry) => entry.page));

  const ARTEFACT_VARIANTS = new Map([
    [SUN_PAGE, "showing-temple-artifacts-tattered-sun-page"],
    [MOON_PAGE, "showing-temple-artifacts-tattered-moon-page"],
    [TEMPLE_PAGE, "showing-temple-artifacts-tattered-temple-page"],
    [SUN_TOME, "showing-temple-artifacts-tome-of-the-sun"],
    [MOON_TOME, "showing-temple-artifacts-tome-of-the-moon"],
    [TEMPLE_TOME, "showing-temple-artifacts-tome-of-the-temple"],
  ]);

  /** The tome whose "showing" transcript is playing, for its page-count condition. */
  const shownTome = new WeakMap();

  let quest;

  const isAimeri = (npcId) => npcId === AIMERI_INJURED || npcId === AIMERI_HEALED;
  const inventory = (player) => player.getInventory();
  const held = (player, itemId) => inventory(player).getAmount(itemId) > 0;

  function numberAttribute(player, key) {
    const value = Number(player.getAttribute(key));
    return Number.isFinite(value) ? value : 0;
  }

  function readCounts(player, key) {
    const value = player.getAttribute(key);
    return {
      sun: Number(value?.sun) || 0,
      moon: Number(value?.moon) || 0,
      temple: Number(value?.temple) || 0,
    };
  }

  const pagesOf = (player) => readCounts(player, PAGES_ATTRIBUTE);
  const returnedOf = (player) => readCounts(player, RETURNED_ATTRIBUTE);
  const fedOf = (player) => numberAttribute(player, FED_ATTRIBUTE);
  const preventionOf = (player) => numberAttribute(player, PREVENTION_ATTRIBUTE);

  function setPageCount(player, entry, value) {
    const pages = pagesOf(player);
    pages[entry.kind] = value;
    player.setAttribute(PAGES_ATTRIBUTE, pages);
    player.getPacketSender().sendVarbit(entry.pagesVarbit, value);
  }

  function markReturned(player, entry) {
    const returned = returnedOf(player);
    returned[entry.kind] = 1;
    player.setAttribute(RETURNED_ATTRIBUTE, returned);
    player.getPacketSender().sendVarbit(entry.returnedVarbit, 1);
  }

  function setFed(player, value) {
    player.setAttribute(FED_ATTRIBUTE, value);
    player.getPacketSender().sendVarbit(VARBIT_AIMERI, value);
  }

  function setPrevention(player, value) {
    player.setAttribute(PREVENTION_ATTRIBUTE, value);
    player.getPacketSender().sendVarbit(VARBIT_PAGE_PREVENTION, value);
  }

  const returnedCount = (player) => {
    const returned = returnedOf(player);
    return TOMES.filter((entry) => returned[entry.kind] === 1).length;
  };

  /** The varbits the client's Forthos NPC/object transforms and dialogue read. */
  function syncVars({ player }) {
    if (!player?.getPacketSender) return;
    const sender = player.getPacketSender();
    const pages = pagesOf(player);
    const returned = returnedOf(player);
    for (const entry of TOMES) {
      sender.sendVarbit(entry.pagesVarbit, pages[entry.kind]);
      sender.sendVarbit(entry.returnedVarbit, returned[entry.kind]);
    }
    sender.sendVarbit(VARBIT_AIMERI, fedOf(player));
    sender.sendVarbit(VARBIT_PAGE_PREVENTION, preventionOf(player));
  }

  // ==========================================================================
  // Dialogue selection and conditions
  // ==========================================================================

  function selectVariant({ npcId, player }) {
    if (isAimeri(npcId)) {
      const healed = npcId === AIMERI_HEALED || fedOf(player) >= AIMERI_FED;
      return { page: AIMERI_PAGE, variant: healed ? "healed" : "injured" };
    }
    if (npcId === LOGOSIA) {
      return {
        page: LOGOSIA_PAGE,
        variant: quest.isComplete(player)
          ? "standard-dialogue-if-the-player-has-completed-the-in-search-of-knowledge-miniquest"
          : "standard-dialogue-if-the-player-has-not-completed-the-in-search-of-knowledge-miniquest-the-dialogue-will-always-go-to-the-next-two-options-regardless-of-which-option-is-chosen",
      };
    }
    return null;
  }

  function hasFood(player) {
    return inventory(player).getItems().some((item) =>
      item && isAimeriFood(item.getId?.() ?? item.id));
  }

  /** An edible item in Aimeri's accepted families: cooked fish, meat or vegetables. */
  function isAimeriFood(itemId) {
    const definition = api.core.CacheDefinitions.getItem(itemId);
    if (!definition || !(definition.inventoryActions ?? []).includes("Eat")) return false;
    const name = String(definition.name ?? "");
    return WHOLE_DISH_FOOD_NAMES.has(name)
      || FISH_FOOD_NAME.test(name)
      || MEAT_FOOD_NAME.test(name)
      || VEGETABLE_FOOD_NAME.test(name);
  }

  function answerCondition({ npcId, player, text }) {
    const lower = String(text ?? "").toLowerCase();
    if (isAimeri(npcId)) {
      if (lower.includes("if the player has food in inventory")) return hasFood(player);
      if (lower.includes("if the player has no food in inventory")) return !hasFood(player);
      if (lower.includes("if player uses anything other than food on him")) return false;
      if (lower.includes("if the altar has been cursed")) return false;
      if (lower.includes("if the player has received a temple key")) return false;
      if (lower.includes("if the player has a pristine spider silk")) return false;
      if (lower.includes("if the tome is missing pages")) {
        const entry = shownTome.get(player);
        return !!entry && pagesOf(player)[entry.kind] < PAGES_REQUIRED;
      }
      if (lower.includes("if the final temple page has been added to the tome")) {
        const entry = shownTome.get(player);
        return !!entry && pagesOf(player)[entry.kind] >= PAGES_REQUIRED;
      }
      return null;
    }
    if (npcId === LOGOSIA) {
      if (lower.includes("if the player is currently looking for more tome pages")) {
        return preventionOf(player) === 0;
      }
      if (lower.includes("if the player is currently not looking for more tome pages")) {
        return preventionOf(player) === 1;
      }
      return null;
    }
    return null;
  }

  function handleLine(event) {
    if (!isAimeri(event.npcId) || event.text !== "I'll keep my eyes open.") return;
    const { player } = event;
    if (quest.getStage(player) !== 0 || fedOf(player) < AIMERI_FED) return;
    quest.setStage(player, STAGE_STARTED);
    player.sendMessage("You've started a new miniquest: <col=081190>In Search of Knowledge</col>");
  }

  function handleAction(event) {
    if (event.npcId !== LOGOSIA || !event.player) return;
    const { player } = event;
    // WQyrhA is the "no longer receive pages" message inside the stop choice; XWXpa4
    // the "now receive pages" message inside the start choice.
    if (event.stepId === "WQyrhA") {
      setPrevention(player, 1);
      return;
    }
    if (event.stepId === "XWXpa4") setPrevention(player, 0);
  }

  // ==========================================================================
  // Aimeri: feeding and showing artefacts
  // ==========================================================================

  function say(player, npcId, text) {
    player.getDialogueManager().startDialogues(
      new DialogueChainBuilder().add(new NpcDialogue(0, npcId, text))
    );
  }

  function feedAimeri(player, itemId, slot) {
    const fed = fedOf(player);
    if (fed >= AIMERI_FED) {
      say(player, AIMERI_HEALED, "No thanks, I'm not hungry anymore.");
      return;
    }
    const inv = inventory(player);
    if (slot >= 0 && inv.get(slot)?.getId?.() === itemId) inv.deleteAtSlot(slot, 1);
    else inv.deleteNumber(itemId, 1);
    const next = fed + 1;
    setFed(player, next);
    player.sendMessage("You give Brother Aimeri some food.");
    if (next >= AIMERI_FED) player.sendMessage("Brother Aimeri looks much better now.");
  }

  function useItemOnAimeri(event) {
    const { player, itemId } = event;
    if (!isAimeri(event.npcId) && event.definition?.getName?.() !== "Brother Aimeri") return;
    event.handled = true;
    const healed = event.npcId === AIMERI_HEALED || fedOf(player) >= AIMERI_FED;
    if (!healed) {
      if (isAimeriFood(itemId)) {
        feedAimeri(player, itemId, event.slot);
        return;
      }
      say(player, AIMERI_INJURED, "No thanks. I would rather eat fish, meat or vegetables.");
      return;
    }
    if (isAimeriFood(itemId)) {
      say(player, AIMERI_HEALED, "No thanks, I'm not hungry anymore.");
      return;
    }
    const variant = ARTEFACT_VARIANTS.get(itemId);
    if (variant) {
      shownTome.set(player, TOME_BY_ID.get(itemId) ?? null);
      startTranscript(api, player, event.npcId, AIMERI_PAGE, variant, undefined, event.target);
      return;
    }
    shownTome.delete(player);
    startTranscript(api, player, event.npcId, AIMERI_PAGE,
      "showing-temple-artifacts-using-an-unrelated-item", undefined, event.target);
  }

  // ==========================================================================
  // Musty bookshelves and the tomes
  // ==========================================================================

  function searchBookshelf(event) {
    const { player, objectId } = event;
    if (objectId === EMPTY_BOOKCASE) {
      event.handled = true;
      player.sendMessage("You search the bookshelf but find nothing useful.");
      return;
    }
    const entry = SHELF_BY_ID.get(objectId);
    if (!entry) return;
    event.handled = true;
    if (held(player, entry.tome)) {
      player.sendMessage("You already have that tome.");
      return;
    }
    if (inventory(player).getFreeSlots() < 1) {
      inventory(player).full();
      return;
    }
    inventory(player).adds(entry.tome, 1);
    player.sendMessage(entry.found);
  }

  function usePageOnTome(event) {
    const { player, usedItemId, usedWithItemId } = event;
    const page = TOME_BY_PAGE.get(usedItemId) ?? TOME_BY_PAGE.get(usedWithItemId);
    const tome = TOME_BY_ID.get(usedItemId) ?? TOME_BY_ID.get(usedWithItemId);
    if (!page || !tome) return;
    event.handled = true;
    if (page !== tome) {
      player.sendMessage(`That page does not belong in the ${tome.name}.`);
      return;
    }
    const current = pagesOf(player)[tome.kind];
    if (current >= PAGES_REQUIRED) {
      player.sendMessage(`The ${tome.name} already has all of its pages.`);
      return;
    }
    if (!held(player, tome.page)) return;
    inventory(player).deleteNumber(tome.page, 1);
    const next = current + 1;
    setPageCount(player, tome, next);
    const kind = tome.kind;
    player.sendMessage(next >= PAGES_REQUIRED
      ? `You add the final ${kind} page to the ${tome.name}. Perhaps Logosia would be interested in this?`
      : `You add a missing ${kind} page to the ${tome.name}.`);
  }

  function checkTome(event) {
    const entry = TOME_BY_ID.get(event.itemId);
    if (!entry) return;
    event.handled = true;
    const count = pagesOf(event.player)[entry.kind];
    event.player.sendMessage(count >= PAGES_REQUIRED
      ? `The ${entry.name} is complete.`
      : `The ${entry.name} is missing ${PAGES_REQUIRED - count} page${PAGES_REQUIRED - count === 1 ? "" : "s"}.`);
  }

  // ==========================================================================
  // Logosia: the tome hand-in and spare-page trade
  // ==========================================================================

  function handInTomes(player, usedTomeId) {
    if (quest.isComplete(player)) {
      player.sendMessage("Logosia already has the tomes.");
      return;
    }
    if (quest.getStage(player) < STAGE_STARTED) {
      player.sendMessage("You should speak to Brother Aimeri before donating the tomes.");
      return;
    }
    const used = TOME_BY_ID.get(usedTomeId);
    if (!used) return;
    const pages = pagesOf(player);
    if (pages[used.kind] < PAGES_REQUIRED) {
      player.sendMessage(`The ${used.name} is missing pages. You should find them before showing it to Logosia.`);
      return;
    }
    const returned = returnedOf(player);
    const handIns = TOMES.filter((entry) =>
      returned[entry.kind] !== 1 && pages[entry.kind] >= PAGES_REQUIRED && held(player, entry.tome));
    if (handIns.length === 0) {
      player.sendMessage("Logosia already has that tome.");
      return;
    }

    player.sendMessage("You show Logosia the tome.");
    for (const entry of handIns) {
      inventory(player).deleteNumber(entry.tome, 1);
      markReturned(player, entry);
    }
    player.sendMessage(handIns.length > 1
      ? "You hand Logosia the tomes."
      : "You hand Logosia the tome.");

    if (returnedCount(player) >= TOMES.length) {
      quest.setStage(player, STAGE_HANDED_IN);
      quest.complete(player);
      showRewardDialogue(player);
      return;
    }

    player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
      new NpcDialogue(0, LOGOSIA, "I have not seen this before. Your donation to the library is appreciated.")
    ));
  }

  function showRewardDialogue(player) {
    const builder = new DialogueChainBuilder();
    let index = 0;
    builder.add(new NpcDialogue(index++, LOGOSIA,
      "Your contributions to the library have been noticed. We would like to reward you for your assistance."));
    builder.add(new ItemStatementDialogue(index++, LAMP_OF_KNOWLEDGE,
      "You receive an experience lamp as a reward."));
    builder.add(new NpcDialogue(index++, LOGOSIA,
      "If you find any spare pages for these books I would be willing to give you 1,000 gold for each one. Duplicate sources of information are always useful."));
    builder.add(new PlayerDialogue(index++, "I'll keep an eye out."));
    builder.add(new NpcDialogue(index++, LOGOSIA, "Enough talk now, Shhhh!"));
    player.getDialogueManager().startDialogues(builder);
  }

  function sellPages(player, itemId) {
    const entry = TOMES.find((tome) => tome.page === itemId);
    if (!entry || !quest.isComplete(player)) return;
    const amount = inventory(player).getAmount(itemId);
    if (amount < 1) return;
    const payout = amount * PAGE_VALUE;
    // A capped coin stack would clamp adds() after the pages were already deleted.
    // Refuse first and keep the pages; a sale always frees the slot for a new stack.
    const coins = new api.core.Item(COINS, payout);
    const hasCoinStack = inventory(player).getAmount(COINS) > 0;
    if (payout > MAX_STACK_AMOUNT
      || (hasCoinStack && inventory(player).getAddableAmount(coins) < payout)) {
      player.sendMessage("You do not have enough room to carry all of those coins.");
      return;
    }
    inventory(player).deleteNumber(itemId, amount);
    inventory(player).adds(COINS, payout);
    player.sendMessage(`You sell ${amount} ${entry.kind} page${amount === 1 ? "" : "s"} to Logosia for ${payout.toLocaleString("en-US")} coins.`);
  }

  function useItemOnLogosia(event) {
    const { player, itemId } = event;
    if (event.npcId !== LOGOSIA) return;
    if (TOME_BY_ID.has(itemId)) {
      event.handled = true;
      handInTomes(player, itemId);
      return;
    }
    if (PAGE_IDS.has(itemId) && quest.isComplete(player)) {
      event.handled = true;
      sellPages(player, itemId);
    }
  }

  // ==========================================================================
  // Lamp of knowledge
  // ==========================================================================

  function rubLamp(event) {
    const { player, itemId } = event;
    if (itemId !== LAMP_OF_KNOWLEDGE) return false;
    event.handled = true;
    api.emitCustomEvent("xpreward:open", {
      player,
      minLevel: LAMP_MIN_LEVEL,
      title: "Choose the stat you wish to be advanced!",
      onConfirm: (skill, name) => {
        const manager = player.getSkillManager();
        const before = manager.getExperience(skill);
        manager.addExperience(skill, LAMP_XP, false);
        if (manager.getExperience(skill) === before) {
          player.sendMessage("You cannot gain experience in that skill right now.");
          return null;
        }
        const slot = player.getInventory().getSlotForItemId?.(itemId) ?? -1;
        if (slot >= 0) player.getInventory().deleteAtSlot(slot, 1);
        else player.getInventory().deleteNumber(itemId, 1);
        return `You rub the lamp and feel more knowledgeable. You have been awarded ${LAMP_XP.toLocaleString("en-US")} ${name} XP!`;
      },
    });
    return true;
  }

  // ==========================================================================
  // Page drops after asking Logosia to stop them
  // ==========================================================================

  function filterPageDrops(event) {
    if (!event?.player || preventionOf(event.player) !== 1 || !Array.isArray(event.drops)) return;
    for (let index = event.drops.length - 1; index >= 0; index--) {
      if (PAGE_IDS.has(event.drops[index]?.itemId)) event.drops.splice(index, 1);
    }
  }

  // ==========================================================================
  // Journal and registration
  // ==========================================================================

  function buildJournal(player) {
    if (quest.isComplete(player)) {
      return [
        "<str>I fed Brother Aimeri and recovered the three tomes from</str>",
        "<str>the Forthos Dungeon.</str>",
        "<str>I gave the completed tomes to Logosia in the Arceuus Library.</str>",
        "",
        "<col=ff0000>MINIQUEST COMPLETE!</col>",
      ];
    }
    if (quest.getStage(player) < STAGE_STARTED) {
      return [
        "I can start this miniquest by talking to",
        "<col=800000>Brother Aimeri</col> in the <col=800000>Forthos Dungeon</col>,",
        "beneath Hosidius.",
      ];
    }
    const lines = [];
    if (fedOf(player) < AIMERI_FED) {
      lines.push("I should feed <col=800000>Brother Aimeri</col> five pieces of",
        "cooked fish, meat or vegetables.");
    }
    const pages = pagesOf(player);
    if (TOMES.some((entry) => !held(player, entry.tome) && returnedOf(player)[entry.kind] !== 1)) {
      lines.push("I should search the <col=800000>musty bookshelves</col> in the",
        "temple library for the three tomes.");
    }
    if (TOMES.some((entry) => pages[entry.kind] < PAGES_REQUIRED)) {
      lines.push("I need to collect tattered pages from the dungeon's",
        "monsters and add them to the tomes.");
    } else {
      lines.push("I should take the completed tomes to <col=800000>Logosia</col>",
        "in the <col=800000>Arceuus Library</col>.");
    }
    return lines;
  }

  api.persistAttribute(PAGES_ATTRIBUTE, PAGES_DEFAULT);
  api.persistAttribute(RETURNED_ATTRIBUTE, PAGES_DEFAULT);
  api.persistAttribute(FED_ATTRIBUTE, 0);
  api.persistAttribute(PREVENTION_ATTRIBUTE, 0);

  quest = registerQuest(api, {
    key: "in_search_of_knowledge",
    name: "In Search of Knowledge",
    varbitId: VARBIT_STAGE,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 0,
    rewardItemId: LAMP_OF_KNOWLEDGE,
    scrollItemId: LAMP_OF_KNOWLEDGE,
    otherRewards: ["Lamp of knowledge (10,000 XP in any skill level 40+)"],
    buildJournal,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:line", handleLine);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("npc-drops:roll", filterPageDrops);
  api.onItemOnNpc(useItemOnAimeri);
  api.onItemOnNpc(useItemOnLogosia);
  api.onItemOnItem(usePageOnTome, { noted: false });
  api.onObjectInteraction("Musty bookshelf", { Search: searchBookshelf });
  for (const entry of TOMES) api.onItemAction(entry.name, { Check: checkTome });
  api.onItemAction("Lamp of knowledge", { Rub: rubLamp });
  api.onPlayerLogin(syncVars);
  api.onCustomEvent("player:bootstrap-complete", syncVars);
};
