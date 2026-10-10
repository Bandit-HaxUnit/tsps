// Run after `yarn build`: node --test tests/localhost-rights.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { PlayerRights } = require("../dist/game/model/rights/PlayerRights");
const Plugin = require("../plugins/players/LocalhostRights.plugin");
const { isLocalHost } = Plugin._test;

// Register through the real plugin surface, then drive the login/logout hooks it wired.
const hooks = {}, events = [];
Plugin.register({
  core: { PlayerRights },
  onPlayerLogin: handler => { hooks.login = handler; },
  onPlayerLogout: handler => { hooks.logout = handler; },
  emitCustomEvent: (name, event) => events.push([name, event.player]),
});
const login = event => hooks.login(event);
const logout = event => hooks.logout(event);

function player(host, rights) {
  const p = { rights, host,
    getHostAddress: () => p.host,
    getRights: () => p.rights,
    setRights: value => { p.rights = value; },
  };
  return p;
}

test("localhost spellings are local, everything else is not", () => {
  for (const host of ["127.0.0.1", "::1", "0:0:0:0:0:0:0:1", "localhost", "::ffff:127.0.0.1", " ::1 "]) {
    assert.equal(isLocalHost(host), true, host);
  }
  for (const host of ["::ffff:192.168.1.5", "192.168.1.5", "10.0.0.1", "headless", "", null, undefined]) {
    assert.equal(isLocalHost(host), false, String(host));
  }
});

test("a local login becomes a developer and the real rank comes back on logout", () => {
  const p = player("::ffff:127.0.0.1", PlayerRights.NONE);
  login({ player: p });
  assert.equal(p.rights, PlayerRights.DEVELOPER);
  assert.deepEqual(events.at(-1), ["account:refresh-chat-icons", p], "the crown refreshes");
  logout({ player: p });
  assert.equal(p.rights, PlayerRights.NONE, "the save must keep the real rank");
});

test("a remote login is left alone", () => {
  const p = player("203.0.113.7", PlayerRights.NONE);
  login({ player: p });
  assert.equal(p.rights, PlayerRights.NONE);
  logout({ player: p });
  assert.equal(p.rights, PlayerRights.NONE);
});

test("staff ranks survive a local session unchanged", () => {
  const p = player("127.0.0.1", PlayerRights.MODERATOR);
  login({ player: p });
  assert.equal(p.rights, PlayerRights.DEVELOPER);
  logout({ player: p });
  assert.equal(p.rights, PlayerRights.MODERATOR);
  const headless = player("headless", PlayerRights.ADMINISTRATOR);
  login({ player: headless });
  assert.equal(headless.rights, PlayerRights.ADMINISTRATOR, "MCP headless logins keep their rank");
});

test("a repeated login hook keeps the original rank, not the developer grant", () => {
  const p = player("127.0.0.1", PlayerRights.MODERATOR);
  login({ player: p });
  login({ player: p });
  logout({ player: p });
  assert.equal(p.rights, PlayerRights.MODERATOR);
});
