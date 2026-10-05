import type { WorldPoint } from "../engine/navigation";
import { ENEMY_CURVE_PREDICTION_SECONDS, VESSEL_MIN_TURN_RADIUS } from "../radar/config";
import { clamp, signedHeadingError } from "../radar/entities/shared";

export interface TargetMotion {
  position: WorldPoint;
  velocity: WorldPoint;
  turnRateDegPerSecond?: number;
  turnRemainingSeconds?: number;
}

// Infer turns only from returned observations, never from live player steering.
export function estimateTargetTurn(previous: { headingDeg: number; observedAtMs: number } | null,
  current: { headingDeg: number; observedAtMs: number; velocity: WorldPoint }) {
  if (!previous) return 0;
  const seconds = (current.observedAtMs - previous.observedAtMs) / 1000;
  const speed = Math.hypot(current.velocity.x, current.velocity.y);
  if (seconds <= 0 || seconds > ENEMY_CURVE_PREDICTION_SECONDS || speed < 5) return 0;
  const maximumRate = speed / VESSEL_MIN_TURN_RADIUS * 180 / Math.PI;
  return clamp(signedHeadingError(previous.headingDeg, current.headingDeg) / seconds, -maximumRate, maximumRate);
}

export function predictTargetMotion(target: TargetMotion, seconds: number): TargetMotion {
  seconds = Math.max(0, seconds);
  const rate = target.turnRateDegPerSecond ?? 0;
  const horizon = target.turnRemainingSeconds ?? ENEMY_CURVE_PREDICTION_SECONDS;
  const curvedSeconds = Math.min(seconds, horizon);
  const omega = rate * Math.PI / 180;
  const angle = omega * curvedSeconds;
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const velocity = {
    x: target.velocity.x * cos - target.velocity.y * sin,
    y: target.velocity.x * sin + target.velocity.y * cos,
  };
  const displacement = Math.abs(omega) < 1e-6
    ? { x: target.velocity.x * curvedSeconds, y: target.velocity.y * curvedSeconds }
    : {
      x: (target.velocity.x * sin + target.velocity.y * (cos - 1)) / omega,
      y: (target.velocity.x * (1 - cos) + target.velocity.y * sin) / omega,
    };
  const straightSeconds = seconds - curvedSeconds;
  return {
    position: { x: target.position.x + displacement.x + velocity.x * straightSeconds,
      y: target.position.y + displacement.y + velocity.y * straightSeconds },
    velocity,
    turnRateDegPerSecond: rate,
    turnRemainingSeconds: Math.max(0, horizon - curvedSeconds),
  };
}
