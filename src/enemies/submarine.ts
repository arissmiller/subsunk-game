import { calculateTorpedoSolution } from "./torpedoSolution";
import { estimateTargetTurn, predictTargetMotion, type TargetMotion } from "./targetMotion";
import { normalizeDegrees, worldBearingDeg, worldDistance, type WorldPoint } from "../engine/navigation";
import type { System } from "../engine/types";
import type { World } from "../engine/world";
import type { EnemySubComponents, RadarEntity, SonarState } from "../radarTypes";
import {
  ENEMY_FIRE_TURN_MAX_SECONDS,
  ENEMY_FIRE_DETOUR_MAX_SECONDS,
  ENEMY_FIRE_RETURN_TOLERANCE_DEG,
  ENEMY_FIRE_MANEUVER_COOLDOWN_MS,
  BOAT_SONAR_RANGE,
  BOAT_SONAR_INTERVAL_MS,
  CONTACT_DETONATION_MS,
  CONTACT_VISIBLE_RADIUS,
  ENEMY_BURST_COOLDOWN_MS,
  ENEMY_BURST_SIZE,
  ENEMY_EVASION_CLEARANCE,
  ENEMY_EVASION_LOOKAHEAD_SECONDS,
  ENEMY_HOLD_RANGE_MAX,
  ENEMY_HOLD_RANGE_MIN,
  ENEMY_MAX_FIRE_RANGE,
  ENEMY_MIN_FIRE_RANGE,
  ENEMY_SEPARATION_MAX_BIAS_DEG,
  ENEMY_SEPARATION_RADIUS,
  ENEMY_SHOT_INTERVAL_MS,
  ENEMY_TARGET_LEAD_SECONDS,
  SONAR_PULSE_BAND_UNITS,
  SONAR_PULSE_INTERVAL_MS,
  THROTTLE_SPEEDS,
  TORPEDO_BAY_CAPACITY,
  TORPEDO_SPEED,
  VESSEL_ACCELERATION,
  VESSEL_DECELERATION,
  VESSEL_MIN_TURN_RADIUS,
} from "../radar/config";
import {
  advanceNavigation,
  echoReturnAt,
  clamp,
  type EnemyEntity,
  isEnemyEntity,
  isEnemyVessel,
  isPlayerActive,
  isTorpedoEntity,
  pulseRadiusAt,
  requirePlayer,
  signedHeadingError,
  type TorpedoEntity,
} from "../radar/entities/shared";
import { fireEnemyTorpedo } from "../radar/entities/torpedoes";

export type EnemyTargetTrack = TargetMotion;

export interface EnemyNavigationIntent {
  targetBearing: number;
  targetSpeed: number;
  targetDistance: number;
  firingBearing: number;
}

export interface IncomingThreat {
  torpedoPosition: WorldPoint;
  torpedoVelocity: WorldPoint;
  timeToClosestSeconds: number;
  closestDistance: number;
}

export function createEnemySubmarine(world: World, id: string, position: WorldPoint) {
  const headingDeg = worldBearingDeg(position, requirePlayer(world).components.navigation.position);

  return {
    id,
    components: {
      kind: "enemy-sub" as const,
      navigation: {
        position: { ...position },
        headingDeg,
        speedUnitsPerSecond: THROTTLE_SPEEDS[0],
        courseTurn: 0,
      },
      detection: {
        state: "hidden" as const,
        revealedAtMs: null,
        trackedUntilMs: null,
        lastKnownPosition: null,
        lastKnownHeadingDeg: null,
      },
      status: { state: "active" as const, destroyedAtMs: null },
      sonar: { lastEmittedAtMs: null, targetTrack: null },
      torpedoBay: { count: TORPEDO_BAY_CAPACITY, reloadStartMs: null },
      ai: { disengageBearing: null, disengageUntilMs: 0, reengageBearing: null, reengageUntilMs: 0, shotsFiredInBurst: 0, nextFireAtMs: 0 },
    },
  };
}

