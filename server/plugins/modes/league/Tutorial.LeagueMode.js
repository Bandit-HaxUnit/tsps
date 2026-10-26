/**
 * The league tutorial a new league character goes through (data/league-tutorial.json): the cache's
 * tutorial pages (league_tutorial_main, 677, over league_tutorial, 653) step a new player through
 * the Leagues Menu, the task list, the area map and the relics, as the two recorded runs show it
 * (osrs-captures 227/00196 Raging Echoes, 237/01098 Demonic Pacts). The server only moves
 * league_tutorial_completed and opens the screens; the client draws every page from the league
 * struct's tutorial struct. The task list, the area map and the relic screen belong to their own
 * plugins: the tutorial watches them open ("interface:opened") and runs its walkthrough in them
 * (ScreenHighlight), and skips a section whose screen never opens, so it can always be finished.
 *
 *   api.emitCustomEvent("league:tutorial-stage", { player })  -> stage (league_tutorial_completed)
 *
 * A character from before the tutorial existed has no stage and counts as finished.
 */
const Common = require("./Common.LeagueMode");
const data = require("../data/league-tutorial.json");
const { FLAG_OP1 } = require("../../interface/widgetGroup");

/** The tutorial's stage (league_tutorial_completed); absent for a character that joined before it existed. */
const STAGE_ATTRIBUTE = "league:tutorial-stage";
const OVERLAY = 1;
const SECTIONS = ["tasks", "areas", "relics", "pacts"];

/** Per player: the screens wait for the welcome screen or the character design to close. */
const awaitingOpen = new WeakSet();
/** Players whose welcome screen is up. */
const welcomeShown = new WeakSet();
/** Per player: the section whose button was clicked, waiting for its screen. */
const pendingSection = new WeakMap();
/** Per player: where a section's screen was mounted, to close it after its walkthrough. */
const sectionTarget = new WeakMap();
let LaterTask = null;

function uid([group, child]) {
  return (group << 16) | child;
}

function flowOf(type) {
  const row = data.leagues[type];
  return row ? data.flows[row.flow] : null;
}

/** The player's stage, or null when they have finished (or never had a tutorial). */
function activeStage(player) {
  const flow = flowOf(Common.leagueOf(player));
  const stage = player.getAttribute(STAGE_ATTRIBUTE);
  if (!flow || !Number.isInteger(stage) || stage >= flow.final) return null;
  return stage;
}

function pageOf(flow, stage) {
  return flow.stages[String(stage)] ?? null;
}

/** The page a stage belongs to: a walkthrough stage (the page's + 1) resumes at its page. */
function resumeStage(flow, stage) {
  return pageOf(flow, stage) ? stage : stage - 1;
}

function later(player, ticks, action) {
  const manager = Common.api.getTaskManager?.();
  if (typeof manager?.submit !== "function") return;
  manager.submit(new LaterTask(ticks, () => {
    if (player.isRegistered?.() !== false) action();
  }));
}

/** league_tutorial (653) with its click blocker and the chat overlay, as captured before every page. */
function showOverlay(player) {
  const { screens } = data;
  const sender = player.getPacketSender();
  sender.sendSubInterface(uid(screens.overlay.target), screens.overlay.group, OVERLAY);
  sender.sendInterfaceDisplayState(uid([screens.overlay.group, screens.overlay.noclick]), false);
  sender.sendSubInterface(uid(screens.mesoverlay.target), screens.mesoverlay.group, OVERLAY);
  sender.sendInterfaceScript(screens.mesoverlayScript, [""]);
}

function closeScreens(player) {
  const { screens } = data;
  const sender = player.getPacketSender();
  if (sender.isSubInterfaceOpen(screens.main)) sender.closeSubInterface(uid(screens.mainModal));
  sender.sendInterfaceDisplayState(uid([screens.overlay.group, screens.overlay.noclick]), true);
  sender.closeSubInterface(uid(screens.mesoverlay.target));
  sender.closeSubInterface(uid(screens.overlay.target));
}

