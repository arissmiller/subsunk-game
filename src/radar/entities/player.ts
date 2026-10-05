import { updateGridCoverage } from "../grid";
import { worldDistance } from "../../engine/navigation";
import type { System } from "../../engine/types";
import type { World } from "../../engine/world";
import type {
  EnemySubComponents,
  BoatComponents,
  MineComponents,
  PlayerComponents,
  RadarEntity,
  SonarState,
  ThrottleLevel,
} from "../../radarTypes";
import {
  CONTACT_VISIBLE_RADIUS,
  COURSE_TURN_LIMIT,
  DETECTION_PING_MS,
  SONAR_CONTACT_TRACK_MS,
  SONAR_PULSE_BAND_UNITS,
  SONAR_PULSE_INTERVAL_MS,
  THROTTLE_SPEEDS,
  TORPEDO_BAY_CAPACITY,
  VESSEL_ACCELERATION,
  VESSEL_COLLISION_RADIUS,
  VESSEL_DECELERATION,
  VESSEL_MIN_TURN_RADIUS,
} from "../config";
import {
  advanceNavigation,
  clamp,
  echoReturnAt,
  isEnemyVessel,
  isMineEntity,
  isPlayerActive,
  pulseRadiusAt,
  requirePlayer,
} from "./shared";

export function createPlayerEntity(): { id: string; components: PlayerComponents } {
  return {
    id: "player",
    components: {
      kind: "player",
      collision: {
        layer: "player",
        radiusUnits: VESSEL_COLLISION_RADIUS,
        collidesWith: ["hazard"],
      },
      status: { state: "active", detonatedAtMs: null, detonationCause: null },
      navigation: {
        position: { x: 0, y: 0 },
        headingDeg: 0,
        throttleLevel: 0,
        speedUnitsPerSecond: 0,
        courseTurn: 0,
      },
      torpedoBay: { count: TORPEDO_BAY_CAPACITY, reloadStartMs: null },
    },
  };
}

export function createPlayerNavigationSystem(): System<World> {
  return {
    update(world, deltaMs) {
      const player = requirePlayer(world);
      if (!isPlayerActive(player)) return;
      advanceNavigation(
        player.components.navigation,
        THROTTLE_SPEEDS[player.components.navigation.throttleLevel],
        deltaMs / 1000,
        {
          acceleration: VESSEL_ACCELERATION,
          deceleration: VESSEL_DECELERATION,
          minimumTurnRadius: VESSEL_MIN_TURN_RADIUS,
        },
      );
    },
  };
}

