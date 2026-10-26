// Run after `yarn build`: node --test tests/league-tutorial.test.cjs
// The league tutorial (docs/leagues.md "Tutorial"): a new league character's run through the
// cache's tutorial pages as the recorded runs show it (osrs-captures 227/00196 Raging Echoes,
// 237/01098 Demonic Pacts), the screen-highlight walkthroughs in the task list, area map and relic
// screen, the sections it skips when their screen never opens, the pages Leagues II and IV get
// with their own name, and the welcome screen's league line.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before, beforeEach } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { GameConstants } = require("../dist/game/GameConstants");

const uid = (group, child) => (group << 16) | child;
const STAGE = 10037;
const MAIN = 677;
const OVERLAY = 653;
const HIGHLIGHT = 664;
const CONTINUE = uid(HIGHLIGHT, 31);
const PREVIOUS = uid(HIGHLIGHT, 32);
const MAIN_MODAL = uid(161, 16);
const FLOATER = uid(161, 18);

let core;
const hooks = {};
const custom = {};
let worldLeague = 5;
let pluginConfig = {};
let tasks = [];

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  GameConstants.setWorldProfile("league");
  const lists = {};
  const on = (name) => (handler) => {
    (lists[name] ??= []).push(handler);
    hooks[name] = (event) => {
      // As PluginManager runs button hooks: a handler that does not return false handles the click.
      for (const attached of lists[name]) {
        const answer = attached(event);
        if (name.startsWith("button:") && answer !== false) return answer;
      }
      return false;
    };
  };
  const api = new Proxy({
    core,
    persistAttribute() {},
    getPluginConfig: (key, fallback) => (key === "league:type" ? worldLeague : pluginConfig[key] ?? fallback),
    setWorldProfile: (profile) => GameConstants.setWorldProfile(profile),
    getTaskManager: () => ({ submit: (task) => tasks.push(task) }),
    getSkillManager: () => require("../dist/game/content/skill/SkillManager").SkillManager,
    registerCommand: (name, handler) => (hooks[`command:${name}`] = handler),
    onInterfaceActionButton: (ids, handler) => {
      for (const id of [].concat(ids)) on(`button:${id}`)(handler);
    },
    onCustomEvent: (name, handler) => (custom[name] = (custom[name] ?? []).concat(handler)),
    emitCustomEvent: (name, payload) => {
      for (const handler of custom[name] ?? []) handler(payload);
    },
  }, { get: (target, key) => (key in target ? target[key] : on(String(key))) });
  require("../plugins/interface/ScreenHighlight.plugin").register(api);
  require("../plugins/modes/LeagueMode.plugin").register(api);
  require("../plugins/modes/LeaguePoints.plugin").register(api);
  require("../plugins/modes/LeagueRelics.plugin").register(api);
});

beforeEach(() => {
  tasks = [];
  pluginConfig = {};
});

/** Runs every task queued so far (the tutorial's short waits), as the next ticks would. */
function tick() {
  const due = tasks;
  tasks = [];
  for (const task of due) task.execute();
}

/** A real player whose packets are recorded; `sendInterface` / closes keep `open` as the client would. */
function character(name, { league = 5, isNewAccount = true, profile = "league", stage, joined = stage !== undefined } = {}) {
  const player = new Player(null);
  player.setUsername(name);
  player.setProfile(profile);
  // A returning character already joined its league; a stage is only ever saved on one.
  if (joined) player.setAttribute("league:type", league);
  if (stage !== undefined) player.setAttribute("league:tutorial-stage", stage);
  const sent = { varbits: new Map(), scripts: [], subs: [], closed: [], flags: [], strings: [], messages: [], logouts: 0, hidden: new Map() };
  const open = new Map(); // groupId -> target
  const sender = new Proxy({}, {
    get: (target, key) => {
      switch (key) {
        case "sendVarbit": return (id, value) => (sent.varbits.set(id, value), sender);
        case "sendInterfaceScript": return (id, args) => {
          // As the real encoder: numbers, strings and bigints only (a cs2 boolean goes as 1 / 0).
          for (const arg of args) assert.ok(["number", "string", "bigint"].includes(typeof arg), `script ${id} argument ${arg} is a ${typeof arg}`);
          sent.scripts.push([id, args]);
          return sender;
        };
        case "sendSubInterface": return (to, group) => (open.set(group, to), sent.subs.push([to, group]), sender);
        case "sendInterface": return (group) => (open.set(group, MAIN_MODAL), player.setInterfaceId(group), sent.subs.push([MAIN_MODAL, group]), sender);
        case "closeSubInterface": return (to) => {
          for (const [group, at] of open) if (at === to) open.delete(group);
          sent.closed.push(to);
          return sender;
        };
        case "isSubInterfaceOpen": return (group) => open.has(group);
        case "sendInterfaceFlagsRange": return (...args) => (sent.flags.push(args), sender);
        case "sendInterfaceDisplayState": return (id, hide) => (sent.hidden.set(id, hide), sender);
        case "sendString": return (text, id) => (sent.strings.push([id, text]), sender);
        case "sendContentData": return (source, datasets) => ((sent.content ??= []).push(datasets), sender);
        default: return () => sender;
      }
    },
  });
  player.getPacketSender = () => sender;
  player.sendMessage = (text) => sent.messages.push(text);
  player.requestLogout = () => sent.logouts++;
  const previous = worldLeague;
  worldLeague = league;
  hooks.onPlayerLogin({ player, username: name, isNewAccount, profile });
  worldLeague = previous;
  return Object.assign(player, { sent, open });
}

