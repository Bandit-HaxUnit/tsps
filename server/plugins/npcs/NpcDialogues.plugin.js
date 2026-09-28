/**
 * Talk-to dialogues from data/definitions/npc-dialogues.json (+ the osrsreboxed
 * id index, npc-dialogue-index.json).
 *
 * The cache NPC id selects the transcript page(s) and variant; quest plugins can
 * override the choice (onNpcDialogueVariant) and answer the wiki prose conditions
 * (onNpcDialogueCondition). Choice/condition steps emit custom events
 * ("npc-dialogue:choice" / "npc-dialogue:condition") so quests can run their own
 * game logic (set stage, hand in items) without re-authoring the words, and each
 * speech line emits "npc-dialogue:line" with a mutable `skip` so a quest can drop
 * lines that no longer apply (e.g. handing over an item the player does not have).
 * Speech, choices, random alternatives and named shops run through existing systems.
 */
const fs = require("fs");
const path = require("path");
const { GameConstants } = require("../../src/main/typescript/elvarg/game/GameConstants");
const { Misc } = require("../../src/main/typescript/elvarg/util/Misc");
const { PluginManager } = require("../../src/main/typescript/elvarg/plugins/PluginManager");
const { DialogueChainBuilder } = require("../../src/main/typescript/elvarg/game/model/dialogues/builders/DialogueChainBuilder");
const { NpcDialogue } = require("../../src/main/typescript/elvarg/game/model/dialogues/entries/impl/NpcDialogue");
const { PlayerDialogue } = require("../../src/main/typescript/elvarg/game/model/dialogues/entries/impl/PlayerDialogue");
const { ActionDialogue } = require("../../src/main/typescript/elvarg/game/model/dialogues/entries/impl/ActionDialogue");
const { ShopDefinition } = require("../../src/main/typescript/elvarg/game/definition/ShopDefinition");
const { ShopManager } = require("../../src/main/typescript/elvarg/game/model/container/shop/ShopManager");

// These NPCs have executable plugin conversations, not an imported prose transcript.
const SPECIAL_NPC_DIALOGUES = new Set(["Skully"]);

/**
 * Most records list several variants and name no default, which used to leave the
 * NPC silent. Prefer the standard talk transcript over overhead shouts.
 */
function pickVariant(npc) {
  if (Array.isArray(npc?.steps)) return npc.steps;
  const variants = npc?.variants;
  if (!variants) return undefined;
  const keys = Object.keys(variants);
  const key = (npc.default != null && keys.includes(npc.default) ? npc.default : undefined)
    ?? keys.find((name) => name.startsWith("standard"))
    ?? keys.find((name) => !name.startsWith("overhead"));
  return Array.isArray(variants[key]) ? variants[key] : undefined;
}

/**
 * Transcripts are keyed by wiki page title while NPC names come from the cache,
 * so "Hops" has to reach "Hops (Biohazard)". First usable disambiguated key wins.
 * The id index is preferred; this name fallback covers NPCs the index misses.
 */
function aliasKeys(data) {
  const aliases = new Map();
  for (const key of Object.keys(data)) {
    const base = key.replace(/ \(.+\)$/, "");
    if (base !== key && !aliases.has(base) && pickVariant(data[key])) aliases.set(base, key);
  }
  return aliases;
}

/** True when a branch ends in a wiki "continues" marker. */
function continues(steps) {
  for (const step of steps ?? []) {
    if (step.type === "jump") {
      if (/^continue/i.test(step.reference ?? "")) return true;
      continue;
    }
    if (continues(step.steps)) return true;
    for (const option of step.options ?? []) {
      if (continues(option.steps)) return true;
    }
  }
  return false;
}

/**
 * Flatten a transcript into a linear play queue.
 *
 * Conditions are resolved through `opts.resolveCondition` (true/false/null). For a
 * run of sibling conditions the first true one wins, else the first the resolver
 * could not answer (so behaviour is unchanged when no plugin resolves them), else
 * the first. Jumps resolve through `opts.resolveJump`; unresolved jumps fall
 * through. `opts.wrapBranch` can splice bookkeeping steps in front of a chosen
 * branch.
 */
