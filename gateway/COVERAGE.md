# Coverage

Every tsps message, and the revision-241 packet it becomes. **State** is `mapped`, `dropped`
(never reaches the official client; counted at runtime) or `todo`. **M** is the milestone that
maps it. A row only becomes `mapped` with a test that decodes the result.

Native-bit rows need the `native` HANDSHAKE capability: tsps sends the extra fields only to gateway
sessions, so the browser wire format doesn't change.

## tsps → client

| tsps message | 241 packet(s) | State | M | Notes |
| --- | --- | --- | --- | --- |
| 0 WELCOME | — | dropped | 1 | browser clock sync |
| 1 TICK | SERVER_TICK_END | todo | 1 | tsps sends it first; the gateway flushes the tick and ends with it |
| 2 HANDSHAKE | login response OK, first PLAYER_INFO | todo | 1 | index, admin → staff level, members |
| 3 LOGIN_RESPONSE | login response | todo | 1 | 2 (full) → 7, 27 → 26, others 1:1; token dropped |
| 4 LOGOUT_RESPONSE | LOGOUT / MESSAGE_GAME | todo | 4 | a refusal becomes a game message |
| 6 PLUGIN_MESSAGE | — | dropped | 1 | plugin features (quest helper, voice, pest control) |
| 20 PLAYER_SYNC | PLAYER_INFO | todo | 2–3 | deltas → absolute; wearpos from cache |
| 21 NPC_INFO | NPC_INFO | todo | 3 | base anims and models from cache; transform → transmog |
| 22 ANIM | — | dropped | 1 | base anims are in appearance |
| 23 MOVEMENT_POSITION | — | dropped | 2 | sub-tile movement has no OSRS form |
| 40 / 41 / 44 VARP_SMALL / LARGE / LONG | VARP_SMALL / LARGE / LONG | todo | 4 | ids ≥ the cache varp count filtered |
| 42 VARBIT | VARP_SMALL / LARGE | todo | 4 | varp mirror + cache varbit definitions |
| 50 / 51 INVENTORY_SNAPSHOT / SLOT | UPDATE_INV_FULL / PARTIAL (93) | todo | 5 | |
| 52 / 53 BANK_SNAPSHOT / SLOT | UPDATE_INV_FULL / PARTIAL (95) | todo | 5 | tab/placeholder bits dropped (sent as varbits) |
| 54 / 55 GROUND_ITEMS / DELTA | OBJ_ADD / DEL / COUNT in zone updates | todo | 5 | stack-id state; re-sent after each rebuild |
| 70 / 71 SKILLS_SNAPSHOT / DELTA | UPDATE_STAT_V2 per skill | todo | 4 | |
| 81 RUN_ENERGY | UPDATE_RUNENERGY, UPDATE_RUNWEIGHT, varp 173 | todo | 5 | native: full energy + weight |
| 83 SPOT_ANIM | MAP_ANIM | todo | 7 | |
| 84 PROJECTILES | PROJANIM_SPECIFIC_V4 | todo | 8 | |
| 87 DESTINATION | SET_MAP_FLAG_V2 | todo | 2 | |
| 88 PLAYER_OPTION | SET_PLAYER_OP | todo | 3 | plus baseline Trade with / Follow, Attack in PvP |
| 89 HINT_ARROW | HINT_ARROW | todo | 7 | tile level scope lost |
| 90 ATTACK_TIMER | — | dropped | 8 | tsps HUD |
| 100 / 101 WIDGET_OPEN / CLOSE | IF_OPENSUB / IF_CLOSESUB | todo | 4 | gateway picks and remembers the target |
| 102 WIDGET_SET_ROOT | IF_OPENTOP | todo | 1 | |
| 103 WIDGET_OPEN_SUB | VARP_*, RUNCLIENTSCRIPT, IF_OPENSUB, IF_SETHIDE, RUNCLIENTSCRIPT | todo | 4 | split in order; 161 targets remapped; group ≥ 30000 dropped |
| 104 WIDGET_CLOSE_SUB | IF_CLOSESUB | todo | 4 | 161 remap |
| 105–108, 113–115, 117–119 WIDGET_SET_* | IF_SETTEXT / HIDE / OBJECT / NPCHEAD / ANGLE / ANIM / PLAYERHEAD / MODEL / POSITION / COLOUR | todo | 4 | |
| 109 / 111 / 112 WIDGET_SET_FLAGS* | IF_SETEVENTS_V2 | todo | 4 | old op bits 1–10 move to events2 |
| 110 WIDGET_RUN_SCRIPT | VARP_*, UPDATE_INV_FULL, RUNCLIENTSCRIPT | todo | 4 | script -1 = vars/inventories only |
| 116 WIDGET_SET_QUEST_LIST | — | dropped | 4 | browser-only quest list widget |
| 120 CHAT_MESSAGE | MESSAGE_GAME, PLAYER_INFO chat, MESSAGE_PRIVATE(_ECHO), MESSAGE_FRIENDCHANNEL | todo | 3, 6 | public chat merged with the overhead text |
| 121 FRIENDS_CHAT_UPDATE | UPDATE_FRIENDLIST, UPDATE_IGNORELIST, UPDATE_FRIENDCHAT_CHANNEL_FULL_V2, FRIENDLIST_LOADED | todo | 6 | |
| 122 CHAT_FILTER_SETTINGS | CHAT_FILTER_SETTINGS + _PRIVATECHAT | todo | 6 | |
| 123 TRIGGER_ONDIALOGABORT | TRIGGER_ONDIALOGABORT | todo | 4 | |
| 131 SOUND | SYNTH_SOUND / SOUND_AREA | todo | 7 | |
| 132 PLAY_JINGLE / 133 PLAY_SONG | MIDI_JINGLE / MIDI_SONG_V2 | todo | 7 | |
| 134 / 135 / 136 LOC_ADD_CHANGE / DEL / ANIM | LOC_ADD_CHANGE_V2 / LOC_DEL / LOC_ANIM in zone updates | todo | 7 | |
| 137 CAMERA_CONTROL | CAM_* | todo | 7 | translate and tile glide have no OSRS form |
| 140 / 141 REBUILD_REGION / NORMAL | REBUILD_REGION_V2 / REBUILD_LOGIN_V2 / REBUILD_NORMAL_V2 | todo | 1–2 | |
| 142 / 143 REBUILD_WORLDENTITY / WORLDENTITY_INFO | REBUILD_WORLDENTITY_V4 / WORLDENTITY_INFO_V7 | todo | 9 | native: boat level + owner |
| 144 REGION_REPLACEMENT | — | dropped | 2 | server map data the client can't load |
| 145 / 146 SET / RESET_INTERACTION_MODE | SET / RESET_INTERACTION_MODE | todo | 7 | |
| 150 / 152 SHOP_OPEN / CLOSE | UPDATE_INV_FULL / STOP_TRANSMIT (516) | todo | 5 | interface + script already sent separately |
| 154 TRADE_REQUEST | — | dropped | 9 | the type-101 game message carries it |
| 155 / 156 / 157 TRADE_OPEN / UPDATE / CLOSE | UPDATE_INV_FULL (90, 90 \| 0x8000), MESSAGE_GAME | todo | 9 | |
| 190 COLLECTION_LOG_SNAPSHOT | UPDATE_INV_FULL (620) | todo | 5 | |
| 210 GAMEMODE_DATA | — | dropped | 4 | custom items/models, league overrides; custom items fall back to `baseItemId` |
| 220 SYSTEM_UPDATE | UPDATE_REBOOT_TIMER_V2 | todo | 7 | |
| (equipment, never sent) | UPDATE_INV_FULL (94) | todo | 5 | from appearance; native: quantities |
| (GE varps 7900–7955) | UPDATE_STOCKMARKET_SLOT | todo | 5 | |

