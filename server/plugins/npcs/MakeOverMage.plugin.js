const { DialogueChainBuilder } = require("../../src/main/typescript/elvarg/game/model/dialogues/builders/DialogueChainBuilder");
const { NpcDialogue } = require("../../src/main/typescript/elvarg/game/model/dialogues/entries/impl/NpcDialogue");
const { EndDialogue } = require("../../src/main/typescript/elvarg/game/model/dialogues/entries/impl/EndDialogue");

const MAKEOVER_INTERFACE_ID = 679;
// The designer's arrows, A/B and Confirm: cache components with an op ("*") whose script the
// interface's onload attaches. The official client only runs an op the server has enabled.
const MAKEOVER_BUTTONS = [15, 16, 19, 20, 23, 24, 27, 28, 31, 32, 35, 36, 39, 40, 46, 47, 50, 51, 54, 55, 58, 59, 62, 63, 68, 69, 74];
const OP1 = 1 << 1;
const NO_SLOT = -1;
const MAIN_MODAL_TARGET_UID = (161 << 16) | 16;
const MAKEOVER_COMMANDS = ["mm", "makeover", "makeovermage"];


function startMakeoverDialogue(player, npcId) {
  const dialogue = new DialogueChainBuilder().add(
    new NpcDialogue(0, npcId, "Hello! I can change your appearance. Choose Makeover when you're ready."),
    new EndDialogue(1),
  );
  player.getDialogueManager().startDialogues(dialogue);
}

function openMakeoverInterface(player) {
  if (!player || typeof player.getPacketSender !== "function") {
    return false;
  }
  player.getPacketSender().sendInterfaceRemoval();
  player.setInterfaceId?.(MAKEOVER_INTERFACE_ID);
  player.getAppearance?.().setCanChangeAppearance?.(true);
  player.getPacketSender().sendSubInterface(MAIN_MODAL_TARGET_UID, MAKEOVER_INTERFACE_ID, 0);
  for (const component of MAKEOVER_BUTTONS) {
    player.getPacketSender().sendInterfaceFlagsRange((MAKEOVER_INTERFACE_ID << 16) | component, NO_SLOT, NO_SLOT, OP1);
  }
  return true;
}

function canOpenMakeover(player, combatFactory) {
  return !player.busy?.() &&
    !combatFactory.inCombat(player) &&
    !player.getDialogueManager?.()?.isActive?.() &&
    !player.getPacketSender?.().hasInterruptibleInterface?.();
}

function talkToMakeoverMage({ player, npcId }) {
  startMakeoverDialogue(player, npcId);
}

function openMakeover({ player }) {
  return openMakeoverInterface(player);
}

module.exports = {
  name: "MakeOverMage",
  _test: { canOpenMakeover },
  register(api) {
    const CombatFactory = api.getCombatFactory();
    // A new account designs its character first, as in OSRS (there is no welcome screen for it).
    // The login hook runs just before the gameframe is sent: mount the modal after it.
    api.onPlayerLogin(({ player, isNewAccount }) => {
      if (!isNewAccount || player.isPlayerBot?.() === true) {
        return;
      }
      queueMicrotask(() => openMakeoverInterface(player));
    });

    for (const command of MAKEOVER_COMMANDS) {
      api.registerCommand(command, ({ player }) => {
        if (!canOpenMakeover(player, CombatFactory)) {
          player.sendMessage("You cannot change your appearance right now.");
          return true;
        }
        return openMakeoverInterface(player);
      }, undefined, "Change your appearance");
    }

    api.onNpcInteraction("Makeover Mage", {
      "Talk-to": talkToMakeoverMage,
      Makeover: openMakeover,
    });

    api.log("registered", {
      interfaceId: MAKEOVER_INTERFACE_ID,
    });
  },
};