/** Moves to `stage` and, on a page, shows it: the overlay, the page's own cue, the modal. */
function present(player, stage) {
  const type = Common.leagueOf(player);
  const flow = flowOf(type);
  if (!flow) return;
  const { varbits, screens, journal, sections, pulse } = data;
  const sender = player.getPacketSender();
  player.setAttribute(STAGE_ATTRIBUTE, stage);
  sender.sendVarbit(varbits.stage, stage);
  const page = pageOf(flow, stage);
  if (!page) return;
  // As captured: the page closes and opens again, so the client draws the new stage's text.
  if (sender.isSubInterfaceOpen(screens.main)) sender.closeSubInterface(uid(screens.mainModal));
  showOverlay(player);
  if (page === "journal") {
    sender.sendVarbit(varbits.flashSide, data.flashJournal);
    sender.sendInterfaceFlagsRange(uid(journal.stone), -1, -1, FLAG_OP1);
  } else if (page === "leagues-tab") {
    sender.sendInterfaceScript(journal.flashTabScript[0], [uid(journal.flashTabScript[1])]);
  } else if (sections[page]) {
    sender.sendInterfaceScript(pulse.start, [uid(sections[page].highlight)]);
  }
  sender.sendInterfaceScript(screens.modalSizeScript[0], screens.modalSizeScript[1]);
  sender.sendInterface(screens.main);
}

function award(player, task) {
  Common.api.emitCustomEvent("league:award-task", { player, id: task.id, points: task.points, name: task.name });
}

/** A section's screen opened on its page: the walkthrough runs in it. */
function startWalkthrough(player, section, stage, opened) {
  const type = Common.leagueOf(player);
  const flow = flowOf(type);
  const steps = flow?.walkthroughs[section];
  const { sections, pulse, screens } = data;
  pendingSection.delete(player);
  const sender = player.getPacketSender();
  sender.sendInterfaceScript(pulse.stop, [uid(sections[section].highlight)]);
  if (sender.isSubInterfaceOpen(screens.main) && opened.targetUid !== uid(screens.mainModal)) sender.closeSubInterface(uid(screens.mainModal));
  if (!steps) {
    skip(player, section);
    return;
  }
  sectionTarget.set(player, opened.targetUid);
  player.setAttribute(STAGE_ATTRIBUTE, stage + 1);
  sender.sendVarbit(data.varbits.stage, stage + 1);
  const colour = Number(Common.core.CacheDefinitions.getStructParams(Common.league(type).struct)?.get(data.colourParam)) || Common.league(type).colour;
  Common.api.emitCustomEvent("screen-highlight:show", {
    player, key: `league-tutorial:${section}`, host: uid(sections[section].host), hint: sections[section].hint, colour, steps: renamed(type, steps),
  });
}

/** A league that borrows another's walkthrough text gets its own name in it. */
function renamed(type, steps) {
  const rename = data.leagues[type]?.rename;
  if (!rename) return steps;
  return steps.map((step) => ({ ...step, text: { ...step.text, text: rename_(step.text.text, rename) } }));
}

function rename_(text, rename) {
  return Object.keys(rename).sort((a, b) => b.length - a.length).reduce((out, from) => out.split(from).join(rename[from]), text);
}

/** The page after a section: the next stage the flow lists. */
function nextPage(flow, stage) {
  return Object.keys(flow.stages).map(Number).filter((page) => page > stage).sort((a, b) => a - b)[0] ?? flow.final - 1;
}

/** Its screen never opened (or it has no walkthrough): the tutorial moves on without it. */
function skip(player, section) {
  const flow = flowOf(Common.leagueOf(player));
  const stage = player.getAttribute(STAGE_ATTRIBUTE);
  if (!flow || pageOf(flow, resumeStage(flow, stage)) !== section) return;
  pendingSection.delete(player);
  present(player, nextPage(flow, resumeStage(flow, stage)));
}

function closeSectionScreen(player) {
  const target = sectionTarget.get(player);
  sectionTarget.delete(player);
  if (target !== undefined && target !== uid(data.screens.mainModal)) player.getPacketSender().closeSubInterface(target);
}

/** The walkthrough's last Continue. */
function walkthroughFinished({ player, key }) {
  const section = /^league-tutorial:(\w+)$/.exec(String(key ?? ""))?.[1];
  const flow = flowOf(Common.leagueOf(player));
  const stage = player ? activeStage(player) : null;
  if (!section || !flow || stage === null) return;
  if (section === "areas" && flow.areasNeedUnlock) return; // an area unlock moves it on
  if (section === "relics") return; // a relic unlock moves it on
  closeSectionScreen(player);
  present(player, nextPage(flow, stage));
}

/** The section a side panel button opens, by the button's uid. */
function sectionOfButton(buttonId) {
  return SECTIONS.find((section) => uid(data.sections[section].button) === buttonId) ?? null;
}

