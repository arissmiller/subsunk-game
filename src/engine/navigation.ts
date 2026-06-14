export interface WorldPoint {
  x: number;
  y: number;
}

export const RADAR_WORLD_RADIUS_UNITS = 1000;

export function worldDelta(from: WorldPoint, to: WorldPoint) {
  return {
    x: to.x - from.x,
    y: to.y - from.y,
  };
}

export function worldBearingDeg(from: WorldPoint, to: WorldPoint) {
  const delta = worldDelta(from, to);
  const radians = Math.atan2(delta.x, -delta.y);
  return normalizeDegrees((radians * 180) / Math.PI);
}

export function worldDistance(from: WorldPoint, to: WorldPoint) {
  const delta = worldDelta(from, to);
  return Math.hypot(delta.x, delta.y);
}

export function projectWorldToRadar(
  center: number,
  radarRadiusPx: number,
  origin: WorldPoint,
  target: WorldPoint,
  worldRadiusUnits = RADAR_WORLD_RADIUS_UNITS,
) {
  const delta = worldDelta(origin, target);
  const scale = radarRadiusPx / worldRadiusUnits;

  return {
    x: center + delta.x * scale,
    y: center + delta.y * scale,
  };
}

export function clampWorldToRadarRadius(
  origin: WorldPoint,
  target: WorldPoint,
  worldRadiusUnits = RADAR_WORLD_RADIUS_UNITS,
) {
  const delta = worldDelta(origin, target);
  const distance = Math.hypot(delta.x, delta.y);

  if (distance <= worldRadiusUnits || distance === 0) {
    return target;
  }

  const ratio = worldRadiusUnits / distance;

  return {
    x: origin.x + delta.x * ratio,
    y: origin.y + delta.y * ratio,
  };
}

export function normalizeDegrees(angleDeg: number) {
  return ((angleDeg % 360) + 360) % 360;
}
