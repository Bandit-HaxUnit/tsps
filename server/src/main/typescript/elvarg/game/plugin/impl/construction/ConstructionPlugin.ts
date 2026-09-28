import type { PluginApi, PluginInterfaceActionClickEvent, PluginItemOnObjectEvent, PluginObjectInteractionEvent } from "../../../../plugins/PluginTypes";
import { Animation } from "../../../model/Animation";
import { Location } from "../../../model/Location";
import { Skill } from "../../../model/Skill";
import type { Player } from "../../../entity/impl/player/Player";
import type { PacketSender } from "../../../../net/packet/PacketSender";
import { ItemIdentifiers } from "../../../../util/ItemIdentifiers";
import { BUILDABLE_BY_KEY, CONSTRUCTION_BUILDABLES, CONSTRUCTION_ROOMS, HOTSPOT_BY_OBJECT_ID, type ConstructionBuildable, type ConstructionRoom } from "./ConstructionData";
import { PlayerHouseInstance, createDefaultHouseSave, type HouseFurnitureTarget, type HouseRoomPosition, type PlayerHouseSave } from "./PlayerHouseInstance";

type ConstructionPlayer = {
  getAttribute(key: string): unknown;
  getLocation(): Location;
  getPrivateArea(): unknown;
  getSkillManager(): { getCurrentLevel(skill: Skill): number; addExperiences(skill: Skill, experience: number): unknown };
  getInventory(): { contains(id: number): boolean; getAmount(id: number): number; delete(id: number, amount: number): unknown };
  getPacketSender(): PacketSender;
  moveTo(location: Location): unknown;
  performAnimation(animation: Animation): void;
  sendMessage(message: string): void;
  setAttribute(key: string, value: unknown): void;
};

const HAMMER_ID = ItemIdentifiers.HAMMER;
const SAW_ID = ItemIdentifiers.SAW;
const TINDERBOX_ID = ItemIdentifiers.TINDERBOX;
const NAIL_IDS = [ItemIdentifiers.BRONZE_NAILS, ItemIdentifiers.IRON_NAILS, ItemIdentifiers.STEEL_NAILS,
  ItemIdentifiers.BLACK_NAILS, ItemIdentifiers.MITHRIL_NAILS, ItemIdentifiers.ADAMANTITE_NAILS,
  ItemIdentifiers.RUNE_NAILS, ItemIdentifiers.DRAGON_NAILS];
const RIMMINGTON_HOUSE_PORTAL_ID = 15478;
const EXIT_PORTAL_ID = 4525;
const HOUSE_LOCKED_VARBIT = 2183;
const GARDEN_CENTERPIECE_HOTSPOT_ID = 15361;
const ROOM_DOOR_HOTSPOT_IDS = Array.from({ length: 18 }, (_, index) => 15305 + index);
const COINS_ID = 995;
const HOUSE_ATTRIBUTE = "construction:house";
const RIMMINGTON_PORTAL_EXIT = new Location(2954, 3224, 0);
const FURNITURE_BUILD_INTERFACE = 458;
const FURNITURE_BUILD_LIST_UID = (FURNITURE_BUILD_INTERFACE << 16) | 2;

// Expand the named furniture groups used by parlour hotspot menus.
const FURNITURE_GROUPS: Readonly<Record<string, readonly string[]>> = {
  PARLOUR_CHAIRS: ["CRUDE_WOODEN_CHAIR", "WOODEN_CHAIR", "ROCKING_CHAIR", "OAK_CHAIR", "OAK_ARMCHAIR", "TEAK_ARMCHAIR", "MAHOGANY_ARMCHAIR"],
  RUGS: ["BROWN_RUG", "RUG", "OPULENT_RUG"],
  BOOKCASES: ["WOODEN_BOOKCASE", "OAK_BOOKCASE", "MAHOGANY_BOOKCASE"],
  FIREPLACES: ["CLAY_FIREPLACE", "STONE_FIREPLACE", "MARBLE_FIREPLACE"],
  CURTAIN: ["TORN_CURTAINS", "CURTAINS", "OPULENT_CURTAINS"],
};