/** A section's button on its page: its screen should open; the section is skipped if it does not. */
function sectionClicked({ player, buttonId }) {
  const section = sectionOfButton(buttonId);
  const flow = flowOf(Common.leagueOf(player));
  const stage = activeStage(player);
  if (!section || !flow || stage === null || pageOf(flow, stage) !== section) return false;
  if (section === "pacts") {
    // No walkthrough: its middle step waits on a pact tree this server does not have.
    player.getPacketSender().sendInterfaceScript(data.pulse.stop, [uid(data.sections.pacts.highlight)]);
    skip(player, section);
    return false;
  }
  pendingSection.set(player, section);
  later(player, data.sections.waitTicks, () => {
    if (pendingSection.get(player) === section) skip(player, section);
  });
  // Not handled: the section's own plugin opens its screen.
  return false;
}

function interfaceOpened(event) {
  const { player, groupId } = event ?? {};
  const flow = player ? flowOf(Common.leagueOf(player)) : null;
  const stage = flow ? activeStage(player) : null;
  if (stage === null) return;
  const page = pageOf(flow, stage);
  if ((page === "journal" || page === "leagues-tab") && groupId === data.journal.sidePanel) {
    award(player, data.tasks.openMenu);
    present(player, nextPage(flow, stage));
    return;
  }
  const section = data.sections[page];
  if (section && SECTIONS.includes(page) && groupId === section.interface) startWalkthrough(player, page, stage, event);
}

function journalStone({ player }) {
  const flow = flowOf(Common.leagueOf(player));
  const stage = activeStage(player);
  if (!flow || stage === null || pageOf(flow, stage) !== "journal") return false;
  player.getPacketSender().sendVarbit(data.varbits.flashSide, 0);
  present(player, nextPage(flow, stage));
  // The client still opens the journal itself.
  return false;
}

/** The tutorial page's buttons: Get Started (button_2), Exit Leagues / End Tutorial (button_1). */
function pageButton({ player, buttonId }) {
  const flow = flowOf(Common.leagueOf(player));
  const stage = activeStage(player);
  if (!flow || stage === null) return false;
  const { screens } = data;
  const page = pageOf(flow, stage);
  const primary = buttonId === uid([screens.main, screens.primaryButton]);
  if (page === "start" && !primary) {
    player.getPacketSender().sendVarbit(data.varbits.seenCutscene, 1);
    present(player, nextPage(flow, stage));
    return true;
  }
  if (page === "start" && primary) {
    // "Exit Leagues": leave the league world (ours; never pressed in a recording).
    closeScreens(player);
    player.requestLogout();
    return true;
  }
  if (page === "finish" && primary) {
    finish(player, flow);
    return true;
  }
  return false;
}

function finish(player, flow) {
  player.setAttribute(STAGE_ATTRIBUTE, flow.final);
  const sender = player.getPacketSender();
  sender.sendVarbit(data.varbits.stage, flow.final);
  sender.sendVarbit(data.varbits.orbsDisabled, 0);
  award(player, data.tasks.complete);
  closeScreens(player);
}

function areaUnlocked({ player }) {
  const flow = player ? flowOf(Common.leagueOf(player)) : null;
  const stage = flow ? activeStage(player) : null;
  if (stage === null || pageOf(flow, resumeStage(flow, stage)) !== "areas") return;
  closeSectionScreen(player);
  present(player, nextPage(flow, resumeStage(flow, stage)));
}

function relicUnlocked({ player }) {
  const flow = player ? flowOf(Common.leagueOf(player)) : null;
  const stage = flow ? activeStage(player) : null;
  if (stage === null || pageOf(flow, resumeStage(flow, stage)) !== "relics") return;
  Common.api.emitCustomEvent("screen-highlight:close", { player });
  sectionTarget.delete(player);
  present(player, nextPage(flow, resumeStage(flow, stage)));
}

/** A new league character starts the tutorial, when its league has one. */
function joined({ player, league }) {
  if (flowOf(league)) player.setAttribute(STAGE_ATTRIBUTE, 0);
}

/** `league:tutorial-stage` { player } -> stage: the page a tutorial in progress resumes at; untouched when finished. */
function answerStage(query) {
  if (!query?.player) return;
  const stage = activeStage(query.player);
  if (stage !== null) query.stage = resumeStage(flowOf(Common.leagueOf(query.player)), stage);
}

