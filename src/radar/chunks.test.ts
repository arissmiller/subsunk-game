import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("pixi.js", () => ({ Container: class { destroy() {} } }));
import { World } from "../engine/world";
import { worldDistance } from "../engine/navigation";
import { createEnemySubmarine, createEnemySubmarineBehaviorSystem } from "../enemies/submarine";
import type { RadarEntity, SonarState } from "../radarTypes";
import { chunkAt, createChunkSystem, surroundingChunks } from "./chunks";
import { CHUNK_SIZE, CHUNK_MINE_SPACING, CHUNK_PLAYER_SAFE_RADIUS, CONTACT_VISIBLE_RADIUS, ENEMY_RESPAWN_INTERVAL_MS } from "./config";
import { createPlayerEntity } from "./entities/player";
import { isEnemyEntity, isMineEntity } from "./entities/shared";
import { createTorpedo } from "./entities/torpedoes";

function setup() {
  let seed = 12345;
  vi.spyOn(Math, "random").mockImplementation(() => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  });
  let now = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  const world = new World();
  const player = world.addEntity(createPlayerEntity());
  const sonar: SonarState = { pulses: [], echoes: [], coverage: new Map(), playerLastEmittedAtMs: null };
  const system = createChunkSystem(sonar);
  system.attach!(world);
  const update = (time = now) => { now = time; system.update!(world, 16); };
  const entities = () => world.getEntities() as RadarEntity[];
  return { world, player, sonar, update, entities };
}
afterEach(() => vi.restoreAllMocks());

