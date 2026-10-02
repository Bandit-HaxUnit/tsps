// Run after `yarn build`: node --test tests/npc-dialogues.test.cjs
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { pickVariant, aliasKeys, flatten, startDialogue } = require('../plugins/npcs/NpcDialogues.plugin');

const data = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/definitions/npc-dialogues.json'), 'utf8'));
const aliases = aliasKeys(data);
const talk = (name) => {
  const record = pickVariant(data[name]) ? data[name] : data[aliases.get(name)];
  return pickVariant(record);
};

test('a variant is chosen when the dump names no default', () => {
  assert.equal(pickVariant({ default: 'b', variants: { a: [{ npc: 'a' }], b: [{ npc: 'b' }] } })[0].npc, 'b');
  assert.equal(pickVariant({ default: null, variants: { 'overhead-x': [1], 'standard-y': [2] } })[0], 2);
  assert.equal(pickVariant({ default: null, variants: { 'if-poisoned': [3] } })[0], 3);
  // Overhead shouts are not a conversation; stay silent rather than yell at the player.
  assert.equal(pickVariant({ default: null, variants: { 'overhead-x': [1] } }), undefined);
  assert.equal(pickVariant(undefined), undefined);
  // Larran and Pox are variant-only records that used to resolve to nothing.
  for (const name of ['Larran', 'Pox', 'Emblem Trader', 'Ferox', 'Lisa']) assert.ok(talk(name)?.length, name);
});

test('cache names reach disambiguated wiki keys', () => {
  assert.equal(aliases.get('Hops'), 'Hops (Biohazard)');
  // A bare key wins when it is usable; "Guard" is overhead-only, so the alias takes over.
  assert.equal(pickVariant(data['Guard']), undefined);
  for (const name of ['Hops', 'Guard', 'Bartender', 'Wizard']) assert.ok(talk(name)?.length, name);
});

test('prose conditions take their first branch and dead jumps fall through', () => {
  const steps = flatten([
    { npc: 'hello' },
    { type: 'condition', text: 'If A:', steps: [{ npc: 'branch A' }, { type: 'jump', id: 'nowhere' }] },
    { type: 'condition', text: 'If B:', steps: [{ npc: 'branch B' }] },
    { npc: 'shared tail' },
  ]);
  assert.deepEqual(steps.map((step) => step.npc), ['hello', 'branch A', 'shared tail']);
  assert.deepEqual(flatten([{ type: 'condition', steps: [{ type: 'condition', steps: [{ npc: 'deep' }] }] }]),
    [{ npc: 'deep' }]);
  // Perdu opens on a condition, so the whole conversation used to be unreachable.
  assert.equal(flatten(talk('Perdu'))[0].npc,
    "It seems you're missing out on some valuable experience. Would you like it?");
});

test('a condition branch that continues reaches the next sibling check', () => {
  const steps = flatten([
    {
      type: 'condition', text: 'If high combat:', steps: [
        { npc: 'very strong' },
        {
          type: 'choice',
          options: [
            { text: 'no', steps: [{ player: 'no' }, { type: 'jump', reference: 'continues' }] },
            { text: 'yes', steps: [{ player: 'yes' }, { type: 'end' }] },
          ],
        },
      ],
    },
    { type: 'condition', text: "If no assignment:", steps: [{ npc: 'assigned' }] },
    { type: 'condition', text: 'If has assignment:', steps: [{ npc: 'still hunting' }] },
  ]);
  // The detour keeps its prompt, then falls through to the first following check.
  assert.deepEqual(steps.map((step) => step.npc).filter(Boolean), ['very strong', 'assigned']);
});

test('a nested "jump above" reaches an unselected sibling instead of looping', () => {
  // The nested option's jump is written "above"; its target is the sibling of the
  // same text on the outer menu, which has not been selected yet.
  const tree = [
    { npc: 'I need help.' },
    {
      type: 'choice', prompt: 'Q1', options: [
        {
          text: 'Outer', steps: [
            { npc: 'nested' },
            {
              type: 'choice', prompt: 'Q2', options: [
                { text: "What's wrong?", steps: [{ type: 'jump', reference: 'above' }] },
                { text: 'Nothing', steps: [{ type: 'end' }] },
              ],
            },
          ],
        },
        {
          text: "What's wrong?", steps: [
            { npc: 'detail' },
            {
              type: 'choice', prompt: 'Q3', options: [
                { text: 'Start?', steps: [{ npc: 'starting' }] },
                { text: 'No', steps: [{ type: 'end' }] },
              ],
            },
          ],
        },
      ],
    },
  ];

  const script = ['Outer', "What's wrong?", 'No'];
  const prompts = [];
  const player = {
    getDialogueManager: () => ({
      reset() {},
      startDialogues(chain) {
        for (const entry of [...chain.getDialogues().values()].sort((a, b) => a.getIndex() - b.getIndex())) {
          try { entry.send(player); } catch { /* unwired dialogue entries are fine here */ }
        }
      },
    }),
    getPacketSender: () => ({ sendInterfaceRemoval() {} }),
    sendMessage() {},
  };
  const definition = { getName: () => 'Cook', getId: () => 4626 };
  const api = {
    emitCustomEvent() {},
    sendMultiChatboxPrompt(_player, title, ...pairs) {
      assert.ok(prompts.length < 10, 'dialogue looped');
      const options = [];
      for (let i = 0; i < pairs.length; i += 2) options.push({ text: pairs[i], cb: pairs[i + 1] });
      prompts.push(title);
      const pick = options.find((option) => option.text === script[prompts.length - 1]) ?? options[0];
      pick.cb();
      return true;
    },
  };
  const event = { player, npc: { getId: () => 4626 }, npcId: 4626, definition };
  startDialogue(api, event, tree, {}, { player, npc: event.npc, npcId: 4626, definition, pages: [] });

  assert.deepEqual(prompts, ['Q1', 'Q2', 'Q3']);
});