/** Opens the current page once nothing else is up (the welcome screen, the character design). */
function openWhenReady(player) {
  if (!awaitingOpen.has(player) || welcomeShown.has(player) || player.getInterfaceId?.() > 0) return;
  awaitingOpen.delete(player);
  const flow = flowOf(Common.leagueOf(player));
  const stage = activeStage(player);
  if (stage !== null) present(player, resumeStage(flow, stage));
}

function login({ player }) {
  const flow = flowOf(Common.leagueOf(player));
  const stage = activeStage(player);
  if (stage === null) return;
  player.getPacketSender().sendVarbit(data.varbits.orbsDisabled, 1);
  player.setAttribute(STAGE_ATTRIBUTE, resumeStage(flow, stage));
  awaitingOpen.add(player);
  later(player, 2, () => openWhenReady(player));
}

function welcomeScreenShown({ player }) {
  if (player) welcomeShown.add(player);
}

function welcomePlay({ player }) {
  welcomeShown.delete(player);
  later(player, 1, () => openWhenReady(player));
  return false;
}

function interfaceClosed({ player }) {
  if (player && awaitingOpen.has(player)) later(player, 1, () => openWhenReady(player));
}

function logout({ player }) {
  awaitingOpen.delete(player);
  welcomeShown.delete(player);
  pendingSection.delete(player);
  sectionTarget.delete(player);
}

/** Leagues II and IV borrow Leagues V's tutorial struct (747), whose pages name Leagues V: copies with their own name. */
function content(query) {
  const rename = data.leagues[query?.league]?.rename;
  if (!rename) return;
  const { CacheDefinitions } = Common.core;
  const { structParam, titleParam, bodyParam, virtualIdOffsets } = data.pages;
  const leagueStruct = Common.league(query.league).struct;
  const tutorialStruct = CacheDefinitions.getStructParams(leagueStruct)?.get(structParam);
  if (!Number.isInteger(tutorialStruct)) return;
  const source = CacheDefinitions.getStructParams(tutorialStruct);
  const struct = query.base + virtualIdOffsets.struct;
  const titles = query.base + virtualIdOffsets.titles;
  const bodies = query.base + virtualIdOffsets.bodies;
  const copy = (enumId) => [...CacheDefinitions.getEnumValues(enumId).entries()].sort(([a], [b]) => a - b).map(([key, text]) => [key, rename_(String(text), rename)]);
  const titleRows = copy(source.get(titleParam));
  query.structs.push({ structId: leagueStruct, params: { [structParam]: struct } });
  query.structs.push({ structId: struct, params: { ...Object.fromEntries(source), [titleParam]: titles, [bodyParam]: bodies } });
  query.enums.push({ enumId: titles, valueType: "s", defaultValue: titleRows[0]?.[1] ?? "", entries: titleRows });
  query.enums.push({ enumId: bodies, valueType: "s", defaultValue: "", entries: copy(source.get(bodyParam)) });
}

function bind(api) {
  LaterTask = class extends api.core.Task {
    constructor(ticks, action) {
      // Not keyed to the player: a click must not cancel it.
      super(ticks);
      this.action = action;
    }

    execute() {
      this.stop();
      this.action();
    }
  };
}

module.exports = function attach(api) {
  const { screens, journal, sections } = data;
  const pageButtons = [uid([screens.main, screens.primaryButton]), uid([screens.main, screens.secondaryButton])];
  const sectionButtons = SECTIONS.map((section) => uid(sections[section].button));
  bind(api);
  api.persistAttribute(STAGE_ATTRIBUTE);
  api.onCustomEvent("league:joined", joined);
  api.onCustomEvent("league:tutorial-stage", answerStage);
  api.onCustomEvent("league:login", login);
  api.onCustomEvent("league:content-rows", content);
  api.onCustomEvent("league:area-unlocked", areaUnlocked);
  api.onCustomEvent("league:relic-unlocked", relicUnlocked);
  api.onCustomEvent("interface:opened", interfaceOpened);
  api.onCustomEvent("interface:closed", interfaceClosed);
  api.onCustomEvent("screen-highlight:finished", walkthroughFinished);
  api.onCustomEvent("welcome-screen:shown", welcomeScreenShown);
  api.onPlayerLogout(logout);
  api.onInterfaceActionButton(uid(data.welcomePlay), welcomePlay);
  api.onInterfaceActionButton(uid(journal.stone), journalStone);
  api.onInterfaceActionButton(pageButtons, pageButton);
  api.onInterfaceActionButton(sectionButtons, sectionClicked);
};

module.exports.STAGE_ATTRIBUTE = STAGE_ATTRIBUTE;
module.exports.data = data;