export function createEnemySubmarineSonarSystem(sonar: SonarState): System<World> {
  return {
    update(world) {
      const frameMs = performance.now();
      const enemies = (world.getEntities() as RadarEntity[]).filter(isEnemyVessel);

      for (const enemy of enemies) {
        if (enemy.components.status.state !== "active") continue;
        const enemySonar = enemy.components.sonar;
        if (
          enemySonar.lastEmittedAtMs === null ||
          frameMs - enemySonar.lastEmittedAtMs >= (enemy.components.kind === "boat" ? BOAT_SONAR_INTERVAL_MS : SONAR_PULSE_INTERVAL_MS)
        ) {
          sonar.pulses.push({
            rangeUnits: enemy.components.kind === "boat" ? BOAT_SONAR_RANGE : CONTACT_VISIBLE_RADIUS,
            sourceId: enemy.id,
            owner: "enemy",
            origin: { ...enemy.components.navigation.position },
            emittedAtMs: frameMs,
            illuminatedContactIds: new Set(),
          });
          enemySonar.lastEmittedAtMs = frameMs;
        }
      }

      const player = requirePlayer(world);
      for (const pulse of sonar.pulses) {
        if (pulse.owner !== "enemy" || !isPlayerActive(player)) continue;
        const source = enemies.find((enemy) => enemy.id === pulse.sourceId);
        if (!source || source.components.status.state !== "active") continue;
        const navigation = player.components.navigation;
        const distance = worldDistance(pulse.origin, navigation.position);
        if (
          distance > (pulse.rangeUnits ?? CONTACT_VISIBLE_RADIUS) ||
          distance > pulseRadiusAt(pulse, frameMs) ||
          pulse.illuminatedContactIds.has(player.id)
        ) continue;

        pulse.illuminatedContactIds.add(player.id);
        sonar.echoes.push({
          sourceId: pulse.sourceId,
          contactId: player.id,
          contactKind: "player",
          contactPosition: { ...navigation.position },
          contactHeadingDeg: navigation.headingDeg,
          contactVelocity: velocityFromNavigation(navigation),
          contactSpeedUnitsPerSecond: navigation.speedUnitsPerSecond,
          contactTurnRateDegPerSecond: navigation.courseTurn * navigation.speedUnitsPerSecond / VESSEL_MIN_TURN_RADIUS * 180 / Math.PI,
          observedAtMs: frameMs,
          returnAtMs: echoReturnAt(frameMs, distance),
        });
      }

      for (let index = sonar.echoes.length - 1; index >= 0; index -= 1) {
        const echo = sonar.echoes[index];
        if (echo.contactKind !== "player" || frameMs < echo.returnAtMs) continue;
        const enemy = enemies.find((candidate) => candidate.id === echo.sourceId);
        if (
          enemy?.components.status.state === "active" &&
          echo.contactVelocity !== null && echo.contactHeadingDeg !== null &&
          (!enemy.components.sonar.targetTrack ||
            echo.observedAtMs > enemy.components.sonar.targetTrack.observedAtMs)
        ) {
          enemy.components.sonar.targetTrack = {
            turnRateDegPerSecond: echo.contactTurnRateDegPerSecond ?? estimateTargetTurn(enemy.components.sonar.targetTrack, {
              headingDeg: echo.contactHeadingDeg, observedAtMs: echo.observedAtMs, velocity: echo.contactVelocity,
            }),
            position: { ...echo.contactPosition },
            velocity: { ...echo.contactVelocity },
            headingDeg: echo.contactHeadingDeg,
            speedUnitsPerSecond: echo.contactSpeedUnitsPerSecond ?? Math.hypot(echo.contactVelocity.x, echo.contactVelocity.y),
            observedAtMs: echo.observedAtMs,
          };
        }
        sonar.echoes.splice(index, 1);
      }

      sonar.pulses = sonar.pulses.filter(
        (pulse) =>
          pulse.owner !== "enemy" ||
          pulseRadiusAt(pulse, frameMs) <= (pulse.rangeUnits ?? CONTACT_VISIBLE_RADIUS) + SONAR_PULSE_BAND_UNITS,
      );
    },
  };
}

