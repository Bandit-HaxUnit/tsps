const assert = require('node:assert/strict');
const path = require('node:path');
const { before, test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { ClientConnection } = require('../dist/net/NetworkBuilder');
const { MultiChatboxPrompt } = require('../dist/game/model/menu/MultiChatboxPrompt');
let core, cookId, nextIndex = 2500;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  core = PM.getCoreApi();
  cookId = core.CacheDefinitions.getNpcId('fai_varrock_bluemoon_chef');
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins'));
});
function fixture(t) {
  const packets = [];
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true,
    send: packet => { packets.push(packet); return true; }, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(nextIndex++);
  player.setUsername('holidaydialogueqa');
  player.setRegistered(true);
  const connection = new ClientConnection(channel);
  connection.player = player;
  const npc = core.NPC.create(cookId, new core.Location(3227, 3396));
  t.after(() => { player.closeInterruptibleInterfaces(); player.setRegistered(false); core.TaskManager.cancelTasks(player.getIndex()); });
  return { player, npc, packets, connection };
}
async function choose(f, childIndex) {
  await f.connection.dispatch([{ type: 'dialogue_continue', widgetId: MultiChatboxPrompt.OPTIONS_WIDGET_ID, childIndex }]);
  f.connection.processTurnPackets();
}
function request(player, npc, variant = 'starting-the-event-talking-to-the-cook', page = '2025 Christmas event') {
  const event = { player, npc, npcId: cookId, variant: { page, variant }, exact: true };
  PM.emitCustomEvent('npc-dialogue:start', event);
  return event;
}
test('the activity explicitly reaches its canonical source through the real dispatcher and native choice', async t => {
  const f = fixture(t), { player, npc, packets } = f;
  assert.equal(request(player, npc).handled, true);
  const manager = player.getDialogueManager();
  assert.deepEqual(MultiChatboxPrompt.getPending(player), { title: 'Ask about the Christmas Event?', options: ['Yes', 'No'] });
  await choose(f, 1);
  assert.equal(manager.getCurrent().getText().replace(/\s+/g, ' '), "Can't you see the huge queue of people? I really don't have time to chat.");
  assert.ok(packets.length > 0, 'the actual PacketSender encoded the chatbox/choice updates');
  player.closeInterruptibleInterfaces();
  await choose(f, 1);
  assert.equal(MultiChatboxPrompt.getPending(player), null);
  assert.equal(manager.getCurrent(), undefined);
});
test('ordinary Talk-to does not select an inactive annual activity', t => {
  const { player, npc } = fixture(t);
  PM.emitNpcInteraction({ player, npc, npcId: cookId, action: 'Talk-to', clickType: 1, handled: false });
  const current = player.getDialogueManager().getCurrent();
  assert.ok(current);
  assert.notEqual(MultiChatboxPrompt.getPending(player)?.title, 'Ask about the Christmas Event?');
  assert.notEqual(current.getTitle?.(), 'Ask about the Christmas Event?');
  assert.notEqual(current.getText?.(), "Can't you see the huge queue of people? I really don't have time to chat.");
});
test('a missing explicit activity page or variant cannot replace the current conversation', async t => {
  const f = fixture(t), { player, npc } = f;
  request(player, npc);
  const current = MultiChatboxPrompt.getPending(player);
  assert.ok(current);
  assert.notEqual(request(player, npc, 'missing-variant').handled, true);
  assert.deepEqual(MultiChatboxPrompt.getPending(player), current);
  assert.notEqual(request(player, npc, 'starting-off', 'Missing annual event').handled, true);
  assert.deepEqual(MultiChatboxPrompt.getPending(player), current);
  await choose(f, 2);
  assert.equal(MultiChatboxPrompt.getPending(player), null);
});
