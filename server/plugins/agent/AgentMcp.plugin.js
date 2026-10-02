const http = require("http");
const { z } = require("zod");
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StreamableHTTPServerTransport } = require("@modelcontextprotocol/sdk/server/streamableHttp.js");

// Lets an MCP client (Claude Code, etc.) drive an online player for testing. Actions are
// injected as the same decoded client messages a real client produces, so they run through
// the normal ClientConnection dispatch; the player's own web client keeps rendering it all.
//   AGENT_MCP=1 yarn dev   (optional AGENT_MCP_PORT, default 49700)
//   claude mcp add --transport http tsps http://127.0.0.1:49700/mcp

const DEFAULT_PORT = 49700;
const MAX_MESSAGES = 100;
const MAX_WAIT_TICKS = 50;
// Idle this many ticks in a row (no activity, same tile) before a wait counts as finished.
const STILL_TICKS = 2;
// Shop clicks move fixed amounts (1/5/10/50), so larger amounts are sent as several clicks.
const MAX_CLICKS = 50;
const DIALOGUE_KINDS = {
  NpcDialogue: "npc", PlayerDialogue: "player", OptionDialogue: "options",
  StatementDialogue: "statement", ItemStatementDialogue: "item",
};
// Skilling plugins replay their animation every 4-5 ticks, so one this recent means still at it.
const ANIMATION_TICKS = 5;
const tracked = new WeakMap();

// Records game messages and animation timing for players an agent has touched; the client
// still receives everything.
function track(player, World) {
  let state = tracked.get(player);
  if (state) return state;
  state = { messages: [], animatedAt: -Infinity };
  tracked.set(player, state);
  const sender = player.getPacketSender();
  const send = sender.sendMessage.bind(sender);
  sender.sendMessage = (message) => {
    state.messages.push(String(message));
    if (state.messages.length > MAX_MESSAGES) state.messages.shift();
    return send(message);
  };
  const animate = player.performAnimation?.bind(player);
  if (animate) {
    player.performAnimation = (animation) => {
      if (animation) state.animatedAt = World.getProcessCycle?.() ?? 0;
      return animate(animation);
    };
  }
  return state;
}

const tile = (location) => ({ x: location.getX(), y: location.getY(), z: location.getZ() });