const emit = (name, payload) => {
  for (const handler of custom[name] ?? []) handler(payload);
  return payload;
};
const click = (player, buttonId, slot = -1) => hooks[`button:${buttonId}`]({ player, buttonId, slot });
const lastScript = (player, id) => player.sent.scripts.filter(([script]) => script === id).at(-1)?.[1];
const points = (player) => emit("league:points", { player, points: 0, tasks: 0 }).points;

/** The page's packets as captured: the overlay with its blocker shown, the chat overlay, the modal. */
function assertPage(player, stage) {
  assert.equal(player.getAttribute("league:tutorial-stage"), stage);
  assert.equal(player.sent.varbits.get(STAGE), stage, `league_tutorial_completed = ${stage}`);
  assert.equal(player.open.get(OVERLAY), uid(161, 1), "league_tutorial in overlay_atmosphere");
  assert.equal(player.sent.hidden.get(uid(OVERLAY, 1)), false, "its click blocker shown");
  assert.equal(player.open.get(263), uid(162, 565), "mesoverlay in chatbox:crmclose");
  assert.deepEqual(lastScript(player, 2524), [-1, -1]);
  assert.equal(player.open.get(MAIN), MAIN_MODAL, "the page as the main modal");
}

/** Clicks Continue `steps` times from the step showing, checking the hint varbits. */
function walkThrough(player, steps) {
  const from = player.sent.varbits.get(10308);
  for (let step = from; step < from + steps; step++) {
    assert.equal(player.sent.varbits.get(10308), step, `hnt_hint_step ${step}`);
    assert.equal(click(player, CONTINUE, 9), true);
  }
}

