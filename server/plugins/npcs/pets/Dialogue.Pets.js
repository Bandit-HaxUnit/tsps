// Canonical NPC/Pet sources, guarded by the actual owned follower below.
// Source templates describe text provenance, not whether an NPC is a follower.
const fs = require("fs");
const path = require("path");
let api, services, candidates;

function loadCandidates() {
  if (candidates) return candidates;
  const directory = api.core.GameConstants.DEFINITIONS_DIRECTORY;
  const types = JSON.parse(fs.readFileSync(path.join(directory, "dialogue-types.json"), "utf8"));
  const speakers = new Set([...types.pet, ...types.npc]);
  const index = JSON.parse(fs.readFileSync(path.join(directory, "npc-dialogue-index.json"), "utf8"));
  candidates = new Map(Object.entries(index).map(([id, rows]) => [Number(id), rows.filter(row => speakers.has(row.page))])
    .filter(([, rows]) => rows.length));
  return candidates;
}

const slug = value => String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
// These two cache241 physical forms share the Tektiny/Vespina transcript sections.
const SHARED_FORM_SECTIONS = new Map([["Enraged Tektiny", "Tektiny"], ["Flying Vespina", "Vespina"]]);
function ordinaryVariant(row, name) {
  const form = slug(SHARED_FORM_SECTIONS.get(name) ?? name);
  // Dated pre-update transcripts are retained as history, not current forms.
  const variants = (row.variants ?? [])
    .filter(key => !/^standard-dialogue-before-\d{1,2}-[a-z]+-\d{4}$/.test(key));
  const matching = [`${form}-standard-dialogue`, `pet-${form}-standard-dialogue`, `standard-dialogue-${form}`, `${form}-dialogue`, form]
    .filter(key => variants.includes(key));
  if (matching.length === 1) return matching[0];
  if (matching.length > 1) return undefined;
  // converse has already verified the actual current follower belongs to this
  // player. Other-player and Menagerie sections are separate interaction paths.
  if (variants.includes("standard-dialogue-owner")) return "standard-dialogue-owner";
  // A generic standard section applies to all indexed forms only when no separate
  // ordinary form section would need a selector. Never fall through to an overhead.
  const ordinary = variants.filter(key => !key.startsWith("rare-") && (key === "standard-dialogue"
    || key.endsWith("-standard-dialogue") || key.startsWith("standard-dialogue-")
    || key.endsWith("-dialogue")));
  return ordinary.length === 1 && ordinary[0] === "standard-dialogue" ? ordinary[0] : undefined;
}

function converse(request) {
  const {player, npc, pet, action} = request;
  if (request.handled || !["talk-to", "interact"].includes(String(action).toLowerCase())
      || services.catInfoOf(pet) || !player?.isRegistered?.() || player.busy()
      || !npc?.isRegistered() || !npc.isPet() || !npc.isVisible() || npc.getOwner() !== player
      || player.getAttribute(services.currentAttribute) !== npc
      || api.core.World.getRemoveNPCQueue().includes(npc)) return;
  const options = (loadCandidates().get(npc.getId()) ?? []).map(row => ({
    page: row.page.replace(/^Transcript:/, ""),
    variant: ordinaryVariant(row, npc.getCurrentDefinition(player).getName()),
  })).filter(choice => choice.variant);
  if (options.length !== 1) return;
  const start = {player, npc, npcId: npc.getId(), variant: options[0], exact: true, handled: false};
  api.emitCustomEvent("npc-dialogue:start", start);
  request.handled = start.handled;
}

function attach(pluginApi, helpers) {
  api = pluginApi; services = helpers; candidates = null;
  api.onCustomEvent("pets:interact", converse);
}
module.exports = {attach};