type PersistedHouse = PlayerHouseSave & { defaultBuildingMode: boolean };

const activeHouses = new WeakMap<ConstructionPlayer, PlayerHouseInstance>();
const buildingPlayers = new WeakSet<ConstructionPlayer>();
const pendingFurnitureMenus = new WeakMap<ConstructionPlayer, {
  house: PlayerHouseInstance;
  target: HouseFurnitureTarget;
  choices: readonly ConstructionBuildable[];
}>();

function houseStateFor(player: ConstructionPlayer): PersistedHouse {
  const saved = player.getAttribute(HOUSE_ATTRIBUTE);
  if (saved && typeof saved === "object" && Array.isArray((saved as PlayerHouseSave).rooms)) {
    const house = saved as PersistedHouse;
    const movedStarter = moveLegacyStarterHouse(house);
    const addedBuildingMode = typeof house.defaultBuildingMode !== "boolean";
    if (addedBuildingMode) house.defaultBuildingMode = false;
    if (addedBuildingMode || movedStarter) player.setAttribute(HOUSE_ATTRIBUTE, house);
    return house;
  }

  const house: PersistedHouse = { ...createDefaultHouseSave(), defaultBuildingMode: false };
  player.setAttribute(HOUSE_ATTRIBUTE, house);
  return house;
}

function moveLegacyStarterHouse(house: PlayerHouseSave): boolean {
  const rooms = house.rooms;
  const used = rooms.flat(2).filter((room) => room != null);
  const garden = rooms[1]?.[1]?.[1];
  const parlour = rooms[1]?.[1]?.[2];
  if (used.length !== 2 || garden?.roomKey !== "GARDEN" || parlour?.roomKey !== "PARLOUR") return false;
  rooms[1][1][1] = null;
  rooms[1][1][2] = null;
  rooms[1][4][4] = garden;
  rooms[1][4][5] = parlour;
  return true;
}

function houseFor(player: ConstructionPlayer): PlayerHouseInstance | null {
  const area = player.getPrivateArea();
  return area instanceof PlayerHouseInstance ? area : null;
}

function isBuildingMode(player: ConstructionPlayer): boolean {
  return buildingPlayers.has(player) || (!activeHouses.has(player) && houseFor(player) != null);
}

function releaseHouse(player: ConstructionPlayer, restoreLocation: boolean): void {
  const house = activeHouses.get(player);
  buildingPlayers.delete(player);
  if (house) {
    if (player.getPrivateArea() === house) house.leave(player as Player, false);
    house.destroy();
    activeHouses.delete(player);
  }
  if (restoreLocation && PlayerHouseInstance.isAllocationLocation(player.getLocation())) player.moveTo(RIMMINGTON_PORTAL_EXIT);
}

function enterHouse(player: ConstructionPlayer, buildingMode: boolean): boolean {
  releaseHouse(player, false);
  const house = new PlayerHouseInstance(houseStateFor(player));
  activeHouses.set(player, house);
  if (!house.enterHouse(player as Player, buildingMode)) {
    activeHouses.delete(player);
    house.destroy();
    player.sendMessage("Unable to load your house.");
    return false;
  }
  if (buildingMode) buildingPlayers.add(player);
  else buildingPlayers.delete(player);
  player.sendMessage(buildingMode ? "You enter your house in building mode." : "You enter your house.");
  return true;
}

function constructionLevel(player: ConstructionPlayer): number {
  return player.getSkillManager().getCurrentLevel(Skill.CONSTRUCTION);
}

function rebuildHouse(player: ConstructionPlayer, house: PlayerHouseInstance): void {
  player.setAttribute(HOUSE_ATTRIBUTE, house.save);
  if (!house.rebuild(player as Player, true)) player.sendMessage("Unable to rebuild your house.");
}