## Client → tsps

| 241 packet | tsps opcode | State | M | Notes |
| --- | --- | --- | --- | --- |
| login block | 204 LOGIN, 202 HANDSHAKE | todo | 1 | X-Real-IP; native bit; token logins rejected |
| NO_TIMEOUT | 201 PING | todo | 1 | at most every 5 s |
| MOVE_GAMECLICK / MOVE_MINIMAPCLICK | 16 MOVE_GAMECLICK | todo | 2 | |
| SET_HEADING | 214 | todo | 2 | |
| IF_BUTTON (if1) / IF_BUTTONX | 13 / 91 | todo | 4 | |
| IF_SUBOP | 89 | todo | 4 | |
| IF_BUTTOND | 1, or 242 INVENTORY_MOVE for 149:0 | todo | 4–5 | |
| IF_BUTTONT | 90, or 241 INVENTORY_USE_ON for item on item | todo | 4–5 | |
| IF_SCRIPT_TRIGGER | 30 IF_TRIGGEROPLOCAL | todo | 4 | |
| RESUME_PAUSEBUTTON / P_COUNT / P_NAME / P_STRING / P_LONG | 62 / 192 / 193 / 194 / 192 | todo | 4 | |
| CLOSE_MODAL | 55 IF_CLOSE | todo | 4 | |
| settings / run orb buttons | 191 VARP_TRANSMIT | todo | 4 | from the varp mirror |
| logout button | 203 LOGOUT | todo | 4 | |
| OPPLAYER1–8 / OPPLAYERT | 44… / 32 or 65 | todo | 3, 5 | `T` split by selected component |
| OPNPC1–5 / OPNPC6 / OPNPCT | 76, 12, 34, 70, 57 / 9 / 75 or 36 | todo | 3, 5 | subop dropped |
| OPLOC1–5 / OPLOC6 / OPLOCT | 96, 28, 42, 38, 51 / 85 / 2 or 86 | todo | 5 | |
| OPOBJ1–5 / OPOBJ6 / OPOBJT | 102, 43, 103, 56, 82 / 104 / 94 or 79 | todo | 5 | |
| OPWORLDENTITY1–5 | 220–224 | todo | 9 | |
| OPWORLDENTITY6 | — | dropped | 9 | 241 sends a type id, tsps reads an index |
| MESSAGE_PUBLIC / CLIENT_CHEAT | 190 CHAT | todo | 6 | cheat → `::cmd` |
| MESSAGE_PRIVATE | 197 | todo | 6 | |
| FRIENDLIST / IGNORELIST ADD / DEL, FRIENDCHAT_* | 196 FRIENDS_CHAT_ACTION | todo | 6 | |
| CHAT_SETFILTER | 198 | todo | 6 | |
| SEND_SNAPSHOT | 199 REPORT_ABUSE | todo | 6 | |
| CLICKWORLDMAP / TELEPORT | 105 / 212 | todo | 7 | admin only |
| UPDATE_PLAYER_MODEL_V2 | 37 APPEARANCE_SET | todo | 3 | needs a gateway decoder; rsprot 241 has none |
| trade interface buttons | 180 TRADE_ACTION | todo | 9 | |
| WINDOW_STATUS | — | todo | 4 | picks the toplevel |
| MAP_BUILD_COMPLETE | — | dropped | 2 | gateway-only signal |
| EVENT_*, IDLE, REFLECTION_CHECK_REPLY, SEND_PING_REPLY, CONNECTION_TELEMETRY, DETECT_MODIFIED_CLIENT, MEMBERSHIP_PROMOTION_ELIGIBILITY, RSEVEN_STATUS, SOUND_JINGLEEND, BUG_REPORT, HISCORE_REQUEST, IF_CRMVIEW_OP, EXIT_FREECAM, CLAN_* | — | dropped | 1 | no tsps handler; clans don't exist in tsps |