export function createEnemySubmarineBehaviorSystem(): System<World> {
  return {
    update(world, deltaMs) {
      const player = requirePlayer(world);
      if (!isPlayerActive(player)) return;

      const frameMs = performance.now();
      const entities = world.getEntities() as RadarEntity[];
      const enemies = entities.filter(isEnemyEntity);
      const torpedoes = entities.filter(isTorpedoEntity);

      for (const enemy of enemies) {
        if (enemy.components.status.state !== "active") continue;
        const target = acquireEnemyTarget(world, enemy, frameMs);
        const threats = torpedoes.filter((torpedo) =>
          torpedo.components.sourceId !== enemy.id || torpedo.components.clearedSource,
        );
        if (!target) {
          const navigation = enemy.components.navigation;
          const threat = findIncomingThreat(navigation, navigation.headingDeg, THROTTLE_SPEEDS[1], threats);
          advanceNavigation(navigation, threat ? THROTTLE_SPEEDS[2] : THROTTLE_SPEEDS[1], deltaMs / 1000, {
            acceleration: VESSEL_ACCELERATION,
            deceleration: VESSEL_DECELERATION,
            minimumTurnRadius: VESSEL_MIN_TURN_RADIUS,
            targetBearing: threat ? chooseAvoidanceBearing(navigation, threat) : navigation.headingDeg,
          });
          continue;
        }
        updateEnemySubmarine(world, enemy, enemies, threats, target, frameMs, deltaMs);
      }
    },
  };
}

export function acquireEnemyTarget(
  world: World,
  enemy: EnemyEntity,
  frameMs: number,
): EnemyTargetTrack | null {
  if (!isPlayerActive(requirePlayer(world))) return null;
  const track = enemy.components.sonar.targetTrack;
  if (!track) return null;
  const elapsedSeconds = Math.max(0, frameMs - track.observedAtMs) / 1000;
  return predictTargetMotion(track, elapsedSeconds);
}

