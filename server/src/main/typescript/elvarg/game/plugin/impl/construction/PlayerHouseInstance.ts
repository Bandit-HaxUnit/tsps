import { Boundary } from "../../../model/Boundary";
import { PrivateArea } from "../../../model/areas/impl/PrivateArea";
import { Location } from "../../../model/Location";
import { CachePipeline } from "../../../cache/CachePipeline";
import { CacheMaps } from "../../../cache/CacheMaps";
import { CacheDefinitions } from "../../../cache/CacheDefinitions";
import { ByteBuffer } from "../../../cache/codec/rs/io/ByteBuffer";
import { GameObject } from "../../../entity/impl/object/GameObject";
import { encodeLocDel, encodeRebuildRegion } from "../../../../net/protocol/ClientProtocol";
import type { Player } from "../../../entity/impl/player/Player";
import { BUILDABLE_BY_KEY, CONSTRUCTION_ROOMS, HOTSPOT_BY_OBJECT_ID, HOUSE_TEMPLATE_CHUNKS, ROOM_BY_KEY, type ConstructionBuildable, type ConstructionRoom } from "./ConstructionData";
import { emptyHousePalette, HOUSE_PLANES, HOUSE_SCENE_CHUNKS, packTemplateChunk, rotateHotspot } from "./HousePaletteCompiler";

export type SavedHouseRoom = Readonly<{
  roomKey: string;
  rotation: number;
  furniture: Readonly<Record<string, string>>;
  /** Location-keyed furniture keeps repeated hotspots independent and rotates with its room. */
  furnitureByLocation?: Readonly<Record<string, SavedHouseFurniture>>;
}>;

export type SavedHouseFurniture = Readonly<{
  buildableKey: string;
  hotspotKey: string;
  sourceObjectId: number;
  localX: number;
  localY: number;
  type: number;
  face: number;
}>;

/** JSON-safe player persistence shape. `rooms[plane][x][y]` is a room or null. */
export type PlayerHouseSave = {
  rooms: Array<Array<Array<SavedHouseRoom | null>>>;
};

export type HouseAllocation = Readonly<{ baseX: number; baseY: number }>;
export type HouseRoomPosition = Readonly<{ x: number; y: number; plane: number }>;
export type HouseFurnitureTarget = Readonly<{
  position: HouseRoomPosition;
  hotspotKey: string;
  sourceObjectId: number;
  localX: number;
  localY: number;
  type: number;
  face: number;
}>;

const HOUSE_SIZE = 104;
const HOUSE_STRIDE = 112;
const HOUSE_ALLOCATION_COLUMNS = 16;
const HOUSE_ALLOCATION_COUNT = HOUSE_ALLOCATION_COLUMNS * HOUSE_ALLOCATION_COLUMNS;
const ROOM_DOOR_HOTSPOT_MIN = 15305;
const ROOM_DOOR_HOTSPOT_MAX = 15322;
const HOUSE_BUILDING_MODE_VARBIT = 2176;

type TemplateObject = Readonly<{
  id: number;
  sourceChunkX: number;
  sourceChunkY: number;
  localX: number;
  localY: number;
  type: number;
  face: number;
}>;
const allocatedHouses = new Array<boolean>(HOUSE_ALLOCATION_COUNT).fill(false);
function allocateHouse(): HouseAllocation {
  const index = allocatedHouses.findIndex((used) => !used);
  if (index < 0) throw new Error("No Construction instance allocation is available.");
  allocatedHouses[index] = true;
  return {
    baseX: 6400 + (index % HOUSE_ALLOCATION_COLUMNS) * HOUSE_STRIDE,
    baseY: 6400 + Math.floor(index / HOUSE_ALLOCATION_COLUMNS) * HOUSE_STRIDE,
  };
}

function releaseHouse(allocation: HouseAllocation): void {
  const x = Math.trunc((allocation.baseX - 6400) / HOUSE_STRIDE);
  const y = Math.trunc((allocation.baseY - 6400) / HOUSE_STRIDE);
  const index = y * HOUSE_ALLOCATION_COLUMNS + x;
  if (index >= 0 && index < allocatedHouses.length) allocatedHouses[index] = false;
}

