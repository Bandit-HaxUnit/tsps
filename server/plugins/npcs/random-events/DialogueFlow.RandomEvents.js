"use strict";

// Shared builder for the event dialogue flows: NPC lines, then up to five options, then end.
function chat(api, { player, npcId = -1, lines = [], playerLines = [], options = [], onEnd = null, end = true }) {
  const builder = new api.core.DialogueChainBuilder();
  let index = 0;
  for (const page of lines) {
    const text = typeof page === "string" ? page : page.text;
    builder.add(new api.core.NpcDialogue(index++, typeof page === "string" ? npcId : page.npcId ?? npcId, text));
  }
  for (const text of playerLines) builder.add(new api.core.PlayerDialogue(index++, text));
  if (options.length) {
    const callbacks = options.map(option => option[1]);
    builder.add(new api.core.OptionDialogue(index++, {
      executeOption(option) {
        player.getPacketSender().sendInterfaceRemoval();
        (callbacks[Number(option)] ?? (() => {}))();
      },
    }, ...options.map(option => option[0])));
  } else {
    // ActionDialogue runs when the player reaches this page, i.e. after the last line.
    if (onEnd) builder.add(new api.core.ActionDialogue(index++, { execute: () => onEnd() }));
    if (end) builder.add(new api.core.EndDialogue(index));
  }
  player.getDialogueManager().startDialogues(builder);
  return builder;
}

function statement(api, player, text, onEnd = null) {
  const builder = new api.core.DialogueChainBuilder()
    .add(new api.core.StatementDialogue(0, text))
    .add(new api.core.EndDialogue(1));
  player.getDialogueManager().startDialogues(builder);
  return builder;
}

function itemStatement(api, player, itemId, text) {
  const builder = new api.core.DialogueChainBuilder()
    .add(new api.core.ItemStatementDialogue(0, itemId, text))
    .add(new api.core.EndDialogue(1));
  player.getDialogueManager().startDialogues(builder);
  return builder;
}

module.exports = { chat, statement, itemStatement };