function chooseRoom(api: PluginApi, player: ConstructionPlayer, house: PlayerHouseInstance, target: HouseRoomPosition, page = 0): void {
  const rooms = CONSTRUCTION_ROOMS.filter((room) => house.canPlaceRoom(room, target, constructionLevel(player)) == null);
  const choices = rooms.slice(page * 4, page * 4 + 4);
  if (choices.length === 0) return player.sendMessage("You cannot build any rooms at this door with your current Construction level.");
  const options: Array<string | (() => void)> = [];
  for (const room of choices) options.push(`${room.name} - ${room.cost.toLocaleString()} coins`, () => buildRoom(player, house, target, room));
  if ((page + 1) * 4 < rooms.length) options.push("More rooms", () => chooseRoom(api, player, house, target, page + 1));
  api.sendMultiChatboxPrompt(player, "Choose a room to build", ...options);
}

function buildRoom(player: ConstructionPlayer, house: PlayerHouseInstance, target: HouseRoomPosition, room: ConstructionRoom): void {
  const problem = house.canPlaceRoom(room, target, constructionLevel(player));
  if (problem) return player.sendMessage(problem);
  if (player.getInventory().getAmount(COINS_ID) < room.cost) return player.sendMessage("You don't have enough coins to build that room.");
  player.getInventory().delete(COINS_ID, room.cost);
  house.placeRoom(target, room);
  rebuildHouse(player, house);
  player.sendMessage(`You build a ${room.name}.`);
}

function manageRoom(api: PluginApi, player: ConstructionPlayer, house: PlayerHouseInstance, target: HouseRoomPosition): void {
  const room = house.getRoom(target);
  if (!room) return;
  const name = room.roomKey.replace(/_/g, " ").toLowerCase();
  api.sendMultiChatboxPrompt(player, `Manage ${name}`, "Rotate clockwise", () => {
    if (!house.rotateRoom(target)) return;
    rebuildHouse(player, house);
    player.sendMessage(`You rotate the ${name}.`);
  }, "Remove room", () => {
    const problem = house.canRemoveRoom(target);
    if (problem) return player.sendMessage(problem);
    api.sendMultiChatboxPrompt(player, `Remove the ${name}?`, "Yes, remove it", () => {
      const currentProblem = house.canRemoveRoom(target);
      if (currentProblem) return player.sendMessage(currentProblem);
      house.removeRoom(target);
      rebuildHouse(player, house);
      player.sendMessage(`You remove the ${name}.`);
    }, "No", () => {});
  }, "Cancel", () => {});
}

function openRoomDoor(api: PluginApi, event: PluginObjectInteractionEvent): boolean {
  const player = event.player as ConstructionPlayer;
  const house = houseFor(player);
  if (!house || !isBuildingMode(player)) return false;
  const target = house.getDoorTarget(event.location);
  if (!target) return false;
  if (!house.getRoom(target)) {
    chooseRoom(api, player, house, target);
    return true;
  }
  const doorRoom = house.getRoomPositionAt(event.location);
  if (doorRoom && house.getRoom(doorRoom)) {
    // A shared doorway belongs to two rooms. Do not silently select the
    // adjoining room when the player intends to remove the room they are in.
    const playerRoom = house.getRoomPositionAt(event.sourceLocation ?? event.location);
    const onTargetSide = playerRoom?.x === target.x && playerRoom.y === target.y && playerRoom.plane === target.plane;
    const current = onTargetSide ? target : doorRoom;
    const adjoining = onTargetSide ? doorRoom : target;
    api.sendMultiChatboxPrompt(player, "Which room do you want to manage?",
      "Room on this side", () => manageRoom(api, player, house, current),
      "Room on the other side", () => manageRoom(api, player, house, adjoining),
      "Cancel", () => {});
  } else manageRoom(api, player, house, target);
  return true;
}