test("a new Raging Echoes character runs the whole tutorial as recorded", () => {
  const league = character("rookie");
  assert.equal(league.sent.varbits.get(STAGE), 0, "stage 0 at login");
  assert.equal(league.sent.varbits.get(4084), 1, "orbs_disabled while the tutorial runs");
  assert.equal(league.open.has(MAIN), false, "nothing opens before the client is ready");
  tick();
  assertPage(league, 0);

  // Get Started (button_2): stages 1-3 at once, the journal stone flashes and transmits.
  const closedBefore = league.sent.closed.filter((to) => to === MAIN_MODAL).length;
  assert.equal(click(league, uid(MAIN, 9)), true);
  assert.equal(league.sent.closed.filter((to) => to === MAIN_MODAL).length, closedBefore + 1, "the page closes and reopens, as captured, so the client redraws it");
  assert.equal(league.sent.varbits.get(13488), 1, "league_3_has_seen_cutscene");
  assertPage(league, 3);
  assert.equal(league.sent.varbits.get(3756), 3, "flashside: the journal");
  assert.deepEqual(league.sent.flags.at(-1), [uid(161, 61), -1, -1, 2], "OP1 on toplevel_osrs_stretch:stone2");

  // The journal stone: the Leagues tab flashes.
  assert.equal(click(league, uid(161, 61)), false, "the client still opens the journal");
  assert.equal(league.sent.varbits.get(3756), 0);
  assertPage(league, 4);
  assert.deepEqual(lastScript(league, 3162), [uid(629, 42)], "side_journal:tab_icon_5 flashes");

  // The Leagues tab mounts the side panel: Open the Leagues Menu is awarded.
  emit("interface:opened", { player: league, groupId: 656, targetUid: uid(629, 43), type: 1 });
  assert.equal(points(league), 10, "Open the Leagues Menu, 10 points");
  assertPage(league, 5);
  assert.deepEqual(lastScript(league, 3185), [uid(656, 35)], "the tasks button pulses");

  // Tasks: the task list opens (its own plugin's), the walkthrough runs in it.
  assert.equal(click(league, uid(656, 36)), false, "the tasks plugin opens the task list");
  league.open.set(657, FLOATER);
  emit("interface:opened", { player: league, groupId: 657, targetUid: FLOATER, type: 1 });
  assert.equal(league.sent.varbits.get(STAGE), 6);
  assert.deepEqual(lastScript(league, 3186), [uid(656, 35)], "the pulse stops");
  assert.equal(league.open.has(MAIN), false, "the page closes for the floating task list");
  assert.equal(league.open.get(HIGHLIGHT), uid(657, 14), "screenhighlight in league_tasks:tutorial_highlight");
  assert.equal(league.sent.varbits.get(10307), 1);
  assert.equal(league.sent.varbits.get(10309), 6);
  assert.deepEqual(lastScript(league, 3408), [uid(657, 14)]);
  assert.deepEqual(lastScript(league, 3409), [uid(657, 14), 0, 0, 0, 0, 2, 2, 100, 1]);
  const first = lastScript(league, 3413);
  assert.match(first[0], /^This is the <col=ffffff>task list<\/col>/);
  assert.deepEqual(first.slice(1), [2147070, 0, 0, uid(657, 14)], "the league struct's colour (param 1027)");
  click(league, CONTINUE, 9);
  click(league, PREVIOUS, 9);
  assert.equal(league.sent.varbits.get(10308), 0, "Previous goes back a step");
  walkThrough(league, 6);
  assert.ok(league.sent.closed.includes(FLOATER), "the task list closes after its walkthrough");
  assertPage(league, 7);
  assert.deepEqual(lastScript(league, 3185), [uid(656, 39)], "the areas button pulses");

  // Areas: this server's area map opens; Raging Echoes waits for an unlock after the walkthrough.
  click(league, uid(656, 40));
  emit("interface:opened", { player: league, groupId: 512, targetUid: MAIN_MODAL, type: 0 });
  assert.equal(league.sent.varbits.get(STAGE), 8);
  assert.equal(league.open.get(HIGHLIGHT), uid(512, 13));
  assert.match(lastScript(league, 3413)[0], /Area Selection Menu/);
  walkThrough(league, 6);
  assert.equal(league.getAttribute("league:tutorial-stage"), 8, "Raging Echoes waits for the area unlock");
  tick();
  assert.equal(league.getAttribute("league:tutorial-stage"), 8, "the skip timer never fires once the map opened");
  emit("league:area-unlocked", { player: league, league: 5, area: 2, slot: 1 });
  assertPage(league, 9);
  assert.deepEqual(lastScript(league, 3185), [uid(656, 43)], "the relics button pulses");

  // Relics: the walkthrough, then a pick.
  click(league, uid(656, 44));
  emit("interface:opened", { player: league, groupId: 655, targetUid: MAIN_MODAL, type: 0 });
  assert.equal(league.sent.varbits.get(STAGE), 10);
  assert.equal(league.open.get(HIGHLIGHT), uid(655, 13));
  assert.equal(league.sent.varbits.get(10307), 2);
  walkThrough(league, 6);
  assert.equal(league.getAttribute("league:tutorial-stage"), 10, "a relic pick moves it on");
  const isOpen = core.Bank.isOpen;
  core.Bank.isOpen = () => true; // every tier 1 relic hands out an item, so the pick needs a bank
  try {
    hooks["command:relic"]({ player: league, parts: ["relic", "1", "1"] });
  } finally {
    core.Bank.isOpen = isOpen;
  }
  assert.deepEqual(league.sent.messages.filter((m) => !m.includes("rank")), [], "the pick went through");
  assertPage(league, 11);

  // End Tutorial (button_1).
  assert.equal(click(league, uid(MAIN, 8)), true);
  assert.equal(league.getAttribute("league:tutorial-stage"), 12);
  assert.equal(league.sent.varbits.get(STAGE), 12);
  assert.equal(league.sent.varbits.get(4084), 0, "orbs back");
  assert.equal(points(league), 20, "Complete the Leagues Tutorial, 10 more");
  assert.equal(league.open.has(MAIN), false);
  assert.equal(league.open.has(OVERLAY), false);
  assert.equal(league.open.has(263), false);
  assert.equal(league.sent.hidden.get(uid(OVERLAY, 1)), true);
  assert.equal(click(league, uid(MAIN, 8)), false, "the buttons do nothing once it is over");

  const back = character("rookie", { isNewAccount: false, stage: 12 });
  assert.equal(back.sent.varbits.get(STAGE), 12, "finished: the journal's value at every login");
  tick();
  assert.equal(back.open.has(MAIN), false);
});

