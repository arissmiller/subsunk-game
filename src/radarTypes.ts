import type { Container, Graphics, Sprite, Text } from "pixi.js";
import type { WorldPoint } from "./engine/navigation";
import type { Entity } from "./engine/types";

export type RadarContactKind = "enemy" | "torpedo";
export type RadarContactState = "hidden" | "ping" | "marker";
export type ThrottleLevel = 0 | 1 | 2;
export type CollisionLayer = "player" | "hazard";
export type PlayerDetonationCause = "mine" | "enemy-sub";

export interface PlayerComponents {
  kind: "player";
  sprite?: Sprite;
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
  navigation: {
    position: WorldPoint;
    headingDeg: number;
    throttleLevel: ThrottleLevel;
    speedUnitsPerSecond: number;
    courseTurn: number;
  };
  torpedoBay: {
    count: number;
    reloadStartMs: number | null;
  };
}

export interface MineComponents {
  kind: "mine";
  sprite?: Sprite | Graphics;
  collision: {
    layer: CollisionLayer;
    radiusUnits: number;
    collidesWith: CollisionLayer[];
    isColliding: boolean;
    collidedAtMs: number | null;
  };
  position: WorldPoint;
  detection: {
    state: "hidden" | "ping" | "tracked";
    revealedAtMs: number | null;
  };
  status: {
    state: "active" | "detonating" | "destroyed";
    detonatedAtMs: number | null;
  };
}

export interface TorpedoComponents {
  kind: "torpedo";
  trail: {
    start: WorldPoint;
    target: WorldPoint;
    firedAtMs: number;
    durationMs: number;
    lengthUnits: number;
    graphic?: Graphics;
    clickScreenPos: { x: number; y: number };
  };
}

export interface MineLayerComponents {
  kind: "mine-layer";
  navigation: {
    position: WorldPoint;
    headingDeg: number;
    speedUnitsPerSecond: number;
    courseTurn: number;
  };
  mineLayer: {
    lastLayedAtMs: number | null;
    nextLayIntervalMs: number;
    lastWanderTurnMs: number | null;
    wanderTurnIntervalMs: number;
  };
}

export interface EnemySubComponents {
  kind: "enemy-sub";
  sprite?: Sprite;
  navigation: {
    position: WorldPoint;
    headingDeg: number;
    speedUnitsPerSecond: number;
    courseTurn: number;
  };
  detection: {
    state: "hidden" | "ping" | "tracked";
    revealedAtMs: number | null;
    trackedUntilMs: number | null;
  };
  status: {
    state: "active" | "destroyed";
    destroyedAtMs: number | null;
  };
  ai: {
    engagementRangeUnits: number;
    lastFiredAtMs: number | null;
    fireIntervalMs: number;
  };
}

export interface EnemyTorpedoComponents {
  kind: "enemy-torpedo";
  trail: {
    start: WorldPoint;
    target: WorldPoint;
    firedAtMs: number;
    durationMs: number;
    lengthUnits: number;
    graphic?: Graphics;
  };
}

export interface RadarContactComponents {
  kind: "radar-contact";
  radarContact: {
    contactKind: RadarContactKind;
    angleDeg: number;
    radiusPct: number;
    state: RadarContactState;
    revealedAtMs: number | null;
    graphic?: Graphics;
  };
}

export type RadarEntity = Entity<
  | PlayerComponents
  | MineComponents
  | RadarContactComponents
  | TorpedoComponents
  | MineLayerComponents
  | EnemySubComponents
  | EnemyTorpedoComponents
>;

export interface RadarView {
  contentLayer: Container;
  overlayLayer: Container;
  background: Graphics;
  grid: Graphics;
  rings: Graphics;
  sweepTrail: Graphics;
  sweepLineGlow: Graphics;
  sweepLine: Graphics;
  detectionBlips: Graphics;
  collisionEffects: Graphics;
  ticks: Graphics;
  contactsLayer: Graphics;
  coursePlot: Graphics;
  crosshairLayer: Graphics;
  labels: Text[];
  frame: Graphics;
  mask: Graphics;
}
