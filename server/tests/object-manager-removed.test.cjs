// Run after `yarn build`: node --test tests/object-manager-removed.test.cjs
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const path = require('node:path');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { RegionManager } = require('../dist/game/collision/RegionManager');
const { MapObjects } = require('../dist/game/entity/impl/object/MapObjects');
const { ObjectManager } = require('../dist/game/entity/impl/object/ObjectManager');
const { GameObject } = require('../dist/game/entity/impl/object/GameObject');
const { Location } = require('../dist/game/model/Location');
const { World } = require('../dist/game/World');

before(async () => {
    await CachePipeline.initialize(path.resolve(__dirname, '..'));
    RegionManager.init();
});

const removed = () => World.getRemovedObjects();

test('a removed map object is remembered (hidden on scene reloads); a runtime fire is not', () => {
    RegionManager.loadMapFiles(3204, 3229);
    const stairs = MapObjects.get(56230, new Location(3204, 3229, 0), null);
    assert.ok(stairs?.isBaseMap(), 'map objects are flagged when the region loads');

    const before = removed().length;
    const fire = new GameObject(26185, new Location(3222, 3218, 0), 10, 0, null);
    ObjectManager.register(fire, false);
    ObjectManager.deregister(fire, false);
    assert.equal(removed().length, before, 'an expired fire leaves nothing behind');

    // Doors deregister a copy rebuilt from a snapshot, not the loaded instance.
    const copy = new GameObject(56230, new Location(3204, 3229, 0), stairs.getType(), stairs.getFace(), null);
    ObjectManager.deregister(copy, false);
    assert.equal(removed().length, before + 1, 'a copy of a map object is remembered');

    // Put back in its place, it counts as the map object again.
    const restored = new GameObject(56230, new Location(3204, 3229, 0), stairs.getType(), stairs.getFace(), null);
    ObjectManager.register(restored, false);
    assert.equal(removed().length, before, 'restoring clears the record');
    assert.ok(restored.isBaseMap());
    ObjectManager.deregister(restored, false);
    assert.equal(removed().length, before + 1, 'and removing it again is remembered');
});