test("a section whose screen never opens is skipped, so the tutorial can always end", () => {
  const league = character("skipper", { stage: 5, isNewAccount: false });
  tick();
  assertPage(league, 5);
  assert.equal(click(league, uid(656, 36)), false);
  assert.equal(league.getAttribute("league:tutorial-stage"), 5, "it waits a moment for the screen");
  tick();
  assertPage(league, 7);
  click(league, uid(656, 40));
  tick();
  assertPage(league, 9);
});

test("a tutorial in progress resumes at its page; a character from before the tutorial counts as finished", () => {
  const midway = character("midway", { stage: 6, isNewAccount: false });
  assert.equal(midway.sent.varbits.get(STAGE), 5, "a walkthrough stage resumes at its page");
  tick();
  assertPage(midway, 5);
  const veteran = character("veteran", { isNewAccount: false, joined: true });
  assert.equal(veteran.getAttribute("league:tutorial-stage"), undefined);
  assert.equal(veteran.sent.varbits.get(STAGE), 12, "no stage: finished, as every capture's login shows");
  assert.equal(veteran.sent.varbits.has(4084), false);
  const twisted = character("twisted-new", { league: 1 });
  assert.equal(twisted.getAttribute("league:tutorial-stage"), undefined, "Twisted's struct has no tutorial");
  assert.equal(twisted.sent.varbits.get(STAGE), 12);
  const main = character("main-new", { profile: "main" });
  assert.equal(main.sent.varbits.has(STAGE), false, "a main character has no league tutorial");
});

test("the tutorial waits for the welcome screen's Play, or for the character design to close", () => {
  const welcomed = character("welcomed", { stage: 3, isNewAccount: false });
  emit("welcome-screen:shown", { player: welcomed });
  tick();
  assert.equal(welcomed.open.has(MAIN), false, "not over the welcome screen");
  click(welcomed, uid(378, 72));
  tick();
  assertPage(welcomed, 3);

  const designing = character("designing");
  designing.setInterfaceId(679);
  tick();
  assert.equal(designing.open.has(MAIN), false, "not over the character design");
  designing.setInterfaceId(-1);
  emit("interface:closed", { player: designing, interfaceId: 679 });
  tick();
  assertPage(designing, 0);
});

test("the tutorial's tasks go through the task catalog when there is one, and pay directly only when there is none", () => {
  const asked = [];
  const catalog = (request) => {
    asked.push(request.id);
    request.found = request.id === "open-the-leagues-menu";
    request.completed = request.found;
  };
  custom["league:complete-task"] = [catalog];
  try {
    const league = character("catalogued", { stage: 4, isNewAccount: false });
    tick();
    emit("interface:opened", { player: league, groupId: 656, targetUid: uid(629, 43), type: 1 });
    assert.deepEqual(asked, ["open-the-leagues-menu"], "the catalog is asked");
    assert.equal(points(league), 0, "and it pays (here a stub that records no points), not LeaguePoints directly");
    league.setAttribute("league:tutorial-stage", 11);
    click(league, uid(MAIN, 8));
    assert.deepEqual(asked, ["open-the-leagues-menu", "complete-the-leagues-tutorial"]);
    assert.equal(points(league), 0, "a task the league's catalog lacks pays nothing");
  } finally {
    delete custom["league:complete-task"];
  }
});

test("Exit Leagues logs the character out", () => {
  const leaving = character("leaving");
  tick();
  assert.equal(click(leaving, uid(MAIN, 8)), true);
  assert.equal(leaving.sent.logouts, 1);
  assert.equal(leaving.open.has(OVERLAY), false);
});