function flatten(steps, opts = {}) {
  const resolveCondition = typeof opts.resolveCondition === "function" ? opts.resolveCondition : () => null;
  const resolveJump = typeof opts.resolveJump === "function" ? opts.resolveJump : () => null;
  const wrapBranch = typeof opts.wrapBranch === "function" ? opts.wrapBranch : (_chosen, branch) => branch;

  const out = [];
  for (let position = 0; position < steps.length; position++) {
    if (opts.stopped) break;
    const step = steps[position];
    if (step.type === "jump") {
      const target = resolveJump(step);
      // "end": a menu jump we cannot replay (shows other/previous options).
      // Stop rather than leak into whatever step follows the condition.
      if (target === "end") {
        out.push({ type: "end" });
        opts.stopped = true;
        break;
      }
      if (Array.isArray(target)) out.push(...flatten(target, opts));
      continue;
    }
    if (step.type !== "condition") {
      out.push(step);
      continue;
    }
    const runStart = position;
    while (steps[position + 1]?.type === "condition") position++;
    const run = steps.slice(runStart, position + 1);
    const answers = run.map((condition) => resolveCondition(condition));
    let chosen = answers.findIndex((answer) => answer === true);
    if (chosen === -1) chosen = answers.findIndex((answer) => answer === null);
    if (chosen === -1) chosen = 0;
    const step_ = run[chosen];
    out.push(...wrapBranch(step_, flatten(step_.steps || [], opts)));
    if (opts.stopped) break;
    if (continues(step_.steps)) {
      out.push(...flatten(run.slice(chosen + 1), opts));
      if (opts.stopped) break;
    }
  }
  return out;
}