function toggleHouseLock(event: PluginObjectInteractionEvent): boolean {
  const player = event.player as ConstructionPlayer;
  if (!houseFor(player)) return false;
  const sender = player.getPacketSender();
  const locked = sender.getVarbit(HOUSE_LOCKED_VARBIT) === 0;
  sender.sendVarbit(HOUSE_LOCKED_VARBIT, locked ? 1 : 0);
  player.sendMessage(locked ? "You lock the house portal." : "You unlock the house portal.");
  return true;
}

function exitHouse(player: ConstructionPlayer): boolean {
  const house = houseFor(player);
  if (!house) return false;
  buildingPlayers.delete(player);
  activeHouses.delete(player);
  house.exitHouse(player as Player, RIMMINGTON_PORTAL_EXIT.clone());
  house.destroy();
  return true;
}

function openHouseSettings(api: PluginApi, player: ConstructionPlayer): void {
  const house = houseStateFor(player);
  api.sendMultiChatboxPrompt(player, "House settings", `${house.defaultBuildingMode ? "Disable" : "Enable"} default building mode`, () => {
    house.defaultBuildingMode = !house.defaultBuildingMode;
    player.setAttribute(HOUSE_ATTRIBUTE, house);
    player.sendMessage(`Default building mode: ${house.defaultBuildingMode ? "on" : "off"}.`);
  }, "Cancel", () => {});
}

function formatBuildable(buildable: { key: string }): string {
  return buildable.key.replace(/_/g, " ").toLowerCase();
}

function getBuildMaterials(player: ConstructionPlayer, house: PlayerHouseInstance, target: HouseFurnitureTarget, buildable: ConstructionBuildable): Map<number, number> | string {
  if (constructionLevel(player) < buildable.level) return `You need Construction level ${buildable.level} to build that.`;
  if (!player.getInventory().contains(HAMMER_ID) || !player.getInventory().contains(SAW_ID)) return "You need a hammer and a saw to build that.";
  const requiredItems = new Map<number, number>();
  for (const material of buildable.materials) {
    if (material.source === "NAILS") {
      let remaining = material.amount;
      for (const id of NAIL_IDS) {
        const reserved = requiredItems.get(id) ?? 0;
        const amount = Math.min(remaining, Math.max(0, player.getInventory().getAmount(id) - reserved));
        if (amount > 0) requiredItems.set(id, reserved + amount);
        remaining -= amount;
        if (remaining === 0) break;
      }
      if (remaining > 0) return "You do not have enough nails.";
    } else if (material.itemId != null) requiredItems.set(material.itemId, (requiredItems.get(material.itemId) ?? 0) + material.amount);
    else if (material.source === "Tool.TINDER_BOX") {
      if (!player.getInventory().contains(TINDERBOX_ID)) return "You need a tinderbox to build that.";
    } else if (material.source && BUILDABLE_BY_KEY.has(material.source)) {
      if (house.getFurnitureAtTarget(target)?.buildableKey !== material.source) return `You need the ${material.source.replace(/_/g, " ").toLowerCase()} already built there.`;
    } else return "This build has an unsupported material requirement.";
  }
  for (const [itemId, amount] of requiredItems) if (player.getInventory().getAmount(itemId) < amount) return "You do not have the required materials.";
  return requiredItems;
}

function buildFurniture(player: ConstructionPlayer, house: PlayerHouseInstance, target: HouseFurnitureTarget, buildable: ConstructionBuildable): void {
  const materials = getBuildMaterials(player, house, target, buildable);
  if (typeof materials === "string") return player.sendMessage(materials);
  for (const [itemId, amount] of materials) player.getInventory().delete(itemId, amount);
  if (buildable.buildAnimationId >= 0) player.performAnimation(new Animation(buildable.buildAnimationId));
  house.setFurniture(target, buildable);
  player.getSkillManager().addExperiences(Skill.CONSTRUCTION, buildable.experience);
  rebuildHouse(player, house);
  player.sendMessage(`You build a ${formatBuildable(buildable)}.`);
}