describe("chunk generation", () => {
  it("uses floor coordinates and a centered 25-chunk square", () => {
    expect(chunkAt({ x: -1, y: CHUNK_SIZE })).toEqual({ x: -1, y: 1 });
    const chunks = surroundingChunks({ x: -1, y: CHUNK_SIZE });
    expect(chunks).toHaveLength(25);
    expect(chunks[0]).toEqual({ x: -3, y: -1 });
    expect(chunks[24]).toEqual({ x: 1, y: 3 });
  });

  it("generates spaced mines in all chunks, safe spawns, and at most three enemies", () => {
    const { world, player, entities, update } = setup();
    const mines = entities().filter(isMineEntity);
    const counts = new Map<string, number>();
    for (const mine of mines) {
      const key = JSON.stringify(chunkAt(mine.components.position));
      counts.set(key, (counts.get(key) ?? 0) + 1);
      expect(worldDistance(mine.components.position, player.components.navigation.position)).toBeGreaterThanOrEqual(CHUNK_PLAYER_SAFE_RADIUS);
      for (const other of mines) {
        if (other.id !== mine.id) expect(worldDistance(mine.components.position, other.components.position)).toBeGreaterThanOrEqual(CHUNK_MINE_SPACING);
      }
    }
    expect(counts.size).toBe(25);
    for (const count of counts.values()) { expect(count).toBeGreaterThanOrEqual(3); expect(count).toBeLessThanOrEqual(6); }
    expect(entities().filter(isEnemyEntity).length).toBeLessThanOrEqual(3);
    for (const enemy of entities().filter(isEnemyEntity)) expect(worldDistance(enemy.components.navigation.position, player.components.navigation.position)).toBeGreaterThan(CONTACT_VISIBLE_RADIUS);
    const ids = entities().map((entity) => entity.id);
    mines[0].components.status.state = "destroyed";
    world.resize(400);
    update();
    expect(entities().map((entity) => entity.id)).toEqual(ids);
    expect(mines[0].components.status.state).toBe("destroyed");
  });

  it.each([{ x: CHUNK_SIZE, y: 0 }, { x: -1, y: -1 }, { x: CHUNK_SIZE * 10, y: CHUNK_SIZE * 10 }])("retains overlaps and regenerates only new chunks at $x,$y", (position) => {
    const { player, entities, update } = setup();
    const before = entities().filter(isMineEntity);
    player.components.navigation.position = position;
    update();
    const allowed = new Set(surroundingChunks(position).map((chunk) => JSON.stringify(chunk)));
    const after = entities().filter(isMineEntity);
    expect(new Set(after.map((mine) => JSON.stringify(chunkAt(mine.components.position)))).size).toBe(25);
    for (const mine of before) expect(after.some((other) => other.id === mine.id)).toBe(allowed.has(JSON.stringify(chunkAt(mine.components.position))));
    player.components.navigation.position = { x: 0, y: 0 };
    update();
    for (const mine of before) {
      if (!allowed.has(JSON.stringify(chunkAt(mine.components.position)))) expect(entities().some((other) => other.id === mine.id)).toBe(false);
    }
  });

  it("cleans up by current position and removes sonar references", () => {
    const { world, player, sonar, update } = setup();
    const kept = world.addEntity(createEnemySubmarine(world, "kept", { x: -3900, y: 0 }));
    kept.components.navigation.position = { x: 1000, y: 0 };
    const removed = world.addEntity(createEnemySubmarine(world, "removed", { x: -3900, y: 0 }));
    const shot = world.addEntity(createTorpedo("enemy", removed.id, removed.components.navigation, 0));
    sonar.pulses.push({ sourceId: removed.id, owner: "enemy", origin: { x: 0, y: 0 }, emittedAtMs: 0, illuminatedContactIds: new Set() });
    sonar.echoes.push({ sourceId: player.id, contactId: removed.id, contactKind: "enemy-sub", contactPosition: { x: 0, y: 0 }, contactHeadingDeg: 0, contactVelocity: null, observedAtMs: 0, returnAtMs: 100 });
    player.components.navigation.position.x = CHUNK_SIZE;
    update();
    expect(world.getEntity(kept.id)).toBeDefined();
    expect(world.getEntity(removed.id)).toBeUndefined();
    expect(world.getEntity(shot.id)).toBeUndefined();
    expect(sonar.pulses).toHaveLength(0);
    expect(sonar.echoes).toHaveLength(0);
  });

  it("reinforces one at a time, shares the cap, and does not reset the timer on crossing", () => {
    const { world, player, entities, update } = setup();
    for (const enemy of entities().filter(isEnemyEntity)) world.removeEntity(enemy.id);
    update(ENEMY_RESPAWN_INTERVAL_MS - 1);
    expect(entities().filter(isEnemyEntity)).toHaveLength(0);
    update(ENEMY_RESPAWN_INTERVAL_MS);
    expect(entities().filter(isEnemyEntity)).toHaveLength(1);
    player.components.navigation.position.x = CHUNK_SIZE;
    update(ENEMY_RESPAWN_INTERVAL_MS + 1);
    for (const enemy of entities().filter(isEnemyEntity)) world.removeEntity(enemy.id);
    update(ENEMY_RESPAWN_INTERVAL_MS * 2);
    expect(entities().filter(isEnemyEntity)).toHaveLength(1);
    for (let tick = 3; tick <= 7; tick += 1) update(ENEMY_RESPAWN_INTERVAL_MS * tick);
    expect(entities().filter(isEnemyEntity)).toHaveLength(3);
  });

  it("cruises toward the initial player position without firing before sonar contact", () => {
    const { world, player } = setup();
    const enemy = world.addEntity(createEnemySubmarine(world, "cruiser", { x: 3000, y: 0 }));
    player.components.navigation.position = { x: 3000, y: 3000 };
    createEnemySubmarineBehaviorSystem().update!(world, 1000);
    expect(enemy.components.navigation.position.x).toBeLessThan(3000);
    expect(enemy.components.navigation.position.y).toBeCloseTo(0);
    expect(enemy.components.torpedoBay.count).toBe(6);
    expect(enemy.components.sonar.targetTrack).toBeNull();
  });
});
