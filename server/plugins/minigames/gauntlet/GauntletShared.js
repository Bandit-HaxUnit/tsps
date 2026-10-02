"use strict";

/**
 * The Gauntlet: shared state and constants every unit uses.
 *
 * Wiki: https://oldschool.runescape.wiki/w/The_Gauntlet
 */

const state = { api: null, core: null };

function bind(api) {
  state.api = api;
  state.core = api.core;
}

function core() {
  return state.core;
}

function api() {
  return state.api;
}

// The lobby beneath Prifddinas, where runs start and end.
const LOBBY = { x: 3032, y: 6127, z: 1 };
// Every Gauntlet room is played on this plane.
const PLANE = 1;

module.exports = { bind, core, api, LOBBY, PLANE };