function updateEnemySubmarine(
  world: World,
  enemyEntity: EnemyEntity,
  enemies: EnemyEntity[],
  torpedoes: TorpedoEntity[],
  target: EnemyTargetTrack,
  frameMs: number,
  deltaMs: number,
) {
  const { navigation, torpedoBay: bay, ai } = enemyEntity.components;
  const intent = calculateNavigationIntent(navigation, target);

  // Equal-speed pursuit can prevent a distance-only escape from ever ending.
  if (ai.disengageBearing !== null &&
      (intent.targetDistance >= ENEMY_HOLD_RANGE_MIN || frameMs >= ai.disengageUntilMs)) {
    ai.disengageBearing = null;
    // Allow a full turn back without restarting escape at close range.
    ai.reengageUntilMs = frameMs + 10000;
    ai.reengageBearing = intent.firingBearing;
  }
  if (ai.disengageBearing === null && frameMs >= ai.reengageUntilMs &&
      intent.targetDistance < ENEMY_MIN_FIRE_RANGE) {
    const awayBearing = normalizeDegrees(worldBearingDeg(navigation.position, target.position) + 180);
    const candidates = [normalizeDegrees(awayBearing - 70), normalizeDegrees(awayBearing + 70)];
    ai.disengageBearing = candidates.reduce((best, candidate) =>
      Math.abs(signedHeadingError(navigation.headingDeg, candidate)) <
      Math.abs(signedHeadingError(navigation.headingDeg, best)) ? candidate : best,
    );
    ai.disengageUntilMs = frameMs + 4000;
  }
  if (ai.disengageBearing !== null) {
    intent.targetBearing = ai.disengageBearing;
    intent.targetSpeed = THROTTLE_SPEEDS[2];
  } else if (frameMs < ai.reengageUntilMs) {
    // Hold the return leg so a turning pursuer cannot trap us in a mutual orbit.
    intent.targetBearing = ai.reengageBearing ?? intent.firingBearing;
    intent.targetSpeed = THROTTLE_SPEEDS[1];
  }

  const combatBearing = applySeparationBias(intent.targetBearing, enemyEntity, enemies);
  const threat = findIncomingThreat(navigation, combatBearing, intent.targetSpeed, torpedoes);
  const finishManeuver = () => {
    ai.firingManeuver = null;
    ai.nextManeuverAtMs = frameMs + ENEMY_FIRE_MANEUVER_COOLDOWN_MS;
  };
  if (ai.firingManeuver && (threat || frameMs >= ai.firingManeuver.untilMs ||
      (ai.firingManeuver.phase === "returning" && Math.abs(signedHeadingError(navigation.headingDeg, ai.firingManeuver.returnBearing)) <= ENEMY_FIRE_RETURN_TOLERANCE_DEG))) {
    finishManeuver();
  }

  const fireIfReady = () => {
    if (!canEnemyFire(navigation, target, bay.count, ai.nextFireAtMs, frameMs)) return false;
    const solution = calculateTorpedoSolution(navigation, target);
    if (!solution) return false;
    fireEnemyTorpedo(world, enemyEntity.id, navigation, frameMs, solution.courseTurn);
    bay.count -= 1;
    const cadence = advanceEnemyFireCadence(ai.shotsFiredInBurst, frameMs);
    ai.shotsFiredInBurst = cadence.shotsFiredInBurst;
    ai.nextFireAtMs = cadence.nextFireAtMs;
    if (bay.count === 0) bay.reloadStartMs = frameMs;
    if (ai.firingManeuver?.phase === "aiming") {
      ai.firingManeuver.phase = "returning";
      ai.firingManeuver.untilMs += (ENEMY_FIRE_DETOUR_MAX_SECONDS - ENEMY_FIRE_TURN_MAX_SECONDS) * 1000;
    }
    return true;
  };
  const fired = fireIfReady();
  if (!fired && !threat && !ai.firingManeuver && frameMs >= (ai.nextManeuverAtMs ?? 0) &&
      bay.count > 0 && frameMs >= ai.nextFireAtMs &&
      canMakeFiringDetour(navigation, target, combatBearing, intent.targetSpeed)) {
    ai.firingManeuver = { phase: "aiming", returnBearing: combatBearing, untilMs: frameMs + ENEMY_FIRE_TURN_MAX_SECONDS * 1000 };
  }
  // The normal retreat/reengagement state stays intact throughout the temporary turn.
  let targetBearing = combatBearing;
  if (ai.firingManeuver) {
    const desired = ai.firingManeuver.phase === "aiming" ? intent.firingBearing : ai.firingManeuver.returnBearing;
    targetBearing = firingTurnBearing(navigation.headingDeg, desired);
  }
  if (threat) targetBearing = chooseAvoidanceBearing(navigation, threat);
  advanceNavigation(navigation, threat ? THROTTLE_SPEEDS[2] : intent.targetSpeed, deltaMs / 1000, {
    acceleration: VESSEL_ACCELERATION, deceleration: VESSEL_DECELERATION,
    minimumTurnRadius: VESSEL_MIN_TURN_RADIUS, targetBearing,
  });
  // Catch a firing window opened by this frame's turn instead of waiting another frame.
  if (ai.firingManeuver?.phase === "aiming") fireIfReady();

}

// Brief firing corrections use full rudder instead of the cruising controller's eased turn.
// The normal speed, acceleration, and minimum turn radius still limit angular motion.
function firingTurnBearing(heading: number, desired: number) {
  return normalizeDegrees(heading + Math.sign(signedHeadingError(heading, desired)) * 50);
}

export function canMakeFiringDetour(
  navigation: EnemySubComponents["navigation"], target: EnemyTargetTrack,
  returnBearing: number, targetSpeed: number,
) {
  const initial = calculateNavigationIntent(navigation, target);
  if (initial.targetDistance < ENEMY_MIN_FIRE_RANGE || initial.targetDistance > ENEMY_MAX_FIRE_RANGE ||
      calculateTorpedoSolution(navigation, target) !== null) return false;
  const trial = { ...navigation, position: { ...navigation.position } };
  const step = 0.05;
  let elapsed = 0;
  let aligned = false;
  while (elapsed < ENEMY_FIRE_DETOUR_MAX_SECONDS) {
    const predicted = predictTargetMotion(target, elapsed);
    if (!aligned && canEnemyFire(trial, predicted, 1, 0, 0)) aligned = true;
    if (!aligned && elapsed >= ENEMY_FIRE_TURN_MAX_SECONDS) return false;
    if (aligned && Math.abs(signedHeadingError(trial.headingDeg, returnBearing)) <= ENEMY_FIRE_RETURN_TOLERANCE_DEG) return true;
    advanceNavigation(trial, targetSpeed, step, {
      acceleration: VESSEL_ACCELERATION, deceleration: VESSEL_DECELERATION,
      minimumTurnRadius: VESSEL_MIN_TURN_RADIUS,
      targetBearing: firingTurnBearing(trial.headingDeg, aligned ? returnBearing : calculateNavigationIntent(trial, predicted).firingBearing),
    });
    elapsed += step;
  }
  return false;
}