export function createDefaultHouseSave(): PlayerHouseSave {
  const rooms = Array.from({ length: 3 }, () =>
    Array.from({ length: 8 }, () => Array<SavedHouseRoom | null>(8).fill(null)),
  );
  rooms[1][4][4] = { roomKey: "GARDEN", rotation: 0, furniture: { CENTERPIECE: "EXIT_PORTAL" } };
  rooms[1][4][5] = { roomKey: "PARLOUR", rotation: 0, furniture: {} };
  return { rooms };
}

/** Minimal 4x4 grass test map with one Parlour, used by ::myhouse. */
export function createTestHouseSave(): PlayerHouseSave {
  const rooms = Array.from({ length: 3 }, () =>
    Array.from({ length: 8 }, () => Array<SavedHouseRoom | null>(8).fill(null)),
  );
  rooms[1][1][1] = { roomKey: "PARLOUR", rotation: 0, furniture: {} };
  return { rooms };
}

export class PlayerHouseInstance extends PrivateArea {
  private static templateObjects?: readonly TemplateObject[];
  private readonly roomDoors: GameObject[] = [];
  private readonly furnitureObjects: GameObject[] = [];
  private readonly doorTargets = new Map<string, HouseRoomPosition>();
  public readonly allocation: HouseAllocation;

  /** Test-house allocations are process-local and must never be restored as normal map tiles. */
  public static isAllocationLocation(location: Location): boolean {
    const maximum = 6400 + HOUSE_ALLOCATION_COLUMNS * HOUSE_STRIDE;
    return location.getX() >= 6400 && location.getX() < maximum
      && location.getY() >= 6400 && location.getY() < maximum;
  }

  constructor(public readonly save: PlayerHouseSave, private readonly gridSize = 8) {
    const allocation = allocateHouse();
    super(Array.from({ length: 4 }, (_, plane) => new Boundary(
      allocation.baseX,
      allocation.baseX + HOUSE_SIZE - 1,
      allocation.baseY,
      allocation.baseY + HOUSE_SIZE - 1,
      plane,
    )));
    this.allocation = allocation;
    // Older saves used a fabricated shape 10 / face 0 for every hotspot.
    // Re-key them with the template placement so existing furniture is repaired too.
    for (const plane of save.rooms) {
      for (const column of plane) {
        for (let y = 0; y < column.length; y++) {
          const room = column[y];
          if (!room?.furnitureByLocation) continue;
          const furnitureByLocation: Record<string, SavedHouseFurniture> = {};
          for (const saved of Object.values(room.furnitureByLocation)) {
            const template = this.getTemplateHotspot(room.roomKey, saved.sourceObjectId, saved.localX, saved.localY);
            const furniture = template ? { ...saved, type: template.type, face: template.face } : saved;
            furnitureByLocation[this.furnitureKey(furniture.localX, furniture.localY, furniture.type)] = furniture;
          }
          column[y] = { ...room, furnitureByLocation };
        }
      }
    }
  }

  public buildPalette(buildingMode: boolean): number[][][] {
    const palette = emptyHousePalette();
    const gridOffset = Math.floor((HOUSE_SCENE_CHUNKS - this.gridSize) / 2);
    for (let plane = 0; plane < HOUSE_PLANES; plane++) {
      for (let x = 0; x < 8; x++) {
        for (let y = 0; y < 8; y++) {
          const room = plane < this.save.rooms.length ? this.save.rooms[plane]?.[x]?.[y] : null;
          const withinGrid = x < this.gridSize && y < this.gridSize;
          const template = room
            ? ROOM_BY_KEY.get(room.roomKey)
            : !withinGrid
              ? null
              : plane === 0
              ? HOUSE_TEMPLATE_CHUNKS.basementFloor
              : plane === 1
                ? HOUSE_TEMPLATE_CHUNKS.groundFloor
                : buildingMode
                  ? HOUSE_TEMPLATE_CHUNKS.blank
                  : null;
          if (room && !template) {
            throw new Error(`Unknown Construction room template: ${room.roomKey}`);
          }
          if (!template) continue;
          palette[plane][x + gridOffset][y + gridOffset] = packTemplateChunk({
            sourceChunkX: template.sourceChunkX,
            sourceChunkY: template.sourceChunkY,
            sourcePlane: 0,
            rotation: room?.rotation ?? 0,
          });
        }
      }
    }
    return palette;
  }

