// Run after `yarn build`: node --test tests/world-map-position.test.cjs
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { Location } = require('../dist/game/model/Location');
const { packWorldMapCoord } = require('../dist/net/protocol/WorldMapProtocol');
const WorldMapPosition = require('../plugins/interface/WorldMapPosition.plugin');

/** A player whose map was opened at `open` (sending that position, as toggleWorldMap does). */
function player(open) {
    const sent = [];
    let location = open;
    let mapOpen = true;
    let position = packWorldMapCoord(open.getX(), open.getY(), open.getZ());
    const packetSender = {
        isWorldMapOpen: () => mapOpen,
        getWorldMapPosition: () => position,
        sendWorldMapPosition: (at) => {
            position = packWorldMapCoord(at.getX(), at.getY(), at.getZ());
            sent.push(`${at.getX() % 64},${at.getY() % 64}`);
        },
    };
    const entity = { getPacketSender: () => packetSender, getLocation: () => location };
    return {
        sent,
        /** One tick: the player ends it on `at` (movement runs before the plugin hook). */
        tick(at = location) {
            location = at;
            WorldMapPosition._test.updateWorldMapPosition({ player: entity });
        },
        close() { mapOpen = false; },
    };
}

const tile = (x, y) => new Location(50 * 64 + x, 50 * 64 + y, 0);

test('as captured in OSRS: every 3 ticks, the start-of-tick position, only when it changed', () => {
    // Capture ticks 15787 (map opened at 23,21) to 15799: where the player ended each tick.
    const ends = [[23, 21], [23, 21], [23, 21], [25, 21], [27, 20], [29, 19], [31, 19],
        [33, 19], [35, 20], [37, 22], [39, 24], [40, 25], [42, 25]];
    const map = player(tile(23, 21));
    const sentAt = [];
    ends.forEach(([x, y], index) => {
        const before = map.sent.length;
        map.tick(tile(x, y));
        if (map.sent.length > before) sentAt.push(15787 + index);
    });
    // 15790 sends nothing: the player had not moved yet at the start of that tick.
    assert.deepEqual(sentAt, [15793, 15796, 15799]);
    assert.deepEqual(map.sent, ['29,19', '35,20', '40,25']);
});

test('standing still sends nothing; closing the map stops the updates and resets the count', () => {
    const map = player(tile(10, 10));
    for (let i = 0; i < 9; i++) map.tick();
    assert.deepEqual(map.sent, []);
    map.close();
    map.tick(tile(12, 10));
    map.tick(tile(14, 10));
    map.tick(tile(16, 10));
    assert.deepEqual(map.sent, [], 'no updates while closed');
});