function materialName(material: ConstructionBuildable["materials"][number]): string {
  if (material.itemId != null) return material.source?.replace(/_/g, " ").toLowerCase() || `Item ${material.itemId}`;
  if (material.source && BUILDABLE_BY_KEY.has(material.source)) return formatBuildable({ key: material.source });
  return material.source?.replace(/^Tool\./, "").replace(/\.toItem\(.*\)$/, "").replace(/_/g, " ").toLowerCase() || "Unknown material";
}

function furnitureCreationText(buildable: ConstructionBuildable): string {
  const name = formatBuildable(buildable);
  const materials = buildable.materials.slice(0, 4).map((material) => `${materialName(material)}: ${material.amount.toLocaleString()}`);
  return `${name}|${[...materials, "", "", "", ""].slice(0, 4).join("<br>")}<br>`;
}

function chooseFurniture(player: ConstructionPlayer, house: PlayerHouseInstance, target: HouseFurnitureTarget): void {
  const hotspot = HOTSPOT_BY_OBJECT_ID.get(target.sourceObjectId);
  if (!hotspot) return;
  const choices = hotspot.buildables
    .flatMap((key) => FURNITURE_GROUPS[key] ?? [key])
    .map((key) => BUILDABLE_BY_KEY.get(key))
    .filter((buildable): buildable is ConstructionBuildable => buildable?.menuRowId != null);
  if (choices.length === 0) {
    player.getPacketSender().sendInterfaceRemoval();
    player.sendMessage("This construction hotspot does not have a buildable configured yet.");
    return;
  }
  const sender = player.getPacketSender();
  sender.sendInterface(FURNITURE_BUILD_INTERFACE);
  choices.forEach((buildable, index) => {
    // Script 1404 resolves the preview item and name through furniture DB table 110.
    sender.sendClientScript(
      1404,
      index + 1,
      buildable.menuRowId!,
      buildable.level,
      furnitureCreationText(buildable),
      typeof getBuildMaterials(player, house, target, buildable) === "string" ? 0 : 1,
    );
  });
  sender
    .sendClientScript(1406, choices.length, 0)
    .sendInterfaceFlagsRange(FURNITURE_BUILD_LIST_UID, 1, choices.length, 1);
  pendingFurnitureMenus.set(player, { house, target, choices });
}

function selectFurnitureFromInterface(event: PluginInterfaceActionClickEvent): boolean {
  if (event.groupId !== FURNITURE_BUILD_INTERFACE || event.childId !== 2) return false;
  const pending = pendingFurnitureMenus.get(event.player);
  if (!pending) return false;
  // Script 1405 sends RESUME_PAUSEBUTTON with a one-based child index.
  const choice = Number.isInteger(event.action) && event.action > 0 ? pending.choices[event.action - 1] : undefined;
  if (!choice || houseFor(event.player) !== pending.house || !isBuildingMode(event.player)) return false;
  pendingFurnitureMenus.delete(event.player);
  event.player.getPacketSender().sendInterfaceRemoval();
  buildFurniture(event.player, pending.house, pending.target, choice);
  return true;
}

function openBuildMenu(event: PluginObjectInteractionEvent): boolean {
  const player = event.player as ConstructionPlayer;
  const house = houseFor(player);
  if (!house || !isBuildingMode(player)) return false;
  const target = house.getFurnitureTarget(event.location, event.objectId);
  if (!target) return false;
  chooseFurniture(player, house, target);
  return true;
}

function tryRemoveFurniture(api: PluginApi, event: PluginObjectInteractionEvent): boolean {
  if (event.definition?.getInteractions()?.[event.clickType - 1]?.toLowerCase() !== "remove") return false;
  const player = event.player as ConstructionPlayer;
  const house = houseFor(player);
  const type = event.object?.getType?.() ?? 10;
  if (!house || !isBuildingMode(player) || !house.getFurnitureAt(event.location, event.objectId, type)) return false;
  const problem = house.canRemoveFurniture(event.location, event.objectId, type);
  if (problem) {
    player.sendMessage(problem);
    return true;
  }
  api.sendMultiChatboxPrompt(player, "Remove this furniture?", "Yes, remove it", () => {
    const currentProblem = house.canRemoveFurniture(event.location, event.objectId, type);
    if (currentProblem) return player.sendMessage(currentProblem);
    const removed = house.removeFurniture(event.location, event.objectId, type);
    if (!removed) return;
    player.performAnimation(new Animation(3685));
    rebuildHouse(player, house);
    player.sendMessage(`You remove the ${formatBuildable({ key: removed.buildableKey })}.`);
  }, "No", () => {});
  return true;
}