function startDialogue(api, event, steps, branches = {}, context = {}) {
  const { player } = event;
  const manager = player.getDialogueManager();
  const npcId = event.npcId;
  const definition = event.definition;
  const close = () => player.getPacketSender().sendInterfaceRemoval();
  const unavailable = () => {
    close();
    player.sendMessage("That conversation isn't available right now.");
  };

  // Ordered option records power the wiki "jump above" shortcut (repeated menus).
  const records = [];
  const recordsByText = new Map();
  const optionRecords = new WeakMap();
  const recordOption = (option) => {
    let record = optionRecords.get(option);
    if (record) return record;
    record = { id: records.length, text: String(option.text ?? ""), steps: Array.isArray(option.steps) ? option.steps : [] };
    optionRecords.set(option, record);
    records.push(record);
    const list = recordsByText.get(record.text);
    if (list) list.push(record); else recordsByText.set(record.text, [record]);
    return record;
  };

  const resolveCondition = (step) =>
    PluginManager.emitNpcDialogueCondition({
      player, npc: event.npc, npcId, definition, pages: context.pages,
      text: step.text, stepId: step.id,
    });

  // "jump above" targets the same option's earlier occurrence, else the option
  // defined just before this one. Wiki jump ids lost their targets in the dump.
  // "shows other/previous/initial options" jumps ({{tact|other}} etc.) would need
  // a menu stack to replay; end cleanly instead of falling into the next step.
  const resolveJump = (step) => {
    const reference = String(step.reference ?? "");
    if (/^(other|previous\d*|initial)/i.test(reference)) return "end";
    if (!/^above/i.test(reference)) return null;
    const current = context.currentRecord;
    if (!current) return records.length ? records[records.length - 1].steps : "end";
    const sameText = (recordsByText.get(current.text) ?? []).find((record) => record.steps !== current.steps);
    const target = sameText ?? (current.id > 0 ? records[current.id - 1] : undefined);
    return target ? target.steps : "end";
  };

  const flattenOptions = () => ({ resolveCondition, resolveJump,
    wrapBranch: (chosen, branch) => [{ type: "condition_chosen", id: chosen.id, text: chosen.text }, ...branch] });

  function choices(step, rest, record, offset = 0) {
    const options = step.options || [];
    const more = options.length - offset > 5;
    const visible = options.slice(offset, offset + (more ? 4 : 5));
    // Record every option when the prompt is shown (not on selection) so that a
    // nested option's "jump above" can find its unselected sibling by text.
    visible.forEach(recordOption);
    const pairs = visible.flatMap((option) => [option.text, () => {
      // Quest-gated choices carry a slug like "quest:cook-s-assistant:start";
      // let the owning quest run its action, then play the branch.
      if (option.hook) {
        api.emitCustomEvent("npc-dialogue:hook", { player, npc: event.npc, npcId, definition, hook: option.hook, quest: option.quest, option: option.text });
      }
      api.emitCustomEvent("npc-dialogue:choice", { player, npc: event.npc, npcId, definition, option: option.text, stepId: option.id });
      run([...(option.steps || []), ...rest], recordOption(option));
    }]);
    if (more) pairs.push("More...", () => choices(step, rest, record, offset + 4));
    if (visible.length === 1) pairs.push("Goodbye.", close);
    if (!pairs.length) return close();
    manager.reset();
    if (!api.sendMultiChatboxPrompt(player, step.prompt || "Select an Option", ...pairs)) {
      unavailable();
    }
  }

  function run(steps, currentRecord) {
    const previous = context.currentRecord;
    context.currentRecord = currentRecord;
    const queue = flatten(steps, flattenOptions());
    context.currentRecord = previous;
    const chain = new DialogueChainBuilder();
    let index = 0;
    for (let position = 0; position < queue.length; position++) {
      const step = queue[position];
      const rest = [...(step.steps || []), ...queue.slice(position + 1)];
      if (step.type === "condition_chosen") {
        chain.add(new ActionDialogue(index++, { execute: () => {
          api.emitCustomEvent("npc-dialogue:condition", { player, npc: event.npc, npcId, definition, text: step.text, stepId: step.id });
          run(rest, currentRecord);
        } }));
        manager.startDialogues(chain);
        return;
      }
      const namedNpc = step.type === "line" && step.speaker === definition.getName();
      if (!step.hook && (typeof step.npc === "string" || typeof step.player === "string" || namedNpc)) {
        const isPlayer = typeof step.player === "string";
        const speech = isPlayer ? step.player : namedNpc ? step.text : step.npc;
        // Let a plugin skip a line through the mutable payload (as slayer:assignment),
        // e.g. a hand-over line for an item the player is no longer carrying.
        const request = { player, npc: event.npc, npcId, definition, step, text: speech, skip: false };
        api.emitCustomEvent("npc-dialogue:line", request);
        if (request.skip) {
          if (step.steps?.length) {
            run(rest, currentRecord);
            return;
          }
          continue;
        }
        const lines = Misc.wrapText(speech, 53);
        for (let start = 0; start < lines.length; start += 4) {
          const text = lines.slice(start, start + 4).join(" ");
          chain.add(isPlayer
            ? new PlayerDialogue(index++, text)
            : new NpcDialogue(index++, definition.getId(), text));
        }
        if (step.steps?.length) {
          chain.add(new ActionDialogue(index++, { execute: () => run(rest, currentRecord) }));
          manager.startDialogues(chain);
          return;
        }
        continue;
      }
      chain.add(new ActionDialogue(index++, { execute: () => {
        // Action steps can carry a quest slug; emit it, then continue the branch.
        if (step.hook) {
          api.emitCustomEvent("npc-dialogue:hook", { player, npc: event.npc, npcId, definition, hook: step.hook, quest: step.quest, action: step.action });
          return run(rest, currentRecord);
        }
        if (step.type === "end") return close();
        if (step.type === "message") {
          player.sendMessage(String(step.text ?? ""));
          return run(rest, currentRecord);
        }
        // Wiki markers for content this server does not implement.
        if (step.type === "unavailable" || step.type === "reference") return unavailable();
        if (step.type === "call" && Object.hasOwn(branches, step.branch) && Array.isArray(branches[step.branch])) {
          return run([...branches[step.branch], ...rest], currentRecord);
        }
        if (step.type === "choice") return choices(step, rest, currentRecord);
        if (step.type === "random" && step.options?.length) {
          const option = step.options[Math.floor(Math.random() * step.options.length)];
          if (option.hook) return unavailable();
          return run([...(option.steps || []), ...rest], currentRecord);
        }
        if (step.type === "action" && step.action === "open_shop") {
          const target = step.target;
          const shops = ShopDefinition.all().filter((shop) => shop.getName() === target);
          if (shops.length === 1) {
            close();
            if (ShopManager.open(player, shops[0].getId(), true)) return;
          }
        }
        if (step.type === "action" && step.action === "slayer_assignment") {
          const request = { player, master: step.target, npcId, definitionId: definition?.getId?.(), npcName: definition?.getName?.(), line: null };
          api.emitCustomEvent("slayer:assignment", request);
          if (request.line) return run([{ npc: request.line }, ...rest], currentRecord);
        }
        if (step.type === "action" && step.action === "slayer_task_tip") {
          const request = { player, master: step.target, line: null };
          api.emitCustomEvent("slayer:task-tip", request);
          if (request.line) return run([{ npc: request.line }, ...rest], currentRecord);
        }
        // ponytail: prose effects have no executable contract. Stop safely.
        unavailable();
      } }));
      manager.startDialogues(chain);
      return;
    }
    chain.add(new ActionDialogue(index, { execute: close }));
    manager.startDialogues(chain);
  }
  run(steps, undefined);
}

