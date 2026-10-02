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
  const { World, MapObjects, ObjectDefinition, ItemDefinition, Skill, GameConstants, TaskManager } = core;
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
  const waitingOn = (p) =>
    p.getDialogueManager?.()?.isActive() ? "dialogue" : p.getInterfaceId?.() > 0 ? "interface" : null;
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
      const here = p.getLocation();
      const { npcs, objects, groundItems } = nearby(p, radius);
      const named = (thing) => thing.name?.toLowerCase() === target.toLowerCase();
      const hasOption = (thing) => thing.options.some((o) => o.toLowerCase() === option.toLowerCase());
      // Ground items carry no option list, so any option is allowed on them.
      const candidates = [
        ...npcs.filter(named).filter(hasOption).map((thing) => ({ kind: "npc", thing })),
        ...objects.filter(named).filter(hasOption).map((thing) => ({ kind: "object", thing })),
        ...groundItems.filter(named).map((thing) => ({ kind: "ground item", thing })),
      ];
      const distance = ({ thing }) => Math.max(Math.abs(thing.x - here.getX()), Math.abs(thing.y - here.getY()));
      const pick = candidates.sort((a, b) => distance(a) - distance(b))[0];
      if (!pick) {
        const matches = [...npcs, ...objects].filter(named);
        if (matches.length) {
          const options = [...new Set(matches.flatMap((thing) => thing.options))];
          throw new Error(`No nearby "${target}" has a "${option}" option; options: ${options.join(", ")}`);
        }
        const names = [...new Set([...npcs, ...objects, ...groundItems].map((thing) => thing.name).filter(Boolean))];
        throw new Error(`Nothing named "${target}" within ${radius} tiles; nearby: ${names.join(", ")}`);
      }

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
      const inventory = items(p.getInventory());
      if (name !== undefined) {
        slot = inventory.find((entry) => entry.name?.toLowerCase() === name.toLowerCase())?.slot;
        if (slot === undefined) {
          throw new Error(`No "${name}" in inventory; have: ${inventory.map((entry) => entry.name).join(", ") || "nothing"}`);
        }
      }
      if (slot === undefined) throw new Error("item or slot is required");
      const item = p.getInventory().getItems()[slot];
      if (!item || item.getId() <= 0) throw new Error(`Inventory slot ${slot} is empty`);
      return send(p, { type: "inventory_action", slot, itemId: item.getId(), widgetId: 3214, option });
    }
  );

  tool(
    "use_item",
    "Use an inventory item on something: another inventory slot, an NPC (index), an object (id + tile), a ground item (id + tile) or a player (index).",
    {
      player,
      slot: z.number().int().min(0).max(27),
      on: z.enum(["inventory", "npc", "loc", "ground", "player"]),
      targetSlot: z.number().int().optional(),
      id: z.number().int().optional(),
      x: z.number().int().optional(),
      y: z.number().int().optional(),
    },
    ({ player: username, slot, on, targetSlot, id, x, y }) => {
      const p = find(username);
      const inventory = p.getInventory().getItems();
      const item = inventory[slot];
      if (!item || item.getId() <= 0) throw new Error(`Inventory slot ${slot} is empty`);
      let target;
      if (on === "inventory") {
        const other = inventory[targetSlot];
        if (!other || other.getId() <= 0) throw new Error(`Inventory slot ${targetSlot} is empty`);
        target = { kind: "inventory", slot: targetSlot, itemId: other.getId() };
      } else {
        if (id === undefined) throw new Error("id is required");
        target = { kind: on, id, x, y, level: p.getLocation().getZ() };
      }
      return send(p, { type: "inventory_use_on", slot, itemId: item.getId(), target });
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
      const server = buildMcpServer({ ...api.core, TaskManager: api.getTaskManager() });
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