  public getRoom(position: HouseRoomPosition): SavedHouseRoom | null {
    return this.isRoomPosition(position) ? this.save.rooms[position.plane][position.x][position.y] : null;
  }

  public getDoorTarget(location: { x: number; y: number; z: number }): HouseRoomPosition | null {
    return this.doorTargets.get(`${location.x}:${location.y}:${location.z}`) ?? null;
  }

  public getFurnitureTarget(
    location: { x: number; y: number; z: number },
    sourceObjectId: number,
  ): HouseFurnitureTarget | null {
    const hotspot = HOTSPOT_BY_OBJECT_ID.get(sourceObjectId);
    const position = this.getRoomPositionAt(location);
    const room = position ? this.getRoom(position) : null;
    const template = room ? ROOM_BY_KEY.get(room.roomKey) : null;
    if (!hotspot || !position || !room || !template || !template.hotspots.includes(hotspot.key)) return null;

    const local = this.getTemplateLocal(location, room.rotation);
    const placement = this.getTemplateHotspot(room.roomKey, sourceObjectId, local.x, local.y);
    if (!placement) return null;
    return {
      position,
      hotspotKey: hotspot.key,
      sourceObjectId,
      localX: local.x,
      localY: local.y,
      type: placement.type,
      face: placement.face,
    };
  }

  public getFurnitureAt(location: { x: number; y: number; z: number }, objectId: number, type: number): SavedHouseFurniture | null {
    const position = this.getRoomPositionAt(location);
    const room = position ? this.getRoom(position) : null;
    if (!position || !room) return null;
    const local = this.getTemplateLocal(location, room.rotation);
    const furniture = room.furnitureByLocation?.[this.furnitureKey(local.x, local.y, type)];
    if (!furniture) return null;
    const buildable = BUILDABLE_BY_KEY.get(furniture.buildableKey);
    return buildable && buildable.objectIds.includes(objectId) ? furniture : null;
  }

  public getFurnitureAtTarget(target: HouseFurnitureTarget): SavedHouseFurniture | null {
    const room = this.getRoom(target.position);
    return room?.furnitureByLocation?.[this.furnitureKey(target.localX, target.localY, target.type)] ?? null;
  }

  public setFurniture(target: HouseFurnitureTarget, buildable: ConstructionBuildable): void {
    const room = this.getRoom(target.position);
    if (!room) return;
    const key = this.furnitureKey(target.localX, target.localY, target.type);
    const furniture: SavedHouseFurniture = {
      buildableKey: buildable.key,
      hotspotKey: target.hotspotKey,
      sourceObjectId: target.sourceObjectId,
      localX: target.localX,
      localY: target.localY,
      type: target.type,
      face: target.face,
    };
    this.save.rooms[target.position.plane][target.position.x][target.position.y] = {
      ...room,
      furniture: { ...room.furniture, [target.hotspotKey]: buildable.key },
      furnitureByLocation: { ...room.furnitureByLocation, [key]: furniture },
    };
  }

  public canRemoveFurniture(location: { x: number; y: number; z: number }, objectId: number, type: number): string | null {
    const furniture = this.getFurnitureAt(location, objectId, type);
    if (!furniture) return "There is no constructed furniture there.";
    if (furniture.buildableKey === "EXIT_PORTAL" && this.getExitPortalCount() === 1) {
      return "Your house must have at least one exit portal.";
    }
    return null;
  }

  public removeFurniture(location: { x: number; y: number; z: number }, objectId: number, type: number): SavedHouseFurniture | null {
    const position = this.getRoomPositionAt(location);
    const room = position ? this.getRoom(position) : null;
    const furniture = this.getFurnitureAt(location, objectId, type);
    if (!position || !room || !furniture) return null;
    const local = this.getTemplateLocal(location, room.rotation);
    const remaining = { ...room.furnitureByLocation };
    delete remaining[this.furnitureKey(local.x, local.y, type)];
    const legacyFurniture = { ...room.furniture };
    if (!Object.values(remaining).some((entry) => entry.hotspotKey === furniture.hotspotKey && entry.buildableKey === furniture.buildableKey)) {
      delete legacyFurniture[furniture.hotspotKey];
    }
    this.save.rooms[position.plane][position.x][position.y] = {
      ...room,
      furniture: legacyFurniture,
      furnitureByLocation: remaining,
    };
    return furniture;
  }

