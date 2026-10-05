import { circleHitsSprite } from "../spriteGeometry";
import { worldDistance } from "../../engine/navigation";
import type { System } from "../../engine/types";
import type { World } from "../../engine/world";
import type { RadarEntity, TorpedoComponents, TorpedoOwner, VesselNavigation } from "../../radarTypes";
import {
  TORPEDO_BAY_CAPACITY,
  TORPEDO_COLLISION_RADIUS,
  TORPEDO_FUSE_MS,
  TORPEDO_RELOAD_MS,
  TORPEDO_SPEED,
  TORPEDO_MIN_TURN_RADIUS,
  TORPEDO_TRAIL_LENGTH,
} from "../config";
import {
  advanceFixedCourse,
  isEnemyVessel,
  isMineEntity,
  isPlayerActive,
  isTorpedoEntity,
  requirePlayer,
} from "./shared";

let torpedoSequence = 0;

export function createTorpedo(
  owner: TorpedoOwner,
  sourceId: string,
  source: VesselNavigation,
  frameMs: number,
  courseTurn: number = source.courseTurn,
) {
  return {
    id: `torpedo-${owner}-${frameMs}-${torpedoSequence++}`,
    components: {
      kind: "torpedo" as const,
      owner,
      sourceId,
      clearedSource: false,
      navigation: {
        position: { ...source.position },
        headingDeg: source.headingDeg,
        speedUnitsPerSecond: TORPEDO_SPEED,
        courseTurn,
        plottedHeadingDeg: null,
      },
      trail: {
        points: [{ ...source.position }],
        firedAtMs: frameMs,
        durationMs: TORPEDO_FUSE_MS,
        lengthUnits: TORPEDO_TRAIL_LENGTH,
      },
    },
  };
}

export function firePlayerTorpedo(world: World) {
  const player = requirePlayer(world);
  if (!isPlayerActive(player) || player.components.torpedoBay.count <= 0) return false;
  const frameMs = performance.now();
  player.components.torpedoBay.count -= 1;
  if (player.components.torpedoBay.count === 0) {
    player.components.torpedoBay.reloadStartMs = frameMs;
  }
  world.addEntity<TorpedoComponents>(createTorpedo("player", player.id, player.components.navigation, frameMs));
  return true;
}

export function fireEnemyTorpedo(
  world: World,
  sourceId: string,
  source: VesselNavigation,
  frameMs: number,
  courseTurn: number,
) {
  world.addEntity<TorpedoComponents>(
    createTorpedo("enemy", sourceId, source, frameMs, courseTurn),
  );
  return true;
}

export function reloadPlayerTorpedoes(world: World) {
  const bay = requirePlayer(world).components.torpedoBay;
  if (bay.count >= TORPEDO_BAY_CAPACITY || bay.reloadStartMs !== null) return false;
  bay.reloadStartMs = performance.now();
  return true;
}

export function advanceAlongCourse(torpedo: TorpedoComponents, deltaSeconds: number) {
  advanceFixedCourse(torpedo.navigation, TORPEDO_SPEED * deltaSeconds, TORPEDO_MIN_TURN_RADIUS);
  torpedo.trail.points.push({ ...torpedo.navigation.position });

  let trailDistance = 0;
  for (let index = torpedo.trail.points.length - 1; index > 0; index -= 1) {
    trailDistance += worldDistance(torpedo.trail.points[index], torpedo.trail.points[index - 1]);
    if (trailDistance > torpedo.trail.lengthUnits) {
      torpedo.trail.points.splice(0, Math.max(0, index - 1));
      break;
    }
  }
}

export function createTorpedoSystem(): System<World> {
  return {
    update(world, deltaMs) {
      const frameMs = performance.now();
      const entities = world.getEntities() as RadarEntity[];

      for (const entity of entities) {
        if (entity.components.kind !== "player" && entity.components.kind !== "enemy-sub") continue;
        const bay = entity.components.torpedoBay;
        if (bay.reloadStartMs !== null && frameMs - bay.reloadStartMs >= TORPEDO_RELOAD_MS) {
          bay.count = TORPEDO_BAY_CAPACITY;
          bay.reloadStartMs = null;
        }
      }

      for (const torpedo of entities.filter(isTorpedoEntity)) {
        advanceAlongCourse(torpedo.components, deltaMs / 1000);
        if (frameMs - torpedo.components.trail.firedAtMs >= torpedo.components.trail.durationMs) {
          world.removeEntity(torpedo.id);
          continue;
        }

        if (!torpedo.components.clearedSource) {
          const source = entities.find((entity) => entity.id === torpedo.components.sourceId);
          if (!source || (source.components.kind !== "player" && source.components.kind !== "enemy-sub" && source.components.kind !== "boat")) {
            torpedo.components.clearedSource = true;
          } else {
            torpedo.components.clearedSource = !circleHitsSprite(
              source.components.kind, source.components.navigation.position, source.components.navigation.headingDeg,
              torpedo.components.navigation.position, TORPEDO_COLLISION_RADIUS,
            );
          }
        }

        const mine = entities.find(
          (entity) =>
            isMineEntity(entity) &&
            entity.components.status.state === "active" &&
            circleHitsSprite("mine", entity.components.position, 0, torpedo.components.navigation.position, TORPEDO_COLLISION_RADIUS),
        );
        if (mine && isMineEntity(mine)) {
          mine.components.status.state = "detonating";
          mine.components.status.detonatedAtMs = frameMs;
          mine.components.detection.state = "tracked";
          world.removeEntity(torpedo.id);
          continue;
        }

        const enemy = entities.find(
          (entity) =>
            isEnemyVessel(entity) &&
            (entity.id !== torpedo.components.sourceId || torpedo.components.clearedSource) &&
            entity.components.status.state === "active" &&
            circleHitsSprite(entity.components.kind, entity.components.navigation.position, entity.components.navigation.headingDeg,
              torpedo.components.navigation.position, TORPEDO_COLLISION_RADIUS),
        );
        if (enemy && isEnemyVessel(enemy)) {
          enemy.components.status.state = "destroyed";
          enemy.components.status.destroyedAtMs = frameMs;
          enemy.components.detection.state = "tracked";
          enemy.components.detection.lastKnownPosition = { ...enemy.components.navigation.position };
          world.removeEntity(torpedo.id);
          continue;
        }

        const player = requirePlayer(world);
        if (
          isPlayerActive(player) &&
          (player.id !== torpedo.components.sourceId || torpedo.components.clearedSource) &&
          circleHitsSprite("player", player.components.navigation.position, player.components.navigation.headingDeg,
            torpedo.components.navigation.position, TORPEDO_COLLISION_RADIUS)
        ) {
          player.components.navigation.speedUnitsPerSecond = 0;
          player.components.navigation.throttleLevel = 0;
          player.components.navigation.courseTurn = 0;
          player.components.status.state = "detonating";
          player.components.status.detonatedAtMs = frameMs;
          player.components.status.detonationCause = torpedo.components.owner === "player" ? "own-torpedo" : "enemy-sub";
          world.removeEntity(torpedo.id);
        }
      }
    },
  };
}
