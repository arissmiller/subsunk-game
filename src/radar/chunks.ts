import { createBoat } from "../enemies/boat";
import { gridCellCenter } from "./grid";
import { worldDistance, type WorldPoint } from "../engine/navigation";
import type { System } from "../engine/types";
import type { World } from "../engine/world";
import { createEnemySubmarine } from "../enemies/submarine";
import type { RadarEntity, SonarState } from "../radarTypes";
import {
  BOAT_ACTIVE_MAX, BOAT_SPAWN_CHANCE, BOAT_RESPAWN_INTERVAL_MS,
  CHUNK_SIZE, CHUNK_LOAD_RADIUS, CHUNK_MINE_MIN, CHUNK_MINE_MAX,
  CHUNK_MINE_SPACING, CHUNK_PLAYER_SAFE_RADIUS, CHUNK_ENEMY_CHANCE,
  CONTACT_VISIBLE_RADIUS, ENEMY_ACTIVE_TARGET_MAX, ENEMY_RESPAWN_INTERVAL_MS,
} from "./config";
import { createMine } from "./entities/mines";
import { isEnemyEntity, isBoatEntity, isEnemyVessel, isMineEntity, isPlayerActive, requirePlayer } from "./entities/shared";

export function chunkAt(position: WorldPoint): WorldPoint {
  return { x: Math.floor(position.x / CHUNK_SIZE), y: Math.floor(position.y / CHUNK_SIZE) };
}

function key(chunk: WorldPoint) { return `${chunk.x},${chunk.y}`; }

export function surroundingChunks(position: WorldPoint): WorldPoint[] {
  const center = chunkAt(position);
  const chunks: WorldPoint[] = [];
  for (let y = -CHUNK_LOAD_RADIUS; y <= CHUNK_LOAD_RADIUS; y += 1) {
    for (let x = -CHUNK_LOAD_RADIUS; x <= CHUNK_LOAD_RADIUS; x += 1) {
      chunks.push({ x: center.x + x, y: center.y + y });
    }
  }
  return chunks;
}

export function createChunkSystem(sonar: SonarState): System<World> {
  let loaded = new Set<string>();
  let nextSpawnAtMs: number | null = null;
  let sequence = 0;
  let nextBoatSpawnAtMs: number | null = null;

  function randomPosition(chunk: WorldPoint): WorldPoint {
    return { x: (chunk.x + Math.random()) * CHUNK_SIZE, y: (chunk.y + Math.random()) * CHUNK_SIZE };
  }

  function spawnEnemy(world: World, chunk: WorldPoint, boat = false) {
    const entities = world.getEntities() as RadarEntity[];
    const active = entities.filter(isEnemyVessel).filter((enemy) => enemy.components.status.state === "active" && (boat ? isBoatEntity(enemy) : isEnemyEntity(enemy))).length;
    if (active >= (boat ? BOAT_ACTIVE_MAX : ENEMY_ACTIVE_TARGET_MAX)) return;
    const playerPosition = requirePlayer(world).components.navigation.position;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const position = randomPosition(chunk);
      if (worldDistance(position, playerPosition) <= CONTACT_VISIBLE_RADIUS + 100) continue;
      if (entities.some((entity) => {
        if (isMineEntity(entity)) return worldDistance(position, entity.components.position) < CHUNK_MINE_SPACING;
        if (isEnemyVessel(entity)) return worldDistance(position, entity.components.navigation.position) < CHUNK_MINE_SPACING;
        return false;
      })) continue;
      if (boat) world.addEntity(createBoat(world, `chunk-boat-${sequence++}`, position));
      else world.addEntity(createEnemySubmarine(world, `chunk-sub-${sequence++}`, position));
      return true;
    }
  }

  function generate(world: World, chunk: WorldPoint) {
    const positions = (world.getEntities() as RadarEntity[]).filter(isMineEntity).map((mine) => mine.components.position);
    const count = CHUNK_MINE_MIN + Math.floor(Math.random() * (CHUNK_MINE_MAX - CHUNK_MINE_MIN + 1));
    let placed = 0;
    // Bounded retries avoid blocking a frame if a random sample repeatedly overlaps.
    for (let attempt = 0; attempt < count * 40 && placed < count; attempt += 1) {
      const position = randomPosition(chunk);
      if (worldDistance(position, requirePlayer(world).components.navigation.position) < CHUNK_PLAYER_SAFE_RADIUS) continue;
      if (positions.some((other) => worldDistance(position, other) < CHUNK_MINE_SPACING)) continue;
      world.addEntity(createMine(`chunk-mine-${sequence++}`, position.x, position.y));
      positions.push(position);
      placed += 1;
    }
    if (Math.random() < CHUNK_ENEMY_CHANCE) spawnEnemy(world, chunk);
    if (Math.random() < BOAT_SPAWN_CHANCE) spawnEnemy(world, chunk, true);
  }

  function update(world: World) {
    const player = requirePlayer(world);
    if (!isPlayerActive(player)) return;
    const frameMs = performance.now();
    nextSpawnAtMs ??= frameMs + ENEMY_RESPAWN_INTERVAL_MS;
    nextBoatSpawnAtMs ??= frameMs + BOAT_RESPAWN_INTERVAL_MS;
    const chunks = surroundingChunks(player.components.navigation.position);
    const desired = new Set(chunks.map(key));
    for (const cellKey of sonar.coverage.keys()) {
      const [x, y] = cellKey.split(",").map(Number);
      if (!desired.has(key(chunkAt(gridCellCenter(x, y))))) sonar.coverage.delete(cellKey);
    }
    for (const entity of world.getEntities() as RadarEntity[]) {
      if (entity.components.kind === "player") continue;
      const position = (entity.components.kind === "mine" || entity.components.kind === "depth-charge") ? entity.components.position : entity.components.navigation.position;
      if (!desired.has(key(chunkAt(position)))) world.removeEntity(entity.id);
    }
    sonar.pulses = sonar.pulses.filter((pulse) => world.getEntity(pulse.sourceId));
    for (const pulse of sonar.pulses) {
      for (const id of pulse.illuminatedContactIds) {
        if (!world.getEntity(id)) pulse.illuminatedContactIds.delete(id);
      }
    }
    sonar.echoes = sonar.echoes.filter((echo) => world.getEntity(echo.sourceId) && world.getEntity(echo.contactId));
    for (const chunk of chunks) {
      if (!loaded.has(key(chunk))) generate(world, chunk);
    }
    loaded = desired;
    if (frameMs >= nextBoatSpawnAtMs) {
      const start = Math.floor(Math.random() * chunks.length);
      for (let offset = 0; offset < chunks.length; offset += 1) {
        if (spawnEnemy(world, chunks[(start + offset) % chunks.length], true)) break;
      }
      nextBoatSpawnAtMs = frameMs + BOAT_RESPAWN_INTERVAL_MS;
    }
    if (frameMs >= nextSpawnAtMs) {
      const start = Math.floor(Math.random() * chunks.length);
      for (let offset = 0; offset < chunks.length; offset += 1) {
        if (spawnEnemy(world, chunks[(start + offset) % chunks.length])) break;
      }
      nextSpawnAtMs = frameMs + ENEMY_RESPAWN_INTERVAL_MS;
    }
  }

  return { attach: update, update, destroy() { loaded.clear(); sonar.coverage.clear(); } };
}
