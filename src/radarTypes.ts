import type { WorldPoint } from "./engine/navigation";
import type { Entity } from "./engine/types";

export type ThrottleLevel = 0 | 1 | 2;
export type CollisionLayer = "player" | "hazard";
export type PlayerDetonationCause = "mine" | "enemy-sub" | "own-torpedo" | "depth-charge";
export type DetectionState = "hidden" | "ping" | "tracked";
export type TorpedoOwner = "player" | "enemy";

export interface VesselNavigation {
  position: WorldPoint;
  headingDeg: number;
  speedUnitsPerSecond: number;
  courseTurn: number;
}

export interface TorpedoBay {
  count: number;
  reloadStartMs: number | null;
}

export interface ContactDetection {
  state: DetectionState;
  revealedAtMs: number | null;
}

export interface PlayerComponents {
  kind: "player";
  collision: {
    layer: CollisionLayer;
    radiusUnits: number;
    collidesWith: CollisionLayer[];
  };
  status: {
    state: "active" | "detonating" | "destroyed";
    detonatedAtMs: number | null;
    detonationCause: PlayerDetonationCause | null;
  };
  navigation: VesselNavigation & { throttleLevel: ThrottleLevel };
  torpedoBay: TorpedoBay;
}

export interface MineComponents {
  kind: "mine";
  collision: {
    layer: CollisionLayer;
    radiusUnits: number;
    collidesWith: CollisionLayer[];
    isColliding: boolean;
    collidedAtMs: number | null;
  };
  position: WorldPoint;
  detection: ContactDetection;
  status: {
    state: "active" | "detonating" | "destroyed";
    detonatedAtMs: number | null;
  };
}

export interface MineLayerComponents {
  kind: "mine-layer";
  navigation: VesselNavigation;
  mineLayer: {
    lastLayedAtMs: number | null;
    nextLayIntervalMs: number;
    lastWanderTurnMs: number | null;
    wanderTurnIntervalMs: number;
  };
}

export interface EnemySubComponents {
  kind: "enemy-sub";
  navigation: VesselNavigation;
  detection: ContactDetection & {
    trackedUntilMs: number | null;
    lastKnownPosition: WorldPoint | null;
    lastKnownHeadingDeg: number | null;
    lastKnownCourse?: VesselNavigation;
  };
  status: {
    state: "active" | "destroyed";
    destroyedAtMs: number | null;
  };
  sonar: {
    lastEmittedAtMs: number | null;
    targetTrack: {
      position: WorldPoint;
      velocity: WorldPoint;
      headingDeg: number;
      observedAtMs: number;
      speedUnitsPerSecond?: number;
      turnRateDegPerSecond?: number;
    } | null;
  };
  torpedoBay: TorpedoBay;
  ai: {
    disengageBearing: number | null;
    disengageUntilMs: number;
    reengageUntilMs: number;
    reengageBearing: number | null;
    firingManeuver?: { phase: "aiming" | "returning"; returnBearing: number; untilMs: number } | null;
    nextManeuverAtMs?: number;
    shotsFiredInBurst: number;
    nextFireAtMs: number;
  };
}

export interface BoatComponents extends Pick<EnemySubComponents, "navigation" | "detection" | "status" | "sonar"> {
  kind: "boat";
  ai: { initialTarget: WorldPoint; lastEstimatedTarget: WorldPoint; nextFireAtMs: number; nextMineAtMs: number; lastTargetPingAtMs?: number };
}

export interface DepthChargeComponents {
  kind: "depth-charge";
  sourceId: string;
  position: WorldPoint;
  launchedAtMs: number;
  detonatedAtMs: number | null;
}

export interface TorpedoNavigation extends VesselNavigation {
  plottedHeadingDeg: number | null;
}

export interface TorpedoTrail {
  points: WorldPoint[];
  firedAtMs: number;
  durationMs: number;
  lengthUnits: number;
}

export interface TorpedoComponents {
  kind: "torpedo";
  owner: TorpedoOwner;
  sourceId: string;
  clearedSource: boolean;
  navigation: TorpedoNavigation;
  trail: TorpedoTrail;
}

export interface SonarPulse {
  rangeUnits?: number;
  sourceId: string;
  owner: TorpedoOwner;
  origin: WorldPoint;
  emittedAtMs: number;
  illuminatedContactIds: Set<string>;
}

export interface SonarEcho {
  sourceId: string;
  contactId: string;
  contactKind: "mine" | "enemy-sub" | "boat" | "player";
  contactPosition: WorldPoint;
  contactHeadingDeg: number | null;
  contactVelocity: WorldPoint | null;
  contactCourseTurn?: number;
  contactSpeedUnitsPerSecond?: number;
  contactTurnRateDegPerSecond?: number;
  observedAtMs: number;
  returnAtMs: number;
}

export interface SonarState {
  coverage: Map<string, number>;
  pulses: SonarPulse[];
  echoes: SonarEcho[];
  playerLastEmittedAtMs: number | null;
}

export type RadarEntity = Entity<
  | PlayerComponents
  | MineComponents
  | MineLayerComponents
  | EnemySubComponents
  | TorpedoComponents
  | BoatComponents
  | DepthChargeComponents
>;
