import { ItemOnGroundManager } from "../../../game/entity/impl/grounditem/ItemOnGroundManager";
import { Location } from "../../../game/model/Location";

export class PickupItemPacketListener {
  public static pickup(player: any, itemId: number, x: number, y: number, stackId?: number): void {
    const requestedPosition = new Location(x, y, player.getLocation().getZ());
    const privateArea = player.getPrivateArea();
    if (privateArea) {
      const groundItem = ItemOnGroundManager.getPrivateAreaGroundItem(itemId, requestedPosition, privateArea);
      if (groundItem) {
        // Instance tiles need no route through the global collision map.
        player.getMovementQueue().reset();
        player.getMovementQueue().walkToReset();
        ItemOnGroundManager.pickup(player, groundItem);
      }
      return;
    }

    const groundItem = stackId == null
      ? ItemOnGroundManager.getGroundItem(player.getUsername(), itemId, requestedPosition, privateArea)
      : ItemOnGroundManager.getGroundItemById(stackId, player);
    if (!groundItem || groundItem.getItem().getId() !== itemId || !Location.isSameTile(groundItem.getPosition(), requestedPosition)) {
      return;
    }

    if (player.busy() || !player.getLastItemPickup().elapsedTime(300)) {
      return;
    }

    const position = groundItem.getPosition().clone();

    player
      .getMovementQueue()
      .walkToGroundItem(position, () => ItemOnGroundManager.pickup(player, groundItem));
  }

}