function onObject(event: PluginObjectInteractionEvent): boolean {
  const player = event.player as ConstructionPlayer;
  if (event.objectId === GARDEN_CENTERPIECE_HOTSPOT_ID && !isBuildingMode(player)) return exitHouse(player);
  return openBuildMenu(event);
}

function onItemOnObject(event: PluginItemOnObjectEvent): boolean {
  if (event.itemId !== HAMMER_ID && event.itemId !== SAW_ID) return false;
  return openBuildMenu(event as unknown as PluginObjectInteractionEvent);
}

export const ConstructionPlugin = {
  name: "Construction",
  register(api: PluginApi): void {
    const hotspotIds = [...HOTSPOT_BY_OBJECT_ID.keys()].filter((id) => id >= 0);
    const furnitureObjectIds = [...new Set(CONSTRUCTION_BUILDABLES.flatMap((buildable) => buildable.objectIds.filter((id) => id >= 0)))];
    api.persistAttribute(HOUSE_ATTRIBUTE);
    api.onObjectFirstClick(RIMMINGTON_HOUSE_PORTAL_ID, (event) => enterHouse(event.player as ConstructionPlayer, houseStateFor(event.player as ConstructionPlayer).defaultBuildingMode));
    api.onObjectSecondClick(RIMMINGTON_HOUSE_PORTAL_ID, (event) => {
      openHouseSettings(api, event.player as ConstructionPlayer);
      return true;
    });
    api.onObjectThirdClick(RIMMINGTON_HOUSE_PORTAL_ID, (event) => enterHouse(event.player as ConstructionPlayer, true));
    api.onObjectFirstClick(EXIT_PORTAL_ID, (event) => exitHouse(event.player as ConstructionPlayer));
    api.onObjectSecondClick(EXIT_PORTAL_ID, toggleHouseLock);
    api.onObjectFirstClick(ROOM_DOOR_HOTSPOT_IDS, (event) => openRoomDoor(api, event));
    api.onObjectFifthClick(ROOM_DOOR_HOTSPOT_IDS, (event) => openRoomDoor(api, event));
    api.onObjectFirstClick(furnitureObjectIds, (event) => tryRemoveFurniture(api, event));
    api.onObjectSecondClick(furnitureObjectIds, (event) => tryRemoveFurniture(api, event));
    api.onObjectFifthClick(furnitureObjectIds, (event) => tryRemoveFurniture(api, event));
    api.onObjectFirstClick(hotspotIds, onObject);
    api.onObjectSecondClick(hotspotIds, onObject);
    api.onObjectFifthClick(hotspotIds, onObject);
    api.onItemOnObject((event) => { onItemOnObject(event); }, { noted: false });
    api.onInterfaceActionClick((event) => {
      if (selectFurnitureFromInterface(event)) event.handled = true;
    });
    api.onPlayerLogin(({ player }) => {
      if (PlayerHouseInstance.isAllocationLocation(player.getLocation())) {
        player.moveTo(RIMMINGTON_PORTAL_EXIT.clone());
        player.sendMessage("Returned from your house after the instance closed.");
      }
    });
    api.onPlayerDisconnect(({ player }) => releaseHouse(player as ConstructionPlayer, true));
    api.onPlayerLogout(({ player }) => releaseHouse(player as ConstructionPlayer, true));
    api.log("registered", { hotspots: hotspotIds.length, buildables: BUILDABLE_BY_KEY.size });
  },
};

export default ConstructionPlugin;
