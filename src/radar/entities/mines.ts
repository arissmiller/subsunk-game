import { spritesOverlap } from "../spriteGeometry";
import type { System } from "../../engine/types";
import type { World } from "../../engine/world";
import type { PlayerDetonationCause, RadarEntity } from "../../radarTypes";
import {
  CONTACT_DETONATION_MS,
  MINE_COLLISION_RADIUS,
  PLAYER_DETONATION_MS,
} from "../config";
import {
  isMineEntity,
  isPlayerActive,
  requirePlayer,
} from "./shared";

export function createMine(id: string, x: number, y: number) {
  return {
    id,
    components: {
      kind: "mine" as const,
      collision: {
        layer: "hazard" as const,
        radiusUnits: MINE_COLLISION_RADIUS,
        collidesWith: ["player" as const],
        isColliding: false,
        collidedAtMs: null,
      },
      position: { x, y },
      detection: { state: "hidden" as const, revealedAtMs: null },
      status: { state: "active" as const, detonatedAtMs: null },
    },
  };
}

export function createMineCollisionSystem(): System<World> {
  return {
    update(world) {
      const player = requirePlayer(world);
      const mines = (world.getEntities() as RadarEntity[]).filter(isMineEntity);
      const frameMs = performance.now();
      for (const mine of mines) mine.components.collision.isColliding = false;
      if (!isPlayerActive(player)) return;

      for (const mine of mines) {
        if (mine.components.status.state !== "active") continue;
        if (!spritesOverlap("player", player.components.navigation.position, player.components.navigation.headingDeg,
          "mine", mine.components.position, 0)) continue;

        mine.components.collision.isColliding = true;
        mine.components.collision.collidedAtMs = frameMs;
        mine.components.detection.state = "tracked";
        mine.components.detection.revealedAtMs ??= frameMs;
        player.components.navigation.speedUnitsPerSecond = 0;
        player.components.navigation.throttleLevel = 0;
        player.components.navigation.courseTurn = 0;
        player.components.status.state = "detonating";
        player.components.status.detonatedAtMs = frameMs;
        player.components.status.detonationCause = "mine";
        break;
      }
    },
  };
}

export function createDetonationLifecycleSystem(
  onGameOver: (cause: PlayerDetonationCause) => void,
): System<World> {
  let triggered = false;
  return {
    update(world) {
      const frameMs = performance.now();
      const player = requirePlayer(world);
      if (
        player.components.status.state === "detonating" &&
        player.components.status.detonatedAtMs !== null &&
        frameMs - player.components.status.detonatedAtMs >= PLAYER_DETONATION_MS
      ) {
        player.components.status.state = "destroyed";
        if (!triggered) {
          triggered = true;
          onGameOver(player.components.status.detonationCause ?? "mine");
        }
      }

      const mines = (world.getEntities() as RadarEntity[]).filter(isMineEntity);
      for (const mine of mines) {
        if (
          mine.components.status.state === "detonating" &&
          mine.components.status.detonatedAtMs !== null &&
          frameMs - mine.components.status.detonatedAtMs >= CONTACT_DETONATION_MS
        ) {
          mine.components.status.state = "destroyed";
        }
      }
    },
  };
}