  public override resolveObject(id: number, location: Location): GameObject | null {
    if (id >= ROOM_DOOR_HOTSPOT_MIN && id <= ROOM_DOOR_HOTSPOT_MAX) {
      const target = this.getDoorTarget({ x: location.getX(), y: location.getY(), z: location.getZ() }) ?? this.getDoorTargetAtLocation(location);
      if (!target) return null;
      this.doorTargets.set(`${location.getX()}:${location.getY()}:${location.getZ()}`, target);
      const door = new GameObject(id, location.clone(), 0, 0, this);
      this.roomDoors.push(door);
      return door;
    }

    // Dynamic-template hotspots exist only in the client's scene, so expose a
    // temporary server object after confirming that it belongs to this room.
    const target = this.getFurnitureTarget({ x: location.getX(), y: location.getY(), z: location.getZ() }, id);
    if (!target || this.getFurnitureAtTarget(target)) return null;
    const rotation = this.getRoom(target.position)!.rotation;
    const hotspot = new GameObject(id, location.clone(), target.type, (target.face + rotation) & 3, this);
    this.detach(hotspot);
    return hotspot;
  }

  public canPlaceRoom(room: ConstructionRoom, position: HouseRoomPosition, constructionLevel: number): string | null {
    if (!this.isRoomPosition(position)) return "That room location is outside your house.";
    if (this.getRoom(position)) return "There is already a room there.";
    if (constructionLevel < room.level) return `You need Construction level ${room.level} to build a ${room.name}.`;
    if (this.getRoomCount() >= this.getMaxRooms(constructionLevel)) return "You already have the maximum number of rooms for your Construction level.";
    if (room.basement && position.plane !== 0) return "This room can only be created in the basement.";
    if (room.outdoors && position.plane !== 1) return "You can only add that room on surface level.";
    if (position.plane > 1) {
      const below = this.getRoom({ ...position, plane: position.plane - 1 });
      if (!below || ROOM_BY_KEY.get(below.roomKey)?.outdoors) return "You can't add a room with nothing below to support it.";
    }
    if (room.key === "COSTUME_ROOM" && this.hasRoom("COSTUME_ROOM")) return "You may only have one costume room.";
    if ((room.key === "MENAGERIE_INDOORS" || room.key === "MENAGERIE_OUTDOORS") && (this.hasRoom("MENAGERIE_INDOORS") || this.hasRoom("MENAGERIE_OUTDOORS"))) {
      return "You may only have one menagerie.";
    }
    return null;
  }

  public placeRoom(position: HouseRoomPosition, room: ConstructionRoom, rotation = 0): void {
    this.save.rooms[position.plane][position.x][position.y] = { roomKey: room.key, rotation: rotation & 3, furniture: {} };
  }

  public rotateRoom(position: HouseRoomPosition): SavedHouseRoom | null {
    const room = this.getRoom(position);
    if (!room) return null;
    const rotated = { ...room, rotation: (room.rotation + 1) & 3 };
    this.save.rooms[position.plane][position.x][position.y] = rotated;
    return rotated;
  }

  public canRemoveRoom(position: HouseRoomPosition): string | null {
    const room = this.getRoom(position);
    if (!room) return "There is no room there.";
    if (position.plane === 1 && this.getRoom({ ...position, plane: 2 })) return "You can't remove that room because it supports a room above it.";
    if ((room.roomKey === "GARDEN" || room.roomKey === "FORMAL_GARDEN") && this.hasExitPortal(room) && this.getExitPortalCount() === 1) {
      return "Your house must have at least one exit portal.";
    }
    return null;
  }

  public removeRoom(position: HouseRoomPosition): void {
    if (this.isRoomPosition(position)) this.save.rooms[position.plane][position.x][position.y] = null;
  }

  /** Moves a player into this allocation and immediately streams its dynamic scene. */
  public enterHouse(player: Player, buildingMode: boolean): boolean {
    PlayerHouseInstance.getTemplateObjects();
    const previousArea = player.getArea();
    if (previousArea && previousArea !== this) previousArea.leave(player, false);
    this.enter(player);
    player.setLocation(this.getEntryLocation());
    return this.rebuild(player, buildingMode);
  }