test('a jump after a repeated question carries on as that question, judged when it is reached', () => {
  // Percy's unlocks: buying, then asking again, must not offer what was just bought, and the
  // branch that jumps back into itself ("That'll be 200 nuggets") must not recurse forever.
  const { PluginManager } = require('../dist/plugins/PluginManager');
  let unlocked = false;
  const condition = { pluginName: 'test', handler: ({ text }) => (text === 'If locked:' ? !unlocked : text === 'If unlocked:' ? unlocked : null) };
  PluginManager.npcDialogueConditionHooks.unshift(condition);
  const said = [];
  const picks = ['Anything to unlock?', 'Buy', 'Anything to unlock?'];
  const player = {
    getDialogueManager: () => ({
      reset() {},
      startDialogues(chain) {
        for (const entry of [...chain.getDialogues().values()].sort((a, b) => a.getIndex() - b.getIndex())) {
          if (entry.text) said.push(entry.text);
          try { entry.send(player); } catch { /* unwired dialogue entries are fine here */ }
        }
      },
    }),
    getPacketSender: () => ({ sendInterfaceRemoval() {} }),
    sendMessage() {},
  };
  const api = {
    emitCustomEvent(name, payload) {
      if (name === 'npc-dialogue:action' && payload.stepId === 'pay' && payload.kind === 'message') unlocked = true;
    },
    sendMultiChatboxPrompt(_player, _title, ...pairs) {
      const options = [];
      for (let i = 0; i < pairs.length; i += 2) options.push({ text: pairs[i], cb: pairs[i + 1] });
      const pick = options.find((option) => option.text === picks[0]);
      if (!pick) return true;
      picks.shift();
      pick.cb();
      return true;
    },
  };
  const question = (steps) => ({ text: 'Anything to unlock?', steps: [{ player: 'Anything to unlock?' }, ...steps] });
  const tree = [{
    type: 'choice', prompt: 'Top', options: [question([
      {
        type: 'condition', text: 'If locked:', steps: [{
          type: 'choice', prompt: 'Unlocks', options: [
            { text: 'Buy', steps: [{ type: 'message', text: 'You pay.', id: 'pay' }, { player: 'Anything to unlock?' }, { type: 'jump', reference: 'below' }] },
            { text: 'Too dear', steps: [{ npc: "That'll cost ye." }, { player: 'Anything to unlock?' }, { type: 'jump', reference: 'above' }] },
          ],
        }],
      },
      { type: 'condition', text: 'If unlocked:', steps: [{ npc: 'Ye have it all.' }] },
    ])],
  }];
  const definition = { getName: () => 'Percy', getId: () => 6562 };
  const event = { player, npc: { getId: () => 6562 }, npcId: 6562, definition };
  try {
    startDialogue(api, event, tree, {}, { player, npc: event.npc, npcId: 6562, definition, pages: [] });
  } finally {
    PluginManager.npcDialogueConditionHooks.splice(PluginManager.npcDialogueConditionHooks.indexOf(condition), 1);
  }
  assert.equal(unlocked, true);
  assert.deepEqual(said.filter((line) => line === 'Ye have it all.'), ['Ye have it all.'], 'the jump saw the purchase');
});

test('an unreplayable menu jump ends the branch instead of leaking the next step', () => {
  const steps = flatten([
    {
      type: 'condition', text: 'If A:', steps: [
        { npc: 'thanks' },
        { type: 'jump', reference: 'other', id: 'x' },
      ],
    },
    { type: 'unavailable' },
  ], { resolveJump: (step) => (/^other/i.test(step.reference) ? 'end' : null) });
  assert.deepEqual(steps.map((step) => step.npc ?? step.type), ['thanks', 'end']);
});

test('menu navigation jumps become replayable gomenu steps', () => {
  const steps = flatten([{ type: 'jump', reference: 'other' }], {
    resolveJump: (step) => (step.reference === 'other' ? { menu: { marker: true } } : null),
  });
  assert.equal(steps.length, 1);
  assert.equal(steps[0].type, 'gomenu');
  assert.deepEqual(steps[0].menu, { marker: true });
});

test('a slayer master assigns from a slugged action, not literal prose', () => {
  const steps = talk('Krystilia');
  const found = { action: false, tip: false, spoken: false };
  const walk = (nodes) => {
    for (const node of nodes ?? []) {
      if (node.action === 'slayer_assignment') {
        found.action = true;
        assert.equal(node.target, 'Krystilia');
      }
      if (node.action === 'slayer_task_tip') found.tip = true;
      if (typeof node.npc === 'string' && node.npc.includes('Your new task is to kill')) found.spoken = true;
      walk(node.steps);
      for (const option of node.options ?? []) walk(option.steps);
    }
  };
  walk(steps);
  assert.ok(found.action, 'the assignment step carries the slug');
  assert.ok(found.tip, 'the task tip step carries the slug');
  // The placeholder line must not survive as something a player can read.
  assert.equal(found.spoken, false);
});