function buildMcpServer(core) {
  const {
    World, MapObjects, ObjectDefinition, ItemDefinition, NpcDefinition, Skill, GameConstants, TaskManager, Bank, ShopManager,
    MultiChatboxPrompt,
  } = core;
  const messageLog = (p) => track(p, World).messages;
  const server = new McpServer({ name: "tsps-agent", version: "1.0.0" });

  const find = (username) => {
    const player = World.getPlayerByName(username);
    if (!player) throw new Error(`${username} is not online`);
    track(player, World);
    return player;
  };
  const send = (player, message) => {
    if (!core.dispatchClientMessages(player, [message])) {
      throw new Error(`${player.getUsername()} has no client connection (bots cannot be driven)`);
    }
    return { sent: message };
  };
  const items = (container) => container.getItems()
    .map((item, slot) => item && item.getId() > 0 && item.getAmount() > 0
      ? { slot, id: item.getId(), name: ItemDefinition.forId(item.getId()).getName(), amount: item.getAmount() }
      : null)
    .filter(Boolean);

  const sleepTicks = (ticks) =>
    new Promise((resolve) => setTimeout(resolve, ticks * GameConstants.GAME_ENGINE_PROCESSING_CYCLE_RATE));
  // What the player is in the middle of; empty means idle.
  const activity = (p) => {
    const busy = [];
    if (p.getMovementQueue?.()?.hasPendingWork()) busy.push("moving");
    if (TaskManager?.hasActiveTask(p.getIndex(), "MovementTask")) busy.push("walking to interact");
    if (p.getCombat?.()?.hasPendingWork()) busy.push("combat");
    const now = World.getProcessCycle?.();
    if (now !== undefined && now - track(p, World).animatedAt <= ANIMATION_TICKS) busy.push("animating");
    return busy;
  };
  // An open dialogue or interface needs the agent's input before anything else happens.
  const waitingOn = (p) => p.getDialogueManager?.()?.isActive() || MultiChatboxPrompt?.describe(p)
    ? "dialogue" : p.getInterfaceId?.() > 0 ? "interface" : null;
  const status = (p) => ({
    ...tile(p.getLocation()), hitpoints: p.getHitpoints(), busy: activity(p), open: waitingOn(p),
    messages: messageLog(p).splice(0),
  });
  // Polls each tick until the player reaches `target`, opens a dialogue/interface, or has been
  // idle (no activity, same tile) for STILL_TICKS; gives up after maxTicks.
  const settle = async (username, maxTicks, target) => {
    let last = tile(find(username).getLocation());
    let idle = 0;
    for (let ticks = 1; ticks <= maxTicks; ticks++) {
      await sleepTicks(1);
      const p = find(username);
      const here = tile(p.getLocation());
      if (target && here.x === target.x && here.y === target.y) return { result: "arrived", ticks, ...status(p) };
      const open = waitingOn(p);
      if (open) return { result: open, ticks, ...status(p) };
      const moved = here.x !== last.x || here.y !== last.y || here.z !== last.z;
      idle = moved || activity(p).length ? 0 : idle + 1;
      last = here;
      if (idle >= STILL_TICKS) return { result: target ? "stuck" : "idle", ticks, ...status(p) };
    }
    return { result: "timeout", ticks: maxTicks, ...status(find(username)) };
  };
  const npcClick = (p, npc, option) => {
    const actions = npc.getCurrentDefinition(p)?.getActions() ?? [];
    const clickType = actions.findIndex((action) => action?.toLowerCase() === option.toLowerCase()) + 1;
    if (!clickType) throw new Error(`NPC has no "${option}" option; options: ${actions.filter(Boolean).join(", ")}`);
    return { type: "npc_option", index: npc.getIndex(), clickType };
  };
  // Everything with a menu within `radius` tiles of the player.
  const nearby = (p, radius) => {
    const here = p.getLocation();
    const near = (loc) => loc.getZ() === here.getZ()
      && Math.abs(loc.getX() - here.getX()) <= radius && Math.abs(loc.getY() - here.getY()) <= radius;

    const objects = [];
    for (let x = here.getX() - radius; x <= here.getX() + radius; x++) {
      for (let y = here.getY() - radius; y <= here.getY() + radius; y++) {
        for (const object of MapObjects.mapObjects.get(MapObjects.getHash(x, y, here.getZ())) ?? []) {
          const loc = object.getLocation();
          if (loc.getX() !== x || loc.getY() !== y || loc.getZ() !== here.getZ()) continue;
          const definition = ObjectDefinition.forPlayer(object.getId(), p);
          const options = definition?.getInteractions()?.filter(Boolean);
          if (options?.length) objects.push({ id: object.getId(), name: definition.getName(), options, x, y });
        }
      }
    }

    return {
      npcs: World.getNpcs().stream().filter((npc) => npc && near(npc.getLocation())).map((npc) => {
        const definition = npc.getCurrentDefinition(p);
        return {
          index: npc.getIndex(), id: npc.getId(), name: definition?.getName(),
          options: (definition?.getActions() ?? []).filter(Boolean), ...tile(npc.getLocation()),
        };
      }),
      objects,
      groundItems: World.getItems().filter((item) => near(item.getPosition())).map((item) => ({
        id: item.getItem().getId(), name: item.getItem().getDefinition().getName(),
        amount: item.getItem().getAmount(), ...tile(item.getPosition()),
      })),
    };
  };

  // Nearest NPC/object/ground item called `target` (that has `option`, when given). Errors name
  // what is nearby so the agent can correct itself.
  const nearest = (p, target, option, radius) => {
    const here = p.getLocation();
    const { npcs, objects, groundItems } = nearby(p, radius);
    const named = (thing) => thing.name?.toLowerCase() === target.toLowerCase();
    const hasOption = (thing) => !option || thing.options.some((o) => o.toLowerCase() === option.toLowerCase());
    // Ground items carry no option list, so any option is allowed on them.
    const candidates = [
      ...npcs.filter(named).filter(hasOption).map((thing) => ({ kind: "npc", thing })),
      ...objects.filter(named).filter(hasOption).map((thing) => ({ kind: "object", thing })),
      ...groundItems.filter(named).map((thing) => ({ kind: "ground item", thing })),
    ];
    const distance = ({ thing }) => Math.max(Math.abs(thing.x - here.getX()), Math.abs(thing.y - here.getY()));
    const pick = candidates.sort((a, b) => distance(a) - distance(b))[0];
    if (pick) return pick;
    const matches = [...npcs, ...objects].filter(named);
    if (matches.length) {
      const options = [...new Set(matches.flatMap((thing) => thing.options))];
      throw new Error(`No nearby "${target}" has a "${option}" option; options: ${options.join(", ")}`);
    }
    const names = [...new Set([...npcs, ...objects, ...groundItems].map((thing) => thing.name).filter(Boolean))];
    throw new Error(`Nothing named "${target}" within ${radius} tiles; nearby: ${names.join(", ")}`);
  };
  const inventorySlot = (p, name, exceptSlot) => {
    const inventory = items(p.getInventory());
    const entry = inventory.find((e) => e.slot !== exceptSlot && e.name?.toLowerCase() === name.toLowerCase());
    if (!entry) throw new Error(`No "${name}" in inventory; have: ${inventory.map((e) => e.name).join(", ") || "nothing"}`);
    return entry.slot;
  };
  const carried = (p, itemId) =>
    items(p.getInventory()).filter((e) => e.id === itemId).reduce((sum, e) => sum + e.amount, 0);
  // Splits `amount` into the fixed click sizes an interface offers, largest first.
  const clicks = (amount, sizes) => {
    const out = [];
    for (const size of sizes) while (amount >= size) { out.push(size); amount -= size; }
    if (out.length > MAX_CLICKS) throw new Error(`That needs ${out.length} clicks; use a smaller amount or "all"`);
    return out;
  };
  // Sends one packet per step. `oneByOne` spaces them a tick apart and re-resolves each, for
  // non-stackable items where a click empties the slot the next one would use.
  const clickEach = async (username, steps, message, oneByOne) => {
    if (!oneByOne) {
      const p = find(username);
      const packets = steps.map((step) => message(p, step)).filter(Boolean);
      if (!core.dispatchClientMessages(p, packets)) throw new Error(`${username} has no client connection`);
      await sleepTicks(1);
      return status(find(username));
    }
    for (const step of steps) {
      const p = find(username);
      const packet = message(p, step);
      if (!packet) break;
      send(p, packet);
      await sleepTicks(1);
    }
    return status(find(username));
  };

  // Options come either from a DialogueManager OptionDialogue or a plugin's sendMultiChatboxPrompt.
  const readDialogue = (p) => {
    const prompt = MultiChatboxPrompt?.describe(p);
    if (prompt) return { kind: "options", title: prompt.title, options: prompt.options };
    const manager = p.getDialogueManager?.();
    if (!manager?.isActive()) return null;
    // ponytail: reads DialogueManager's and the entries' private fields; add getters if they get renamed.
    const entry = manager.dialogues.get(manager.index);
    const kind = DIALOGUE_KINDS[entry?.constructor?.name] ?? "other";
    return {
      kind,
      speaker: kind === "npc" ? NpcDefinition.forId(entry.npcId)?.getName()?.replace(/_/g, " ")
        : kind === "player" ? p.getUsername() : undefined,
      title: entry?.title || undefined,
      text: entry?.text,
      options: entry?.options,
    };
  };

  const bankEntries = (p) => {
    if (!Bank.isOpen(p)) throw new Error("The bank is not open; interact with a Bank booth or Banker (option Bank) first");
    return Bank.layout(p).map(({ item }, slot) => ({
      slot, id: item.getId(), name: ItemDefinition.forId(item.getId()).getName(), amount: item.getAmount(),
      itemId: Bank.displayItemId(item),
    })).filter((e) => e.amount > 0);
  };
  const openShop = (p) => {
    const shop = ShopManager.describe(p);
    if (!shop) throw new Error("No shop is open; interact with a shopkeeper (option Trade) first");
    return { ...shop, items: shop.items.map((e) => ({ ...e, name: ItemDefinition.forId(e.itemId).getName() })) };
  };
  const byName = (list, name, where) => {
    const entry = list.find((e) => e.name?.toLowerCase() === name.toLowerCase());
    if (!entry) throw new Error(`No "${name}" in ${where}; it has: ${list.map((e) => e.name).join(", ") || "nothing"}`);
    return entry;
  };
  const amountSchema = z.union([z.number().int().min(1), z.literal("all")]).default(1);

  const tool = (name, description, inputSchema, handler) =>
    server.registerTool(name, { description, inputSchema }, async (args) => {
      try {
        return { content: [{ type: "text", text: JSON.stringify(await handler(args)) }] };
      } catch (error) {
        return { content: [{ type: "text", text: String(error?.message ?? error) }], isError: true };
      }
    });
  const player = z.string().describe("Username of an online player");

  tool("list_players", "Online players and where they are.", {}, () =>
    World.getPlayers().stream().filter(Boolean).map((p) => ({
      username: p.getUsername(), bot: !!p.isPlayerBot?.(), ...tile(p.getLocation()),
    })));

  tool(
    "observe",
    "Snapshot of a player: position, stats, inventory, equipment, nearby NPCs/objects/ground items, and game messages since the last observe/wait.",
    { player, radius: z.number().int().min(1).max(32).default(15) },
    ({ player: username, radius }) => {
      const p = find(username);
      const skills = p.getSkillManager();
      return {
        ...tile(p.getLocation()),
        hitpoints: p.getHitpoints(),
        runEnergy: p.getRunEnergy(),
        skills: Object.fromEntries(Skill.values().map((skill) => [skill.getName(), {
          level: skills.getCurrentLevel(skill), max: skills.getMaxLevel(skill), xp: skills.getExperience(skill),
        }])),
        inventory: items(p.getInventory()),
        equipment: items(p.getEquipment()),
        ...nearby(p, radius),
        messages: messageLog(p).splice(0),
      };
    }
  );

  tool(
    "walk_to",
    "Walk to a world tile (like a minimap click) and wait until the player arrives or gets stuck. run=true forces running. Returns result (arrived/stuck/timeout), position, hitpoints and new game messages.",
    {
      player, x: z.number().int(), y: z.number().int(), run: z.boolean().default(false),
      maxTicks: z.number().int().min(1).max(MAX_WAIT_TICKS).default(MAX_WAIT_TICKS),
    },
    async ({ player: username, x, y, run, maxTicks }) => {
      send(find(username), { type: "move", worldX: x, worldY: y, modifierFlags: run ? 2 : 0 });
      return settle(username, maxTicks, { x, y });
    }
  );

  tool(
    "interact",
    "Click an option on the nearest NPC, object or ground item with this name, then wait until the player is idle (done walking, fighting and skilling) or a dialogue/interface opens. E.g. target \"Guard\" option \"Attack\", \"Tree\"/\"Chop down\", \"Bones\"/\"Take\". Returns what was clicked, result (idle/dialogue/interface/timeout), position, hitpoints, busy reasons and new game messages.",
    {
      player, target: z.string().min(1), option: z.string().min(1),
      radius: z.number().int().min(1).max(32).default(15),
      maxTicks: z.number().int().min(1).max(MAX_WAIT_TICKS).default(20),
    },
    async ({ player: username, target, option, radius, maxTicks }) => {
      const p = find(username);
      const pick = nearest(p, target, option, radius);
      const { kind, thing } = pick;
      if (kind === "npc") send(p, npcClick(p, World.getNpcs().get(thing.index), option));
      else if (kind === "object") {
        const action = thing.options.find((o) => o.toLowerCase() === option.toLowerCase());
        send(p, { type: "object_option", id: thing.id, x: thing.x, y: thing.y, action });
      } else send(p, { type: "ground_item_action", itemId: thing.id, x: thing.x, y: thing.y, option });
      return { clicked: { kind, name: thing.name, x: thing.x, y: thing.y }, ...(await settle(username, maxTicks)) };
    }
  );

  tool(
    "npc_option",
    "Click a menu option (e.g. Talk-to, Attack, Pickpocket) on an NPC by its index from observe.",
    { player, index: z.number().int(), option: z.string() },
    ({ player: username, index, option }) => {
      const p = find(username);
      const npc = World.getNpcs().get(index);
      if (!npc) throw new Error(`No NPC at index ${index}`);
      return send(p, npcClick(p, npc, option));
    }
  );

  tool(
    "object_option",
    "Click a menu option (e.g. Chop down, Open, Climb-up) on an object at a tile.",
    { player, id: z.number().int(), x: z.number().int(), y: z.number().int(), option: z.string() },
    ({ player: username, id, x, y, option }) =>
      send(find(username), { type: "object_option", id, x, y, action: option })
  );

  tool(
    "ground_item_option",
    "Click a menu option (default Take) on a ground item.",
    { player, itemId: z.number().int(), x: z.number().int(), y: z.number().int(), option: z.string().default("Take") },
    ({ player: username, itemId, x, y, option }) =>
      send(find(username), { type: "ground_item_action", itemId, x, y, option })
  );

  tool(
    "inventory_option",
    "Click a menu option (e.g. Eat, Wield, Drop, Bury) on an inventory item, chosen by item name or slot.",
    {
      player, option: z.string(),
      item: z.string().optional().describe("Item name, e.g. Shrimps; the first matching slot is used"),
      slot: z.number().int().min(0).max(27).optional(),
    },
    ({ player: username, item: name, slot, option }) => {
      const p = find(username);
      if (name !== undefined) slot = inventorySlot(p, name);
      if (slot === undefined) throw new Error("item or slot is required");
      const item = p.getInventory().getItems()[slot];
      if (!item || item.getId() <= 0) throw new Error(`Inventory slot ${slot} is empty`);
      return send(p, { type: "inventory_action", slot, itemId: item.getId(), widgetId: 3214, option });
    }
  );

  tool(
    "use_item",
    "Use an inventory item on something, then wait until the player is idle or a dialogue/interface opens. By name: item \"Tinderbox\" with targetItem \"Logs\" (another inventory item) or target \"Fire\" (nearest NPC, object or ground item). Raw form: slot plus on=inventory/npc/loc/ground/player with targetSlot or id (+ x, y).",
    {
      player,
      item: z.string().optional().describe("Inventory item name to use"),
      slot: z.number().int().min(0).max(27).optional(),
      targetItem: z.string().optional().describe("Another inventory item, by name"),
      target: z.string().optional().describe("Nearest NPC, object or ground item, by name"),
      on: z.enum(["inventory", "npc", "loc", "ground", "player"]).optional(),
      targetSlot: z.number().int().optional(),
      id: z.number().int().optional(),
      x: z.number().int().optional(),
      y: z.number().int().optional(),
      maxTicks: z.number().int().min(1).max(MAX_WAIT_TICKS).default(20),
    },
    async ({ player: username, item: name, slot, targetItem, target: targetName, on, targetSlot, id, x, y, maxTicks }) => {
      const p = find(username);
      if (name !== undefined) slot = inventorySlot(p, name);
      if (slot === undefined) throw new Error("item or slot is required");
      const inventory = p.getInventory().getItems();
      const item = inventory[slot];
      if (!item || item.getId() <= 0) throw new Error(`Inventory slot ${slot} is empty`);
      const level = p.getLocation().getZ();
      let target;
      if (targetItem !== undefined) {
        const other = inventorySlot(p, targetItem, slot);
        target = { kind: "inventory", slot: other, itemId: inventory[other].getId() };
      } else if (targetName !== undefined) {
        const { kind, thing } = nearest(p, targetName, undefined, 15);
        target = kind === "npc" ? { kind: "npc", id: thing.index }
          : { kind: kind === "object" ? "loc" : "ground", id: thing.id, x: thing.x, y: thing.y, level };
      } else if (on === "inventory") {
        const other = inventory[targetSlot];
        if (!other || other.getId() <= 0) throw new Error(`Inventory slot ${targetSlot} is empty`);
        target = { kind: "inventory", slot: targetSlot, itemId: other.getId() };
      } else if (on) {
        if (id === undefined) throw new Error("id is required");
        target = { kind: on, id, x, y, level };
      } else throw new Error("Give targetItem, target, or on");
      send(p, { type: "inventory_use_on", slot, itemId: item.getId(), target });
      return settle(username, maxTicks);
    }
  );

  tool(
    "dialogue",
    "Read the open dialogue: kind (npc/player/statement/item/options), speaker, text, and options to pick from. Returns null when no dialogue is open.",
    { player },
    ({ player: username }) => readDialogue(find(username))
  );

  tool(
    "dialogue_continue",
    "Click to continue the open dialogue (\"Click here to continue\"), then return the next dialogue (null if it ended) and player status.",
    { player },
    async ({ player: username }) => {
      const p = find(username);
      const dialogue = readDialogue(p);
      if (!dialogue) throw new Error("No dialogue is open");
      if (dialogue.kind === "options") throw new Error(`Pick an option with dialogue_choose: ${dialogue.options.join(" | ")}`);
      send(p, { type: "dialogue_continue", widgetId: p.getPacketSender().chatboxGroupId << 16, childIndex: -1 });
      await sleepTicks(1);
      return { dialogue: readDialogue(find(username)), ...status(find(username)) };
    }
  );

  tool(
    "dialogue_choose",
    "Pick an option in the open options dialogue by its text (exact or partial, e.g. \"Yes\") or its 1-based number, then return the next dialogue and player status.",
    { player, option: z.union([z.string().min(1), z.number().int().min(1).max(5)]) },
    async ({ player: username, option }) => {
      const p = find(username);
      const dialogue = readDialogue(p);
      if (dialogue?.kind !== "options") throw new Error(dialogue ? "This dialogue has no options; use dialogue_continue" : "No dialogue is open");
      const lower = String(option).toLowerCase();
      let index = typeof option === "number" ? option - 1 : dialogue.options.findIndex((o) => o.toLowerCase() === lower);
      if (index < 0) index = dialogue.options.findIndex((o) => o.toLowerCase().includes(lower));
      if (!dialogue.options[index]) throw new Error(`No option "${option}"; options: ${dialogue.options.join(" | ")}`);
      const prompt = MultiChatboxPrompt?.describe(p);
      const groupId = p.getPacketSender().chatboxGroupId;
      send(p, prompt
        ? { type: "dialogue_continue", widgetId: prompt.widgetId, childIndex: index + 1 }
        : { type: "widget_action", widgetId: groupId << 16, groupId, childId: 0, buttonNum: index + 1 });
      await sleepTicks(1);
      return { chose: dialogue.options[index], dialogue: readDialogue(find(username)), ...status(find(username)) };
    }
  );

  tool(
    "close_interface",
    "Close the open interface or dialogue (bank, shop, ...), like pressing Esc.",
    { player },
    ({ player: username }) => send(find(username), { type: "interface_close" })
  );

  tool(
    "bank",
    "List the items in the open bank (name, amount).",
    { player },
    ({ player: username }) => bankEntries(find(username)).map(({ name, amount }) => ({ name, amount }))
  );

  tool(
    "bank_withdraw",
    "Withdraw an item from the open bank by name. amount is a number or \"all\".",
    { player, item: z.string().min(1), amount: amountSchema },
    async ({ player: username, item: name, amount }) => {
      const p = find(username);
      const entry = byName(bankEntries(p), name, "the bank");
      const all = amount === "all" || amount >= entry.amount;
      // With the bank open, an entered amount becomes the X quantity, as when the client answers Withdraw-X.
      return clickEach(username, all ? ["All"] : ["amount", "X"], (p, step) => step === "amount"
        ? { type: "dialogue_amount", amount }
        : {
          type: "widget_action", widgetId: (Bank.MAIN_INTERFACE_ID << 16) | 12, groupId: Bank.MAIN_INTERFACE_ID,
          childId: 12, slot: entry.slot, itemId: entry.itemId, buttonNum: 1, option: `Withdraw-${step}`,
        });
    }
  );

  tool(
    "bank_deposit",
    "Deposit an inventory item into the open bank by name (amount is a number or \"all\"), or everything in the inventory when item is omitted.",
    { player, item: z.string().min(1).optional(), amount: amountSchema },
    async ({ player: username, item: name, amount }) => {
      const p = find(username);
      bankEntries(p);
      const groupId = Bank.MAIN_INTERFACE_ID;
      if (name === undefined) {
        send(p, { type: "widget_action", widgetId: (groupId << 16) | 41, groupId, childId: 41, buttonNum: 1 });
        await sleepTicks(1);
        return status(find(username));
      }
      const slot = inventorySlot(p, name);
      const itemId = p.getInventory().getItems()[slot].getId();
      const all = amount === "all" || amount >= carried(p, itemId);
      return clickEach(username, all ? ["All"] : ["amount", "X"], (p, step) => step === "amount"
        ? { type: "dialogue_amount", amount }
        : {
          type: "widget_action", widgetId: (Bank.SIDE_INTERFACE_ID << 16) | 3, groupId: Bank.SIDE_INTERFACE_ID,
          childId: 3, slot, itemId, buttonNum: 1, option: `Deposit-${step}`,
        });
    }
  );

  tool(
    "shop",
    "List the open shop's stock: name, amount in stock and price, plus the currency it trades in.",
    { player },
    ({ player: username }) => {
      const shop = openShop(find(username));
      return { ...shop, items: shop.items.map(({ name, amount, price }) => ({ name, amount, price })) };
    }
  );

  tool(
    "shop_buy",
    "Buy an item from the open shop by name.",
    { player, item: z.string().min(1), amount: z.number().int().min(1).default(1) },
    async ({ player: username, item: name, amount }) => {
      const entry = byName(openShop(find(username)).items, name, "the shop");
      const groupId = ShopManager.MAIN_INTERFACE_ID;
      return clickEach(username, clicks(amount, [50, 10, 5, 1]), (p, step) => {
        const current = openShop(p).items.find((e) => e.itemId === entry.itemId);
        if (!current) return null;
        return {
          type: "widget_action", widgetId: (groupId << 16) | 16, groupId, childId: 16,
          slot: current.slot + 1, itemId: current.itemId, buttonNum: 1, option: `Buy ${step}`,
        };
      });
    }
  );

  tool(
    "shop_sell",
    "Sell an inventory item to the open shop by name. amount is a number or \"all\".",
    { player, item: z.string().min(1), amount: amountSchema },
    async ({ player: username, item: name, amount }) => {
      const p = find(username);
      openShop(p);
      const itemId = p.getInventory().getItems()[inventorySlot(p, name)].getId();
      const total = carried(p, itemId);
      const groupId = ShopManager.SIDE_INTERFACE_ID;
      return clickEach(username, clicks(amount === "all" ? total : Math.min(amount, total), [50, 10, 5, 1]), (p, step) => {
        const slot = items(p.getInventory()).find((e) => e.id === itemId)?.slot;
        if (slot === undefined) return null;
        return { type: "widget_action", widgetId: groupId << 16, groupId, childId: 0, slot, itemId, buttonNum: 1, option: `Sell ${step}` };
      }, !ItemDefinition.forId(itemId).isStackable?.());
    }
  );

  tool(
    "chat",
    "Say something in public chat. Text starting with :: runs a command (e.g. ::tele 3222 3218, ::item 1351) if the player has the rights.",
    { player, text: z.string().min(1).max(200) },
    ({ player: username, text }) => send(find(username), { type: "chat", text, messageType: "public" })
  );

  tool(
    "send_packet",
    "Escape hatch: send any decoded client message (see ClientMessage in net/protocol/ClientProtocol.ts), e.g. {\"type\":\"dialogue_continue\",\"widgetId\":15138821,\"childIndex\":-1}.",
    { player, message: z.object({ type: z.string() }).passthrough() },
    ({ player: username, message }) => send(find(username), message)
  );

  tool(
    "wait_ticks",
    "Wait some game ticks (0.6s each), then return position, hitpoints, busy reasons, any open dialogue/interface and new game messages.",
    { player, ticks: z.number().int().min(1).max(MAX_WAIT_TICKS).default(3) },
    async ({ player: username, ticks }) => {
      find(username);
      await sleepTicks(ticks);
      return status(find(username));
    }
  );

  return server;
}