  /** Replays the current saved layout after a room edit. */
  public rebuild(player: Player, buildingMode: boolean): boolean {
    this.clearFurniture();
    player.getPacketSender().sendVarbit(HOUSE_BUILDING_MODE_VARBIT, buildingMode ? 1 : 0);
    const center = this.getSceneCenter();
    const palette = this.buildPalette(buildingMode);
    const seenRegions = new Set<number>();
    const xteas: number[][] = [];
    for (const plane of palette) {
      for (const column of plane) {
        for (const chunk of column) {
          if (chunk === -1) continue;
          const sourceX = (chunk >>> 14) & 0x3ff;
          const sourceY = (chunk >>> 3) & 0x7ff;
          const regionId = ((sourceX >> 3) << 8) | (sourceY >> 3);
          if (!seenRegions.has(regionId)) {
            seenRegions.add(regionId);
            xteas.push(CachePipeline.getXtea(regionId));
          }
        }
      }
    }
    const sent = player.getSession().sendClientPacket(encodeRebuildRegion(center.x, center.y, true, palette, xteas));
    this.refreshHotspots(player, buildingMode);
    this.refreshFurniture(player);
    return sent;
  }

  /** Leaving clears the private area; PlayerSession emits REBUILD_NORMAL next tick. */
  public exitHouse(player: Player, destination: Location): void {
    this.leave(player, false);
    player.setLocation(destination);
  }

  public destroy(): void {
    if (this.isDestroyed()) return;
    releaseHouse(this.allocation);
    super.destroy();
  }

  public getSceneCenter(): Readonly<{ x: number; y: number }> {
    return { x: (this.allocation.baseX + 52) >> 3, y: (this.allocation.baseY + 52) >> 3 };
  }

  private getEntryLocation(): Location {
    const gridOffset = Math.floor((HOUSE_SCENE_CHUNKS - this.gridSize) / 2);
    for (let x = 0; x < this.gridSize; x++) {
      for (let y = 0; y < this.gridSize; y++) {
        const room = this.save.rooms[1][x][y];
        if (!room || !this.hasExitPortal(room)) continue;
        const savedExit = Object.values(room.furnitureByLocation ?? {}).find((furniture) => furniture.buildableKey === "EXIT_PORTAL");
        const local = rotateHotspot(savedExit?.localX ?? 3, savedExit?.localY ?? 2, room.rotation);
        return new Location(this.allocation.baseX + (gridOffset + x) * 8 + local.x, this.allocation.baseY + (gridOffset + y) * 8 + local.y, 1);
      }
    }
    return new Location(this.allocation.baseX + 52, this.allocation.baseY + 52, 1);
  }

  private refreshHotspots(player: Player, buildingMode: boolean): void {
    for (const door of this.roomDoors.splice(0)) {
      this.detach(door);
    }
    this.doorTargets.clear();

    const gridOffset = Math.floor((HOUSE_SCENE_CHUNKS - this.gridSize) / 2);
    for (let plane = 0; plane < 3; plane++) {
      for (let x = 0; x < this.gridSize; x++) {
        for (let y = 0; y < this.gridSize; y++) {
          const room = this.save.rooms[plane][x][y];
          const template = room ? ROOM_BY_KEY.get(room.roomKey) : null;
          if (!room || !template) continue;
          for (const hotspot of PlayerHouseInstance.getTemplateObjects()) {
            if (hotspot.sourceChunkX !== template.sourceChunkX || hotspot.sourceChunkY !== template.sourceChunkY) continue;
            const definition = CacheDefinitions.getObject(hotspot.id);
            const width = (hotspot.face & 1) ? definition.sizeY : definition.sizeX;
            const height = (hotspot.face & 1) ? definition.sizeX : definition.sizeY;
            const origin = rotateHotspot(hotspot.localX, hotspot.localY, room.rotation);
            const opposite = rotateHotspot(hotspot.localX + width - 1, hotspot.localY + height - 1, room.rotation);
            // The client anchors rotated objects at the minimum corner of their footprint.
            const local = { x: Math.min(origin.x, opposite.x), y: Math.min(origin.y, opposite.y) };
            const worldX = this.allocation.baseX + (gridOffset + x) * 8 + local.x;
            const worldY = this.allocation.baseY + (gridOffset + y) * 8 + local.y;
            if (!buildingMode) {
              // Templates contain ghosts even when the building-mode varbit is off.
              // Remove them before replaying built furniture at the same tiles.
              player.getSession().sendClientPacket(encodeLocDel(worldX, worldY, plane, hotspot.type, (hotspot.face + room.rotation) & 3));
              continue;
            }
            if (hotspot.id < ROOM_DOOR_HOTSPOT_MIN || hotspot.id > ROOM_DOOR_HOTSPOT_MAX) continue;
            const target = this.getDoorTargetFromEdge(x, y, plane, local.x, local.y);
            if (!target) continue;
            const location = new Location(
              worldX,
              worldY,
              plane,
            );
            this.doorTargets.set(`${location.getX()}:${location.getY()}:${location.getZ()}`, target);
            this.roomDoors.push(new GameObject(hotspot.id, location, hotspot.type, (hotspot.face + room.rotation) & 3, this));
          }
        }
      }
    }
  }