export function calculateNavigationIntent(
  navigation: EnemySubComponents["navigation"],
  target: EnemyTargetTrack,
): EnemyNavigationIntent {
  const targetDistance = worldDistance(navigation.position, target.position);
  const intercept = calculateInterceptPoint(
    navigation.position,
    target.position,
    target.velocity,
    TORPEDO_SPEED,
    ENEMY_TARGET_LEAD_SECONDS,
    target.turnRateDegPerSecond,
    target.turnRemainingSeconds,
  );
  const firingBearing = worldBearingDeg(navigation.position, intercept);

  if (targetDistance < ENEMY_MIN_FIRE_RANGE) {
    return {
      targetBearing: normalizeDegrees(worldBearingDeg(navigation.position, target.position) + 180),
      targetSpeed: THROTTLE_SPEEDS[2],
      targetDistance,
      firingBearing,
    };
  }
  if (targetDistance > ENEMY_HOLD_RANGE_MAX) {
    return {
      targetBearing: firingBearing,
      targetSpeed: THROTTLE_SPEEDS[2],
      targetDistance,
      firingBearing,
    };
  }
  return {
    targetBearing: firingBearing,
    targetSpeed: THROTTLE_SPEEDS[1],
    targetDistance,
    firingBearing,
  };
}

export function canEnemyFire(
  navigation: EnemySubComponents["navigation"],
  target: EnemyTargetTrack,
  torpedoCount: number,
  nextFireAtMs: number,
  frameMs: number,
) {
  if (torpedoCount <= 0 || frameMs < nextFireAtMs) return false;
  const intent = calculateNavigationIntent(navigation, target);
  return (
    intent.targetDistance >= ENEMY_MIN_FIRE_RANGE &&
    intent.targetDistance <= ENEMY_MAX_FIRE_RANGE &&
    calculateTorpedoSolution(navigation, target) !== null
  );
}

export function advanceEnemyFireCadence(shotsFiredInBurst: number, frameMs: number) {
  const nextCount = shotsFiredInBurst + 1;
  if (nextCount >= ENEMY_BURST_SIZE) {
    return {
      shotsFiredInBurst: 0,
      nextFireAtMs: frameMs + ENEMY_BURST_COOLDOWN_MS,
    };
  }
  return {
    shotsFiredInBurst: nextCount,
    nextFireAtMs: frameMs + ENEMY_SHOT_INTERVAL_MS,
  };
}

export function calculateInterceptPoint(
  shooter: WorldPoint,
  target: WorldPoint,
  targetVelocity: WorldPoint,
  projectileSpeed: number,
  maximumLeadSeconds: number,
  turnRateDegPerSecond = 0,
  turnRemainingSeconds?: number,
): WorldPoint {
  if (Math.abs(turnRateDegPerSecond) > 0.001 && (turnRemainingSeconds ?? 1) > 0) {
    const motion = { position: target, velocity: targetVelocity, turnRateDegPerSecond, turnRemainingSeconds };
    let low = 0, high = maximumLeadSeconds;
    // Target speed is below torpedo speed, so the earliest intercept has one crossing.
    for (let i = 0; i < 32; i += 1) {
      const middle = (low + high) / 2;
      const position = predictTargetMotion(motion, middle).position;
      if (worldDistance(shooter, position) > projectileSpeed * middle) low = middle;
      else high = middle;
    }
    return predictTargetMotion(motion, high).position;
  }
  const relative = { x: target.x - shooter.x, y: target.y - shooter.y };
  const a =
    targetVelocity.x * targetVelocity.x +
    targetVelocity.y * targetVelocity.y -
    projectileSpeed * projectileSpeed;
  const b = 2 * (relative.x * targetVelocity.x + relative.y * targetVelocity.y);
  const c = relative.x * relative.x + relative.y * relative.y;
  const discriminant = b * b - 4 * a * c;
  let interceptSeconds = worldDistance(shooter, target) / projectileSpeed;

  if (Math.abs(a) < 0.0001) {
    if (Math.abs(b) > 0.0001) {
      const linearTime = -c / b;
      if (linearTime > 0) interceptSeconds = linearTime;
    }
  } else if (discriminant >= 0) {
    const root = Math.sqrt(discriminant);
    const times = [(-b - root) / (2 * a), (-b + root) / (2 * a)].filter(
      (time) => time > 0,
    );
    if (times.length > 0) interceptSeconds = Math.min(...times);
  }

  interceptSeconds = clamp(interceptSeconds, 0, maximumLeadSeconds);
  return {
    x: target.x + targetVelocity.x * interceptSeconds,
    y: target.y + targetVelocity.y * interceptSeconds,
  };
}