module.exports = {
  name: "NpcDialogues",
  // Exported for tests/npc-dialogues.test.cjs; nothing else reads them.
  pickVariant,
  aliasKeys,
  flatten,
  startDialogue,
  register(api) {
    const dialogueFile = path.join(GameConstants.DEFINITIONS_DIRECTORY, "npc-dialogues.json");
    const indexFile = path.join(GameConstants.DEFINITIONS_DIRECTORY, "npc-dialogue-index.json");
    // Parsed on the first Talk-to rather than at boot: the 17 MiB transcript dump expands
    // to ~35 MiB of objects, and a world where nobody talks never needs it.
    let loaded;
    const load = () => {
      if (loaded) return loaded;
      const data = JSON.parse(fs.readFileSync(dialogueFile, "utf8"));
      if (!data || typeof data !== "object" || Array.isArray(data)) {
        throw new Error(`${dialogueFile}: expected dialogues keyed by transcript name`);
      }
      for (const [name, npc] of Object.entries(data)) {
        if (npc.steps !== undefined && !Array.isArray(npc.steps)) {
          throw new Error(`${dialogueFile}: ${name} has non-array steps`);
        }
        if (npc.default != null && !Object.hasOwn(npc.variants ?? {}, npc.default)) {
          throw new Error(`${dialogueFile}: ${name} names a missing default variant`);
        }
      }
      let index = {};
      try {
        index = JSON.parse(fs.readFileSync(indexFile, "utf8"));
      } catch {
        index = {};
      }
      loaded = { data, aliases: aliasKeys(data), index };
      return loaded;
    };

    /**
     * Resolve the transcript for an NPC: id index first (with the plugin variant
     * selector), cache name second.
     */
    const resolveTranscript = (event) => {
      const { data, aliases, index } = load();
      const npcId = event.npcId;
      const pages = (Array.isArray(index[String(npcId)]) ? index[String(npcId)] : [])
        .map((entry) => ({ page: String(entry.page ?? "").replace(/^Transcript:/, ""), variants: Array.isArray(entry.variants) ? entry.variants : [] }))
        .filter((entry) => Object.hasOwn(data, entry.page));
      const context = { player: event.player, npc: event.npc, npcId, definition: event.definition, pages };

      if (pages.length) {
        const choice = PluginManager.emitNpcDialogueVariant(context);
        const wanted = typeof choice === "string" ? choice : choice?.variant;
        if (wanted) {
          const page = typeof choice === "object" && choice.page
            ? pages.find((entry) => entry.page === choice.page)
            : pages.find((entry) => entry.variants.includes(wanted));
          const steps = page ? data[page.page]?.variants?.[wanted] : undefined;
          if (Array.isArray(steps)) return { steps, branches: data[page.page]?.branches, context };
        }
        const first = pages.find((entry) => pickVariant(data[entry.page]));
        if (first) return { steps: pickVariant(data[first.page]), branches: data[first.page]?.branches, context };
      }

      const name = event.definition.getName();
      let record = Object.hasOwn(data, name) ? data[name] : undefined;
      if (!pickVariant(record) && aliases.has(name)) record = data[aliases.get(name)];
      const steps = pickVariant(record);
      return steps ? { steps, branches: record?.branches, context } : null;
    };

    api.onAnyNpcInteraction({
      "Talk-to": (event) => {
        const name = event.definition.getName();
        if (SPECIAL_NPC_DIALOGUES.has(name)) return false;
        const resolved = resolveTranscript(event);
        startDialogue(api, event, resolved?.steps?.length ? resolved.steps : [
          { npc: "Sorry, i've nothing interesting to talk about yet" },
        ], resolved?.branches, resolved?.context);
        return true;
      },
    });
  },
};
