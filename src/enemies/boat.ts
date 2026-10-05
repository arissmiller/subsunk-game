import { calculateDepthChargeSalvo, depthChargeAimPoint } from "./depthChargeTargeting";
import { predictTargetMotion } from "./targetMotion";
import { normalizeDegrees, worldBearingDeg, worldDistance, type WorldPoint } from "../engine/navigation";
import type { System } from "../engine/types";
import type { World } from "../engine/world";
import type { BoatComponents, RadarEntity } from "../radarTypes";
import {
  BOAT_MINE_INTERVAL_MS, BOAT_MINE_SPACING, MINE_COLLISION_RADIUS,
  BOAT_SPEED, BOAT_ACCELERATION, BOAT_MIN_TURN_RADIUS, BOAT_HOLD_RANGE_MIN,
  BOAT_HOLD_RANGE_MAX, BOAT_MIN_FIRE_RANGE, BOAT_FIRE_RANGE, BOAT_TRACK_MAX_AGE_MS,
  BOAT_COLLISION_RADIUS,
  BOAT_BOUNDARY_MARGIN, CHUNK_SIZE, CHUNK_LOAD_RADIUS,
} from "../radar/config";
import { advanceNavigation, clamp, isBoatEntity, isMineEntity, isPlayerActive, requirePlayer } from "../radar/entities/shared";
import { createMine } from "../radar/entities/mines";
import { createDepthCharge } from "../radar/entities/depthCharges";
import { createEnemySubmarine } from "./submarine";

let laidMineSequence = 0;

export function createBoat(world: World, id: string, position: WorldPoint): { id: string; components: BoatComponents } {
  const { navigation, detection, status, sonar } = createEnemySubmarine(world, id, position).components;
  const initialTarget = { ...requirePlayer(world).components.navigation.position };
  return { id, components: {
    kind: "boat", navigation, detection, status, sonar,
    ai: { initialTarget, lastEstimatedTarget: { ...initialTarget }, nextFireAtMs: 0, nextMineAtMs: performance.now() + BOAT_MINE_INTERVAL_MS },
  } };
}

export function boatNavigationIntent(position: WorldPoint, target: WorldPoint, hasFreshTrack: boolean) {
  const distance = worldDistance(position, target);
  const bearing = worldBearingDeg(position, target);
  if (!hasFreshTrack) return { bearing, speed: distance > BOAT_COLLISION_RADIUS ? BOAT_SPEED : 0 };
  if (distance < BOAT_HOLD_RANGE_MIN) return { bearing: normalizeDegrees(bearing + 180), speed: BOAT_SPEED };
  return { bearing, speed: distance > BOAT_HOLD_RANGE_MAX ? BOAT_SPEED : 0 };
}