export function findIncomingThreat(
  navigation: EnemySubComponents["navigation"],
  intendedBearing: number,
  intendedSpeed: number,
  torpedoes: TorpedoEntity[],
): IncomingThreat | null {
  const currentVelocity = velocityFromNavigation(navigation);
  const intendedVelocity = velocityFromNavigation({
    headingDeg: intendedBearing,
    speedUnitsPerSecond: intendedSpeed,
  });
  let mostUrgent: IncomingThreat | null = null;

  for (const torpedo of torpedoes) {
    const torpedoPosition = torpedo.components.navigation.position;
    const torpedoVelocity = velocityFromNavigation(torpedo.components.navigation);
    const currentCourse = calculateClosestApproach(
      navigation.position,
      currentVelocity,
      torpedoPosition,
      torpedoVelocity,
    );
    const intendedCourse = calculateClosestApproach(
      navigation.position,
      intendedVelocity,
      torpedoPosition,
      torpedoVelocity,
    );
    const dangerousApproaches = [currentCourse, intendedCourse].filter(
      (approach) =>
        approach.timeToClosestSeconds <= ENEMY_EVASION_LOOKAHEAD_SECONDS &&
        approach.closestDistance <= ENEMY_EVASION_CLEARANCE,
    );
    if (worldDistance(navigation.position, torpedoPosition) <= ENEMY_EVASION_CLEARANCE) {
      dangerousApproaches.push({ timeToClosestSeconds: 0, closestDistance: 0 });
    }
    if (dangerousApproaches.length === 0) continue;

    const closest = dangerousApproaches.reduce((best, candidate) =>
      candidate.timeToClosestSeconds < best.timeToClosestSeconds ? candidate : best,
    );
    const threat: IncomingThreat = {
      torpedoPosition: { ...torpedoPosition },
      torpedoVelocity,
      ...closest,
    };
    if (
      !mostUrgent ||
      threat.timeToClosestSeconds < mostUrgent.timeToClosestSeconds ||
      (threat.timeToClosestSeconds === mostUrgent.timeToClosestSeconds &&
        threat.closestDistance < mostUrgent.closestDistance)
    ) {
      mostUrgent = threat;
    }
  }
  return mostUrgent;
}

function calculateClosestApproach(
  vesselPosition: WorldPoint,
  vesselVelocity: WorldPoint,
  torpedoPosition: WorldPoint,
  torpedoVelocity: WorldPoint,
) {
  const relativePosition = {
    x: torpedoPosition.x - vesselPosition.x,
    y: torpedoPosition.y - vesselPosition.y,
  };
  const relativeVelocity = {
    x: torpedoVelocity.x - vesselVelocity.x,
    y: torpedoVelocity.y - vesselVelocity.y,
  };
  const velocitySquared =
    relativeVelocity.x * relativeVelocity.x + relativeVelocity.y * relativeVelocity.y;
  const timeToClosestSeconds =
    velocitySquared < 0.0001
      ? Infinity
      : Math.max(
          0,
          -(
            relativePosition.x * relativeVelocity.x +
            relativePosition.y * relativeVelocity.y
          ) / velocitySquared,
        );
  const closestDistance = Number.isFinite(timeToClosestSeconds)
    ? Math.hypot(
        relativePosition.x + relativeVelocity.x * timeToClosestSeconds,
        relativePosition.y + relativeVelocity.y * timeToClosestSeconds,
      )
    : Math.hypot(relativePosition.x, relativePosition.y);
  return { timeToClosestSeconds, closestDistance };
}