export function createPlayerSonarSystem(sonar: SonarState): System<World> {
  return {
    update(world) {
      const frameMs = performance.now();
      const player = requirePlayer(world);
      const origin = player.components.navigation.position;

      if (
        sonar.playerLastEmittedAtMs === null ||
        frameMs - sonar.playerLastEmittedAtMs >= SONAR_PULSE_INTERVAL_MS
      ) {
        sonar.pulses.push({
          sourceId: player.id,
          owner: "player",
          origin: { ...origin },
          emittedAtMs: frameMs,
          illuminatedContactIds: new Set(),
        });
        sonar.playerLastEmittedAtMs = frameMs;
      }

      const entities = world.getEntities() as RadarEntity[];
      const mines = entities.filter(isMineEntity);
      const enemies = entities.filter(isEnemyVessel);

      for (const pulse of sonar.pulses) {
        if (pulse.owner !== "player") continue;
        const radius = pulseRadiusAt(pulse, frameMs);

        for (const mine of mines) {
          scheduleContact(
            sonar,
            pulse,
            mine.id,
            "mine",
            mine.components.position,
            null,
            radius,
            frameMs,
          );
        }
        for (const enemy of enemies) {
          if (enemy.components.status.state !== "active") continue;
          scheduleContact(
            sonar,
            pulse,
            enemy.id,
            enemy.components.kind,
            enemy.components.navigation.position,
            enemy.components.navigation.headingDeg,
            radius,
            frameMs,
            enemy.components.navigation,
          );
        }
      }

      for (let index = sonar.echoes.length - 1; index >= 0; index -= 1) {
        const echo = sonar.echoes[index];
        if (echo.sourceId !== player.id || frameMs < echo.returnAtMs) continue;

        if (echo.contactKind === "mine") {
          const mine = world.getEntity<MineComponents>(echo.contactId);
          if (mine?.components.status.state === "active") {
            mine.components.detection.state = "ping";
            mine.components.detection.revealedAtMs = frameMs;
          }
        } else if ((echo.contactKind === "enemy-sub" || echo.contactKind === "boat")) {
          const enemy = world.getEntity<EnemySubComponents | BoatComponents>(echo.contactId);
          if (enemy?.components.status.state === "active") {
            enemy.components.detection.state = "ping";
            enemy.components.detection.revealedAtMs = frameMs;
            enemy.components.detection.trackedUntilMs = null;
            enemy.components.detection.lastKnownPosition = echo.contactPosition;
            enemy.components.detection.lastKnownHeadingDeg = echo.contactHeadingDeg;
            enemy.components.detection.lastKnownCourse = {
              position: { ...echo.contactPosition },
              headingDeg: echo.contactHeadingDeg ?? 0,
              speedUnitsPerSecond: echo.contactSpeedUnitsPerSecond ?? 0,
              courseTurn: echo.contactCourseTurn ?? 0,
            };
          }
        }
        sonar.echoes.splice(index, 1);
      }

      for (const mine of mines) {
        if (
          mine.components.detection.state === "ping" &&
          mine.components.detection.revealedAtMs !== null &&
          frameMs - mine.components.detection.revealedAtMs >= DETECTION_PING_MS
        ) {
          mine.components.detection.state = "tracked";
        }
      }
      for (const enemy of enemies) {
        const detection = enemy.components.detection;
        if (
          detection.state === "ping" &&
          detection.revealedAtMs !== null &&
          frameMs - detection.revealedAtMs >= DETECTION_PING_MS
        ) {
          detection.state = "tracked";
          detection.trackedUntilMs = frameMs + SONAR_CONTACT_TRACK_MS;
        } else if (
          detection.state === "tracked" &&
          detection.trackedUntilMs !== null &&
          frameMs > detection.trackedUntilMs
        ) {
          detection.state = "hidden";
          detection.trackedUntilMs = null;
        }
      }

      updateGridCoverage(sonar, frameMs, origin);

      sonar.pulses = sonar.pulses.filter(
        (pulse) =>
          pulse.owner !== "player" ||
          pulseRadiusAt(pulse, frameMs) <= CONTACT_VISIBLE_RADIUS * 2 + SONAR_PULSE_BAND_UNITS,
      );
    },
  };
}

function scheduleContact(
  sonar: SonarState,
  pulse: SonarState["pulses"][number],
  id: string,
  kind: "mine" | "enemy-sub" | "boat",
  position: { x: number; y: number },
  heading: number | null,
  radius: number,
  frameMs: number,
  navigation?: { speedUnitsPerSecond: number; courseTurn: number },
) {
  const distance = worldDistance(pulse.origin, position);
  if (
    distance > CONTACT_VISIBLE_RADIUS ||
    distance > radius ||
    pulse.illuminatedContactIds.has(id)
  ) {
    return;
  }
  pulse.illuminatedContactIds.add(id);
  sonar.echoes.push({
    sourceId: pulse.sourceId,
    contactId: id,
    contactKind: kind,
    contactPosition: { ...position },
    contactHeadingDeg: heading,
    contactVelocity: null,
    contactSpeedUnitsPerSecond: navigation?.speedUnitsPerSecond,
    contactCourseTurn: navigation?.courseTurn,
    observedAtMs: frameMs,
    returnAtMs: echoReturnAt(frameMs, distance),
  });
}

export function changeThrottle(world: World, delta: number) {
  const player = requirePlayer(world);
  if (!isPlayerActive(player)) return;
  player.components.navigation.throttleLevel = clamp(
    player.components.navigation.throttleLevel + delta,
    0,
    2,
  ) as ThrottleLevel;
}

export function changeCourse(world: World, delta: number) {
  const player = requirePlayer(world);
  if (!isPlayerActive(player)) return;
  player.components.navigation.courseTurn = Number(
    clamp(player.components.navigation.courseTurn + delta, -COURSE_TURN_LIMIT, COURSE_TURN_LIMIT).toFixed(4),
  );
}