export function createBoatBehaviorSystem(): System<World> {
  return {
    update(world, deltaMs) {
      const player = requirePlayer(world);
      if (!isPlayerActive(player)) return;
      const now = performance.now();
      const playerPosition = player.components.navigation.position;
      const chunkX = Math.floor(playerPosition.x / CHUNK_SIZE);
      const chunkY = Math.floor(playerPosition.y / CHUNK_SIZE);
      const minX = (chunkX - CHUNK_LOAD_RADIUS) * CHUNK_SIZE + BOAT_COLLISION_RADIUS;
      const maxX = (chunkX + CHUNK_LOAD_RADIUS + 1) * CHUNK_SIZE - BOAT_COLLISION_RADIUS;
      const minY = (chunkY - CHUNK_LOAD_RADIUS) * CHUNK_SIZE + BOAT_COLLISION_RADIUS;
      const maxY = (chunkY + CHUNK_LOAD_RADIUS + 1) * CHUNK_SIZE - BOAT_COLLISION_RADIUS;
      for (const boat of (world.getEntities() as RadarEntity[]).filter(isBoatEntity)) {
        const { navigation, sonar, ai, status } = boat.components;
        if (status.state !== "active") continue;
        const track = sonar.targetTrack;
        const ageMs = track ? Math.max(0, now - track.observedAtMs) : Infinity;
        const fresh = track !== null && ageMs <= BOAT_TRACK_MAX_AGE_MS;
        if (fresh && track) {
          ai.lastEstimatedTarget = predictTargetMotion(track, ageMs / 1000).position;
          const inFiringRange = (point: WorldPoint) => {
            const distance = worldDistance(navigation.position, point);
            return distance >= BOAT_MIN_FIRE_RANGE && distance <= BOAT_FIRE_RANGE;
          };
          if (ai.lastTargetPingAtMs !== track.observedAtMs) {
            ai.lastTargetPingAtMs = track.observedAtMs;
            const aim = depthChargeAimPoint(track, ageMs / 1000);
            const outsideMinimum = worldDistance(navigation.position, ai.lastEstimatedTarget) >= BOAT_MIN_FIRE_RANGE &&
              worldDistance(navigation.position, aim) >= BOAT_MIN_FIRE_RANGE;
            if (outsideMinimum && (inFiringRange(track.position) || inFiringRange(ai.lastEstimatedTarget))) {
              for (const impact of calculateDepthChargeSalvo(track, ageMs / 1000)) {
                const dx = impact.x - navigation.position.x;
                const dy = impact.y - navigation.position.y;
                const distance = Math.hypot(dx, dy);
                const bearing = distance > 0 ? Math.atan2(dy, dx) : worldBearingDeg(navigation.position, aim) * Math.PI / 180 - Math.PI / 2;
                const range = clamp(distance, BOAT_MIN_FIRE_RANGE, BOAT_FIRE_RANGE);
                world.addEntity(createDepthCharge(boat.id, inFiringRange(impact) ? impact : {
                  x: navigation.position.x + Math.cos(bearing) * range,
                  y: navigation.position.y + Math.sin(bearing) * range,
                }, now));
              }
            }
          }
        }
        const intent = boatNavigationIntent(navigation.position, track ? ai.lastEstimatedTarget : ai.initialTarget, fresh);
        const position = navigation.position;
        if (position.x < minX + BOAT_BOUNDARY_MARGIN || position.x > maxX - BOAT_BOUNDARY_MARGIN ||
            position.y < minY + BOAT_BOUNDARY_MARGIN || position.y > maxY - BOAT_BOUNDARY_MARGIN) {
          intent.bearing = worldBearingDeg(position, { x: (minX + maxX) / 2, y: (minY + maxY) / 2 });
          intent.speed = BOAT_SPEED;
        }
        advanceNavigation(navigation, intent.speed, deltaMs / 1000, {
          acceleration: BOAT_ACCELERATION, deceleration: BOAT_ACCELERATION,
          minimumTurnRadius: BOAT_MIN_TURN_RADIUS, targetBearing: intent.bearing,
        });
        position.x = clamp(position.x, minX, maxX);
        position.y = clamp(position.y, minY, maxY);
        if (now >= ai.nextMineAtMs) {
          // Missed intervals never produce a burst of overlapping mines.
          ai.nextMineAtMs = now + BOAT_MINE_INTERVAL_MS;
          if (navigation.speedUnitsPerSecond < 1) continue;
          const heading = navigation.headingDeg * Math.PI / 180;
          const sternOffset = BOAT_COLLISION_RADIUS + MINE_COLLISION_RADIUS + 20;
          const drop = {
            x: position.x - Math.sin(heading) * sternOffset,
            y: position.y + Math.cos(heading) * sternOffset,
          };
          const row = [-1, 0, 1].map(index => ({
            x: drop.x + Math.cos(heading) * index * BOAT_MINE_SPACING,
            y: drop.y + Math.sin(heading) * index * BOAT_MINE_SPACING,
          }));
          const crowded = (world.getEntities() as RadarEntity[]).some(entity =>
            isMineEntity(entity) && entity.components.status.state === "active" &&
            row.some(point => worldDistance(entity.components.position, point) < BOAT_MINE_SPACING));
          if (!crowded) {
            for (const point of row) {
              world.addEntity(createMine(`boat-mine-${boat.id}-${laidMineSequence++}`, point.x, point.y));
            }
          }
        }
      }
    },
  };
}