test("Demonic Pacts: its own walkthrough colour, an area step that needs no unlock, the pacts section, and 14 to finish", () => {
  const pacts = character("pacts-rookie", { league: 6, stage: 7, isNewAccount: false });
  tick();
  assertPage(pacts, 7);
  click(pacts, uid(656, 40));
  emit("interface:opened", { player: pacts, groupId: 512, targetUid: MAIN_MODAL, type: 0 });
  assert.equal(lastScript(pacts, 3413)[1], 16019731, "struct 6436's param 1027");
  walkThrough(pacts, 2);
  assert.match(lastScript(pacts, 3413)[0], /Kingdom of Varlamore/, "237/01098's text");
  assert.deepEqual(lastScript(pacts, 3409), [uid(512, 13), 135, 120, 0, 5, 0, 2, 100, 0]);
  walkThrough(pacts, 4);
  assertPage(pacts, 9);
  pacts.setAttribute("league:tutorial-stage", 10);
  emit("league:relic-unlocked", { player: pacts, league: 6, tier: 0, slot: 1, relic: "x" });
  assertPage(pacts, 11);
  assert.deepEqual(lastScript(pacts, 3185), [uid(656, 31)], "the Demonic Pacts button pulses");
  assert.equal(click(pacts, uid(656, 32)), false);
  assertPage(pacts, 13);
  click(pacts, uid(MAIN, 8));
  assert.equal(pacts.getAttribute("league:tutorial-stage"), 14, "Leagues VI finishes at 14 (243 logins sent it)");
});

test("Leagues II and IV get Leagues V's pages with their own name", () => {
  const reloaded = character("reloaded-rookie", { league: 4 });
  const payload = reloaded.sent.content.at(-1);
  const structs = new Map(payload.find((entry) => entry.key === "structOverrides").rows.map((row) => [row.structId, row.params]));
  const enums = new Map(payload.find((entry) => entry.key === "enumOverrides").rows.map((row) => [row.enumId, row]));
  assert.equal(structs.get(4699)[1033], 204910, "the league struct points at its own tutorial struct");
  assert.equal(structs.get(4699)[870], 204000, "merged with the relic catalog's row for the same struct");
  const tutorial = structs.get(204910);
  assert.equal(tutorial[1034], 204911);
  assert.equal(tutorial[1035], 204912);
  assert.equal(tutorial[1036], 3381, "the button texts are struct 747's");
  const titles = new Map(enums.get(204911).entries);
  assert.equal(titles.get(0), "Welcome to Leagues IV - Trailblazer Reloaded!");
  assert.equal(titles.get(11), "Finishing Up");
  const bodies = new Map(enums.get(204912).entries);
  assert.match(bodies.get(11), /adventure in <col=ffffff>Leagues IV - Trailblazer Reloaded<\/col>/);
  assert.doesNotMatch(bodies.get(3), /Leagues V\b/, "every Leagues V renamed");
  const echoes = character("echoes-rookie", { league: 5 });
  const echoStructs = new Map(echoes.sent.content.at(-1).find((entry) => entry.key === "structOverrides").rows.map((row) => [row.structId, row.params]));
  assert.equal(echoStructs.get(6211)?.[1033], undefined, "Raging Echoes keeps the cache's own pages");

  reloaded.setAttribute("league:tutorial-stage", 7);
  click(reloaded, uid(656, 40));
  emit("interface:opened", { player: reloaded, groupId: 512, targetUid: MAIN_MODAL, type: 0 });
  walkThrough(reloaded, 2);
  assert.match(lastScript(reloaded, 3413)[0], /areas<\/col> in <col=ffffff>Leagues IV - Trailblazer Reloaded<\/col>/, "the walkthrough names its league too");
});

test("the welcome screen names the league and the days left in it", () => {
  const { messageOfTheWeek } = require("../plugins/modes/league/Welcome.LeagueMode");
  const now = Date.parse("2026-10-01T12:00:00Z");
  assert.equal(messageOfTheWeek(5, NaN, now), "Welcome to Old School RuneScape: <col=670e3b>Leagues V - Raging Echoes</col>!");
  assert.equal(messageOfTheWeek(5, Date.parse("2026-10-28T00:00:00Z"), now),
    "Welcome to Old School RuneScape: <col=670e3b>Leagues V - Raging Echoes</col>!<br>There are <col=670e3b>27 days remaining</col> in this League.", "the captured line");
  assert.match(messageOfTheWeek(6, now + 3600000, now), /There is <col=670e3b>1 day remaining<\/col>/);
  assert.equal(messageOfTheWeek(6, now - 1, now), "Welcome to Old School RuneScape: <col=670e3b>Leagues VI - Demonic Pacts</col>!", "an ended league shows no countdown");
  pluginConfig = { "league:end": "2099-01-01T00:00:00Z" };
  const welcomed = character("motw", { isNewAccount: false, stage: 12 });
  emit("welcome-screen:shown", { player: welcomed });
  const [id, text] = welcomed.sent.strings.at(-1);
  assert.equal(id, uid(378, 6), "welcome_screen:motw");
  assert.match(text, /Leagues V - Raging Echoes<\/col>!<br>There are <col=670e3b>\d+ days remaining/);
});