export function chooseAvoidanceBearing(
  navigation: EnemySubComponents["navigation"],
  threat: IncomingThreat,
) {
  const torpedoBearing = normalizeDegrees(
    (Math.atan2(threat.torpedoVelocity.x, -threat.torpedoVelocity.y) * 180) / Math.PI,
  );
  const horizon = clamp(threat.timeToClosestSeconds, 0.75, 3);
  const torpedoFuture = {
    x: threat.torpedoPosition.x + threat.torpedoVelocity.x * horizon,
    y: threat.torpedoPosition.y + threat.torpedoVelocity.y * horizon,
  };
  const candidates = [
    normalizeDegrees(torpedoBearing - 90),
    normalizeDegrees(torpedoBearing + 90),
  ];
  const projectedDistances = candidates.map((candidate) =>
    worldDistance(
      projectPosition(navigation.position, candidate, THROTTLE_SPEEDS[2], horizon),
      torpedoFuture,
    ),
  );
  if (Math.abs(projectedDistances[0] - projectedDistances[1]) < 0.001) {
    return candidates.reduce((best, candidate) =>
      Math.abs(signedHeadingError(navigation.headingDeg, candidate)) <
      Math.abs(signedHeadingError(navigation.headingDeg, best))
        ? candidate
        : best,
    );
  }
  return projectedDistances[0] > projectedDistances[1] ? candidates[0] : candidates[1];
}

export function applySeparationBias(
  desiredBearing: number,
  enemy: EnemyEntity,
  enemies: EnemyEntity[],
) {
  let awayX = 0;
  let awayY = 0;
  let strongestWeight = 0;
  for (const other of enemies) {
    if (other.id === enemy.id || other.components.status.state !== "active") continue;
    const dx = enemy.components.navigation.position.x - other.components.navigation.position.x;
    const dy = enemy.components.navigation.position.y - other.components.navigation.position.y;
    const distance = Math.hypot(dx, dy);
    if (distance <= 0 || distance >= ENEMY_SEPARATION_RADIUS) continue;
    const weight = 1 - distance / ENEMY_SEPARATION_RADIUS;
    awayX += (dx / distance) * weight;
    awayY += (dy / distance) * weight;
    strongestWeight = Math.max(strongestWeight, weight);
  }
  if (strongestWeight === 0) return desiredBearing;
  const separationBearing = normalizeDegrees((Math.atan2(awayX, -awayY) * 180) / Math.PI);
  const bias =
    clamp(
      signedHeadingError(desiredBearing, separationBearing),
      -ENEMY_SEPARATION_MAX_BIAS_DEG,
      ENEMY_SEPARATION_MAX_BIAS_DEG,
    ) * strongestWeight;
  return normalizeDegrees(desiredBearing + bias);
}

export function velocityFromNavigation(navigation: {
  headingDeg: number;
  speedUnitsPerSecond: number;
}): WorldPoint {
  const radians = ((navigation.headingDeg - 90) * Math.PI) / 180;
  return {
    x: Math.cos(radians) * navigation.speedUnitsPerSecond,
    y: Math.sin(radians) * navigation.speedUnitsPerSecond,
  };
}

function projectPosition(
  position: WorldPoint,
  headingDeg: number,
  speed: number,
  seconds: number,
) {
  const velocity = velocityFromNavigation({ headingDeg, speedUnitsPerSecond: speed });
  return { x: position.x + velocity.x * seconds, y: position.y + velocity.y * seconds };
}

export function createEnemySubmarineLifecycleSystem(): System<World> {
  return {
    update(world) {
      const frameMs = performance.now();
      const enemies = (world.getEntities() as RadarEntity[]).filter(isEnemyVessel);
      for (const enemy of enemies) {
        if (
          enemy.components.status.state === "destroyed" &&
          enemy.components.status.destroyedAtMs !== null &&
          frameMs - enemy.components.status.destroyedAtMs >= CONTACT_DETONATION_MS
        ) {
          world.removeEntity(enemy.id);
        }
      }
    },
  };
}
