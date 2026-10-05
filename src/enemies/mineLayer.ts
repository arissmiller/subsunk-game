import type { System } from "../engine/types";
import type { World } from "../engine/world";
import type { MineComponents, MineLayerComponents, RadarEntity } from "../radarTypes";
import {
  ENEMY_MINE_LAYER_COUNT,
  ENEMY_MINE_LAYER_DISTANCE_MAX,
  ENEMY_MINE_LAYER_DISTANCE_MIN,
  MINE_LAYER_GROUP_MAX,
  MINE_LAYER_GROUP_MIN,
  MINE_LAYER_LAY_INTERVAL_MS,
  MINE_LAYER_LAY_VARIANCE_MS,
  MINE_LAYER_SPREAD_RADIUS,
  MINE_LAYER_SPEED,
  MINE_LAYER_WANDER_MS,
  VESSEL_MIN_TURN_RADIUS,
} from "../radar/config";
import { createMine } from "../radar/entities/mines";
import {
  advanceNavigation,
  degreesToRadians,
  isMineLayerEntity,
} from "../radar/entities/shared";

export function createMineLayer(id: string): { id: string; components: MineLayerComponents } {
  const bearing = Math.random() * 360;
  const distance =
    ENEMY_MINE_LAYER_DISTANCE_MIN +
    Math.random() * (ENEMY_MINE_LAYER_DISTANCE_MAX - ENEMY_MINE_LAYER_DISTANCE_MIN);
  const radians = degreesToRadians(bearing - 90);

  return {
    id,
    components: {
      kind: "mine-layer",
      navigation: {
        position: { x: Math.cos(radians) * distance, y: Math.sin(radians) * distance },
        headingDeg: Math.random() * 360,
        speedUnitsPerSecond: MINE_LAYER_SPEED,
        courseTurn: 0,
      },
      mineLayer: {
        lastLayedAtMs: null,
        nextLayIntervalMs: 8000 + Math.random() * 12000,
        lastWanderTurnMs: null,
        wanderTurnIntervalMs: MINE_LAYER_WANDER_MS,
      },
    },
  };
}

export function addMineLayers(world: World) {
  for (let index = 0; index < ENEMY_MINE_LAYER_COUNT; index += 1) {
    world.addEntity(createMineLayer(`mine-layer-${index}`));
  }
}

export function createMineLayerBehaviorSystem(): System<World> {
  return {
    update(world, deltaMs) {
      const layers = (world.getEntities() as RadarEntity[]).filter(isMineLayerEntity);
      const frameMs = performance.now();

      for (const layer of layers) {
        updateMineLayer(world, layer.components, frameMs, deltaMs);
      }
    },
  };
}

function updateMineLayer(
  world: World,
  enemy: MineLayerComponents,
  frameMs: number,
  deltaMs: number,
) {
  const { navigation, mineLayer } = enemy;
  if (
    mineLayer.lastWanderTurnMs === null ||
    frameMs - mineLayer.lastWanderTurnMs >= mineLayer.wanderTurnIntervalMs
  ) {
    navigation.courseTurn = (Math.random() * 2 - 1) * 0.45;
    mineLayer.lastWanderTurnMs = frameMs;
    mineLayer.wanderTurnIntervalMs = MINE_LAYER_WANDER_MS + Math.random() * MINE_LAYER_WANDER_MS;
  }

  advanceNavigation(navigation, MINE_LAYER_SPEED, deltaMs / 1000, {
    acceleration: MINE_LAYER_SPEED,
    deceleration: MINE_LAYER_SPEED,
    minimumTurnRadius: VESSEL_MIN_TURN_RADIUS,
  });

  if (
    mineLayer.lastLayedAtMs !== null &&
    frameMs - mineLayer.lastLayedAtMs < mineLayer.nextLayIntervalMs
  ) {
    return;
  }

  const count =
    MINE_LAYER_GROUP_MIN +
    Math.floor(Math.random() * (MINE_LAYER_GROUP_MAX - MINE_LAYER_GROUP_MIN + 1));
  for (let index = 0; index < count; index += 1) {
    const angle = Math.random() * Math.PI * 2;
    const distance = Math.random() * MINE_LAYER_SPREAD_RADIUS;
    world.addEntity<MineComponents>(
      createMine(
        `mine-laid-${frameMs}-${index}-${Math.random().toString(36).slice(2, 6)}`,
        navigation.position.x + Math.cos(angle) * distance,
        navigation.position.y + Math.sin(angle) * distance,
      ),
    );
  }
  mineLayer.lastLayedAtMs = frameMs;
  mineLayer.nextLayIntervalMs =
    MINE_LAYER_LAY_INTERVAL_MS + Math.random() * MINE_LAYER_LAY_VARIANCE_MS;
}
