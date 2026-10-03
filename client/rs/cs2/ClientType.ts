import { isTouchDevice } from "../../common/utils/DeviceUtil";

/**
 * The client type cache scripts see (the clienttype opcode): 2 (android) on the mobile layout
 * or a touch device, otherwise 10, the enhanced (Steam C++) client.
 */
export const CLIENT_TYPE_ENHANCED = 10;
export const CLIENT_TYPE_ANDROID = 2;
export const MOBILE_ROOT_INTERFACE = 601;

export function reportedClientType(rootInterface: number | undefined): number {
    return rootInterface === MOBILE_ROOT_INTERFACE || isTouchDevice ? CLIENT_TYPE_ANDROID : CLIENT_TYPE_ENHANCED;
}