  private refreshFurniture(player: Player): void {
    const gridOffset = Math.floor((HOUSE_SCENE_CHUNKS - this.gridSize) / 2);
    for (let plane = 0; plane < 3; plane++) {
      for (let x = 0; x < this.gridSize; x++) {
        for (let y = 0; y < this.gridSize; y++) {
          const room = this.save.rooms[plane][x][y];
          if (!room) continue;
          for (const furniture of Object.values(room.furnitureByLocation ?? {})) {
            const buildable = BUILDABLE_BY_KEY.get(furniture.buildableKey);
            if (!buildable) continue;
            const hotspot = HOTSPOT_BY_OBJECT_ID.get(furniture.sourceObjectId);
            const variant = hotspot ? hotspot.objectIds.indexOf(furniture.sourceObjectId) : -1;
            const objectId = buildable.objectIds[variant] ?? buildable.objectIds.find((id) => id >= 0) ?? -1;
            if (objectId < 0) continue;
            const local = rotateHotspot(furniture.localX, furniture.localY, room.rotation);
            const object = new GameObject(
              objectId,
              new Location(this.allocation.baseX + (gridOffset + x) * 8 + local.x, this.allocation.baseY + (gridOffset + y) * 8 + local.y, plane),
              furniture.type,
              (furniture.face + room.rotation) & 3,
              this,
            );
            this.furnitureObjects.push(object);
            player.getPacketSender().sendObject(object);
          }
        }
      }
    }
  }

  private clearFurniture(): void {
    for (const object of this.furnitureObjects.splice(0)) this.detach(object);
  }

  private isRoomPosition(position: HouseRoomPosition): boolean {
    return position.plane >= 0 && position.plane < 3
      && position.x >= 0 && position.x < this.gridSize
      && position.y >= 0 && position.y < this.gridSize;
  }

  private getRoomCount(): number {
    return this.save.rooms.flat(2).filter((room) => room != null).length;
  }

  private getMaxRooms(level: number): number {
    if (level === 99) return 33;
    if (level >= 96) return 32;
    return level >= 50 ? 24 + Math.floor((level - 50) / 6) : 23;
  }

  private hasRoom(key: string): boolean {
    return this.save.rooms.flat(2).some((room) => room?.roomKey === key);
  }

  private hasExitPortal(room: SavedHouseRoom): boolean {
    return room.furniture.CENTERPIECE === "EXIT_PORTAL"
      || room.furniture.FORMAL_GARDEN_CENTERPIECE === "EXIT_PORTAL"
      || Object.values(room.furnitureByLocation ?? {}).some((furniture) => furniture.buildableKey === "EXIT_PORTAL");
  }

  private getExitPortalCount(): number {
    return this.save.rooms.flat(2).filter((room): room is SavedHouseRoom => room != null).filter((room) => this.hasExitPortal(room)).length;
  }

