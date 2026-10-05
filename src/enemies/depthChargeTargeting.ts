import { BOAT_CHARGES_PER_SALVO, BOAT_SCATTER_RADIUS, DEPTH_CHARGE_SINK_MS } from "../radar/config";
import { predictTargetMotion, type TargetMotion } from "./targetMotion";

export function depthChargeAimPoint(track: TargetMotion, ageSeconds: number) {
  return predictTargetMotion(track, Math.max(0, ageSeconds) + DEPTH_CHARGE_SINK_MS / 1000).position;
}

export function calculateDepthChargeSalvo(track: TargetMotion, ageSeconds: number) {
  const center = depthChargeAimPoint(track, ageSeconds);
  return Array.from({ length: BOAT_CHARGES_PER_SALVO }, () => {
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.sqrt(Math.random()) * BOAT_SCATTER_RADIUS;
    return { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius };
  });
}
