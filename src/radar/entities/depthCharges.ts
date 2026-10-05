import { circleHitsSprite } from "../spriteGeometry";
import { type WorldPoint } from "../../engine/navigation";
import type { System } from "../../engine/types";
import type { World } from "../../engine/world";
import type { DepthChargeComponents, RadarEntity } from "../../radarTypes";
import { CONTACT_DETONATION_MS, DEPTH_CHARGE_BLAST_RADIUS, DEPTH_CHARGE_SINK_MS } from "../config";
import { isEnemyVessel, isMineEntity } from "./shared";

let sequence = 0;
export function createDepthCharge(sourceId: string, position: WorldPoint, launchedAtMs: number): { id: string; components: DepthChargeComponents } {
  return { id: `depth-charge-${sequence++}`, components: {
    kind: "depth-charge", sourceId, position: { ...position }, launchedAtMs, detonatedAtMs: null,
  } };
}

export function createDepthChargeSystem(): System<World> {
  return {
    update(world) {
      const now = performance.now();
      const entities = world.getEntities() as RadarEntity[];
      for (const charge of entities) {
        const components = charge.components;
        if (components.kind !== "depth-charge") continue;
        if (components.detonatedAtMs !== null) {
          if (now - components.detonatedAtMs >= CONTACT_DETONATION_MS) world.removeEntity(charge.id);
          continue;
        }
        if (now - components.launchedAtMs < DEPTH_CHARGE_SINK_MS) continue;
        components.detonatedAtMs = now;
        for (const entity of entities) {
          const target = entity.components;
          if (target.kind === "player") {
            if (target.status.state !== "active" || !circleHitsSprite("player", target.navigation.position, target.navigation.headingDeg, components.position, DEPTH_CHARGE_BLAST_RADIUS)) continue;
            target.navigation.speedUnitsPerSecond = 0;
            target.navigation.throttleLevel = 0;
            target.navigation.courseTurn = 0;
            target.status.state = "detonating";
            target.status.detonatedAtMs = now;
            target.status.detonationCause = "depth-charge";
          } else if (isEnemyVessel(entity)) {
            const vessel = entity.components;
            if (vessel.status.state !== "active" || !circleHitsSprite(vessel.kind, vessel.navigation.position, vessel.navigation.headingDeg, components.position, DEPTH_CHARGE_BLAST_RADIUS)) continue;
            vessel.status.state = "destroyed";
            vessel.status.destroyedAtMs = now;
            vessel.detection.state = "tracked";
            vessel.detection.lastKnownPosition = { ...vessel.navigation.position };
          } else if (isMineEntity(entity)) {
            const mine = entity.components;
            if (mine.status.state !== "active" || !circleHitsSprite("mine", mine.position, 0, components.position, DEPTH_CHARGE_BLAST_RADIUS)) continue;
            mine.status.state = "detonating";
            mine.status.detonatedAtMs = now;
            mine.detection.state = "tracked";
            mine.detection.revealedAtMs ??= now;
          }
        }
      }
    },
  };
}