  private getDoorTargetFromEdge(x: number, y: number, plane: number, localX: number, localY: number): HouseRoomPosition | null {
    const target = localX === 0 ? { x: x - 1, y, plane }
      : localX === 7 ? { x: x + 1, y, plane }
        : localY === 0 ? { x, y: y - 1, plane }
          : localY === 7 ? { x, y: y + 1, plane }
            : null;
    return target && this.isRoomPosition(target) ? target : null;
  }

  private getDoorTargetAtLocation(location: Location): HouseRoomPosition | null {
    const relativeX = location.getX() - this.allocation.baseX;
    const relativeY = location.getY() - this.allocation.baseY;
    const gridOffset = Math.floor((HOUSE_SCENE_CHUNKS - this.gridSize) / 2);
    const x = Math.floor(relativeX / 8) - gridOffset;
    const y = Math.floor(relativeY / 8) - gridOffset;
    const plane = location.getZ();
    const room = this.getRoom({ x, y, plane });
    if (!room) return null;
    return this.getDoorTargetFromEdge(x, y, plane, relativeX & 7, relativeY & 7);
  }

  public getRoomPositionAt(location: { x: number; y: number; z: number }): HouseRoomPosition | null {
    const gridOffset = Math.floor((HOUSE_SCENE_CHUNKS - this.gridSize) / 2);
    const position = {
      x: Math.floor((location.x - this.allocation.baseX) / 8) - gridOffset,
      y: Math.floor((location.y - this.allocation.baseY) / 8) - gridOffset,
      plane: location.z,
    };
    return this.isRoomPosition(position) ? position : null;
  }

  private getTemplateLocal(location: { x: number; y: number }, rotation: number): Readonly<{ x: number; y: number }> {
    return rotateHotspot((location.x - this.allocation.baseX) & 7, (location.y - this.allocation.baseY) & 7, (4 - rotation) & 3);
  }

  private furnitureKey(localX: number, localY: number, type: number): string {
    return `${localX}:${localY}:${type}`;
  }

  private getTemplateHotspot(roomKey: string, id: number, localX: number, localY: number): TemplateObject | undefined {
    const room = ROOM_BY_KEY.get(roomKey);
    return room && PlayerHouseInstance.getTemplateObjects().find((object) =>
      object.id === id && object.localX === localX && object.localY === localY
      && object.sourceChunkX === room.sourceChunkX && object.sourceChunkY === room.sourceChunkY);
  }

  private static getTemplateObjects(): readonly TemplateObject[] {
    if (this.templateObjects) return this.templateObjects;
    const objects: TemplateObject[] = [];
    const regions = new Set([...CONSTRUCTION_ROOMS, ...Object.values(HOUSE_TEMPLATE_CHUNKS)]
      .map(({ sourceChunkX, sourceChunkY }) => ((sourceChunkX >> 3) << 8) | (sourceChunkY >> 3)));
    for (const regionId of regions) {
      const data = CacheMaps.getRegion(regionId)?.objectData;
      if (!data) throw new Error(`Construction template region ${regionId} is missing from the active cache.`);
      const buffer = new ByteBuffer(data);
      let objectId = -1;
      while (buffer.offset < data.length) {
        const objectDelta = buffer.readSmart3();
        if (objectDelta === 0) break;
        objectId += objectDelta;
        let packedLocation = 0;
        while (true) {
          const locationDelta = buffer.readUnsignedSmart();
          if (locationDelta === 0) break;
          packedLocation += locationDelta - 1;
          const info = buffer.readUnsignedByte();
          if ((packedLocation >> 12) !== 0) continue;
          if ((objectId < ROOM_DOOR_HOTSPOT_MIN || objectId > ROOM_DOOR_HOTSPOT_MAX)
            && !HOTSPOT_BY_OBJECT_ID.has(objectId)
            && !CacheDefinitions.getObject(objectId).actions?.includes("Build")) continue;
          const localX = (packedLocation >> 6) & 0x3f;
          const localY = packedLocation & 0x3f;
          objects.push({
            id: objectId,
            sourceChunkX: (regionId >> 8) * 8 + (localX >> 3),
            sourceChunkY: (regionId & 0xff) * 8 + (localY >> 3),
            localX: localX & 7,
            localY: localY & 7,
            type: info >> 2,
            face: info & 3,
          });
        }
      }
    }
    this.templateObjects = objects;
    return objects;
  }
}
