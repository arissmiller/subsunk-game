import { normalizeDegrees, worldDistance, type WorldPoint } from "../../engine/navigation";
import type { Entity } from "../../engine/types";
import type { World } from "../../engine/world";
import type {
  EnemySubComponents,
  BoatComponents,
  MineComponents,
  MineLayerComponents,
  PlayerComponents,
  RadarEntity,
  SonarPulse,
  TorpedoComponents,
  VesselNavigation,
} from "../../radarTypes";
import { SONAR_WAVE_SPEED } from "../config";

export type PlayerEntity = Entity<PlayerComponents>;
export type MineEntity = Entity<MineComponents>;
export type MineLayerEntity = Entity<MineLayerComponents>;
export type BoatEntity = Entity<BoatComponents>;
export type EnemyVesselEntity = Entity<EnemySubComponents | BoatComponents>;
export type EnemyEntity = Entity<EnemySubComponents>;
export type TorpedoEntity = Entity<TorpedoComponents>;

export const isPlayerEntity = (entity: RadarEntity): entity is PlayerEntity =>
  entity.components.kind === "player";
export const isMineEntity = (entity: RadarEntity): entity is MineEntity =>
  entity.components.kind === "mine";
export const isBoatEntity = (entity: RadarEntity): entity is BoatEntity =>
  entity.components.kind === "boat";
export const isEnemyVessel = (entity: RadarEntity): entity is EnemyVesselEntity =>
  entity.components.kind === "enemy-sub" || entity.components.kind === "boat";
export const isMineLayerEntity = (entity: RadarEntity): entity is MineLayerEntity =>
  entity.components.kind === "mine-layer";
export const isEnemyEntity = (entity: RadarEntity): entity is EnemyEntity =>
  entity.components.kind === "enemy-sub";
export const isTorpedoEntity = (entity: RadarEntity): entity is TorpedoEntity =>
  entity.components.kind === "torpedo";

export function requirePlayer(world: World) {
  const player = world.getEntity<PlayerComponents>("player");
  if (!player) throw new Error("Player entity is missing");
  return player;
}

export function isPlayerActive(player: PlayerEntity) {
  return player.components.status.state === "active";
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function degreesToRadians(angleDeg: number) {
  return (angleDeg * Math.PI) / 180;
}

export function signedHeadingError(currentDeg: number, targetDeg: number) {
  let error = normalizeDegrees(targetDeg - currentDeg);
  if (error > 180) error -= 360;
  return error;
}

export function advanceNavigation(
  navigation: VesselNavigation,
  targetSpeed: number,
  deltaSeconds: number,
  options: {
    acceleration: number;
    deceleration: number;
    minimumTurnRadius: number;
    targetBearing?: number;
  },
) {
  if (options.targetBearing !== undefined) {
    navigation.courseTurn = clamp(
      signedHeadingError(navigation.headingDeg, options.targetBearing) / 50,
      -1,
      1,
    );
  }

  const speedDelta = targetSpeed - navigation.speedUnitsPerSecond;
  if (Math.abs(speedDelta) > 0.001) {
    const rate = speedDelta > 0 ? options.acceleration : options.deceleration;
    const step = rate * deltaSeconds;
    navigation.speedUnitsPerSecond +=
      Math.sign(speedDelta) * Math.min(step, Math.abs(speedDelta));
  }

  if (navigation.courseTurn !== 0 && navigation.speedUnitsPerSecond > 0) {
    const turnRadius = options.minimumTurnRadius / Math.abs(navigation.courseTurn);
    const turnRate = (navigation.speedUnitsPerSecond / turnRadius) * (180 / Math.PI);
    navigation.headingDeg = normalizeDegrees(
      navigation.headingDeg + Math.sign(navigation.courseTurn) * turnRate * deltaSeconds,
    );
  }

  const heading = degreesToRadians(navigation.headingDeg - 90);
  const distance = navigation.speedUnitsPerSecond * deltaSeconds;
  navigation.position.x += Math.cos(heading) * distance;
  navigation.position.y += Math.sin(heading) * distance;
}

export function pulseRadiusAt(pulse: SonarPulse, frameMs: number) {
  return ((frameMs - pulse.emittedAtMs) / 1000) * SONAR_WAVE_SPEED;
}

export function echoReturnAt(frameMs: number, distance: number) {
  return frameMs + (distance / SONAR_WAVE_SPEED) * 1000;
}

export function pulseReached(pulse: SonarPulse, point: WorldPoint, frameMs: number) {
  return pulseRadiusAt(pulse, frameMs) >= worldDistance(pulse.origin, point);
}

export function advanceFixedCourse(navigation: VesselNavigation, distance: number, minimumTurnRadius: number) {
  // Integrate the fixed rudder arc exactly so firing solutions and movement agree
  // regardless of frame duration (including the player's plotted course).
  const heading = navigation.headingDeg * Math.PI / 180;
  const curvature = navigation.courseTurn / minimumTurnRadius;
  const angle = curvature * distance;
  const halfAngle = angle / 2;
  const chord = Math.abs(halfAngle) < 1e-8 ? distance : distance * Math.sin(halfAngle) / halfAngle;
  navigation.position.x += Math.sin(heading + halfAngle) * chord;
  navigation.position.y -= Math.cos(heading + halfAngle) * chord;
  navigation.headingDeg = normalizeDegrees(navigation.headingDeg + angle * 180 / Math.PI);
}