module.exports = {
  name: "AgentMcp",
  buildMcpServer,
  register(api) {
    if (process.env.AGENT_MCP !== "1") return;
    const port = Number(process.env.AGENT_MCP_PORT) || DEFAULT_PORT;
    const httpServer = http.createServer(async (request, response) => {
      if (!request.url?.startsWith("/mcp")) {
        response.statusCode = 404;
        response.end();
        return;
      }
      // Stateless: a fresh server per request, players are named on every tool call.
      const server = buildMcpServer(api.core);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableDnsRebindingProtection: true,
        allowedHosts: [`127.0.0.1:${port}`, `localhost:${port}`],
      });
      response.on("close", () => {
        transport.close();
        server.close();
      });
      try {
        await server.connect(transport);
        await transport.handleRequest(request, response);
      } catch (error) {
        console.warn("[agent-mcp] request failed", error);
        if (!response.headersSent) {
          response.statusCode = 500;
          response.end();
        }
      }
    });
    httpServer.on("error", (error) => console.error("[agent-mcp] server error", error.message));
    // Localhost only: anyone who can reach this can drive any online player.
    httpServer.listen(port, "127.0.0.1", () =>
      console.info(`[agent-mcp] listening on http://127.0.0.1:${port}/mcp`));
    api.onServerShutdown(() => httpServer.close());
  },
};
