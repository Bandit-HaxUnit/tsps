// Run after `yarn build`: node --test tests/mobile-gameframe.test.cjs
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const {
  decodeClientPackets,
  MOBILE_CLIENT_ATTRIBUTE,
  MOBILE_GAMEFRAME_ROOT,
  orbsGroupFor,
  resolveGameframeRoot,
} = require('../dist/net/protocol/ClientProtocol');

const player = (attrs) => ({ getAttribute: (key) => attrs[key] });

test('desktop clients boot their saved layout root', () => {
  assert.equal(resolveGameframeRoot(player({ 'client-layout-root': 548 })), 548);
  assert.equal(resolveGameframeRoot(player({ 'client-layout-root': 164 })), 164);
  assert.equal(resolveGameframeRoot(player({ 'client-layout-root': 161 })), 161);
});

test('missing or unknown saved roots fall back to 161', () => {
  assert.equal(resolveGameframeRoot(player({})), 161);
  assert.equal(resolveGameframeRoot(player({ 'client-layout-root': 601 })), 161);
});

test('mobile clients are locked to the mobile gameframe', () => {
  assert.equal(MOBILE_GAMEFRAME_ROOT, 601);
  assert.equal(resolveGameframeRoot(player({ [MOBILE_CLIENT_ATTRIBUTE]: true, 'client-layout-root': 548 })), 601);
  assert.equal(resolveGameframeRoot(player({ [MOBILE_CLIENT_ATTRIBUTE]: true, 'client-layout-root': 164 })), 601);
});

test('the mobile gameframe mounts its own orbs (orbs_osm), as live does', () => {
  assert.equal(orbsGroupFor(MOBILE_GAMEFRAME_ROOT), 897);
  for (const root of [161, 164, 548]) assert.equal(orbsGroupFor(root), 160);
});

test('handshake decodes the mobile client type byte', () => {
  const name = Buffer.from('Tester\0', 'latin1');
  const mobile = Buffer.concat([name, Buffer.from([0, 1])]);
  const desktop = Buffer.concat([name, Buffer.from([0, 0])]);
  const legacy = Buffer.concat([name, Buffer.from([0])]);
  const frame = (payload) => Buffer.concat([Buffer.from([202, payload.length]), payload]);

  assert.deepEqual(decodeClientPackets(frame(mobile)), [
    { type: 'handshake', name: 'Tester', clientType: 1 },
  ]);
  assert.deepEqual(decodeClientPackets(frame(desktop)), [
    { type: 'handshake', name: 'Tester', clientType: 0 },
  ]);
  assert.deepEqual(decodeClientPackets(frame(legacy)), [
    { type: 'handshake', name: 'Tester', clientType: 0 },
  ]);
});

function welcomeHarness({ mobile = false, wilderness = false, bot = false, newAccount = false } = {}) {
  const hooks = {}, events = [], packets = [];
  const player = {
    getLocation: () => ({ wilderness }),
    isPlayerBot: () => bot,
    getAttribute: key => key === MOBILE_CLIENT_ATTRIBUTE && mobile,
    getPacketSender: () => ({
      sendRootInterface: id => packets.push(['root', id]),
      sendInterfaceFlags: (...args) => packets.push(['flags', ...args]),
    }),
  };
  require('../plugins/interface/WelcomeScreen.plugin').register({
    core: { MOBILE_CLIENT_ATTRIBUTE, Wilderness: { isInLocation: location => location.wilderness } },
    onPlayerLogin: fn => { hooks.login = fn; },
    onCustomEvent: (name, fn) => { hooks[name] = fn; },
    onInterfaceActionButton: (id, fn) => { hooks.play = fn; },
    onPlayerDisconnect: fn => { hooks.disconnect = fn; },
    onPlayerLogout: fn => { hooks.logout = fn; },
    emitCustomEvent: name => events.push(name),
    log() {},
  });
  let opens = 0;
  const bootstrap = { player, handled: false, open: () => { opens++; } };
  hooks.login({ player, isNewAccount: newAccount });
  return { hooks, player, bootstrap, packets, events, get opens() { return opens; } };
}

test('welcome screen mounts the gameframe once, only after Play', () => {
  const h = welcomeHarness();
  h.hooks['player:gameframe-bootstrap'](h.bootstrap);
  assert.equal(h.bootstrap.handled, true);
  assert.equal(h.opens, 0);
  assert.deepEqual(h.packets, [['root', 378], ['flags', (378 << 16) | 72, 2]]);
  assert.deepEqual(h.events, ['welcome-screen:shown']);
  h.hooks.play({ player: h.player });
  h.hooks.play({ player: h.player });
  assert.equal(h.opens, 1);
  assert.deepEqual(h.events, ['welcome-screen:shown', 'gameframe:ready']);
});

test('new, mobile, bot and Wilderness logins keep the immediate gameframe', () => {
  for (const options of [{ newAccount:true }, { mobile:true }, { bot:true }, { wilderness:true }]) {
    const h = welcomeHarness(options);
    h.hooks['player:gameframe-bootstrap'](h.bootstrap);
    assert.equal(h.bootstrap.handled, false, JSON.stringify(options));
    assert.deepEqual(h.packets, []);
  }
});

test('logout and disconnect cancel a pending welcome-screen gameframe', () => {
  for (const hook of ['logout', 'disconnect']) {
    const h = welcomeHarness();
    h.hooks['player:gameframe-bootstrap'](h.bootstrap);
    h.hooks[hook]({ player: h.player });
    h.hooks.play({ player: h.player });
    assert.equal(h.opens, 0, hook);
  }
});
