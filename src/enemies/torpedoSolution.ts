import { worldBearingDeg, worldDistance } from "../engine/navigation";
import type { VesselNavigation } from "../radarTypes";
import { TORPEDO_FUSE_MS, TORPEDO_MIN_TURN_RADIUS, TORPEDO_SPEED } from "../radar/config";
import { signedHeadingError } from "../radar/entities/shared";
import { predictTargetMotion, type TargetMotion } from "./targetMotion";

// A circle tangent to the bow and passing through a point turns through twice
// the bearing offset. Solve its travel time against the predicted target motion.
export function calculateTorpedoSolution(source: VesselNavigation, target: TargetMotion) {
  const at = (seconds: number) => {
    const position = predictTargetMotion(target, seconds).position;
    const distance = worldDistance(source.position, position);
    const offset = signedHeadingError(source.headingDeg, worldBearingDeg(source.position, position)) * Math.PI / 180;
    const arcLength = Math.abs(offset) < 1e-8 ? distance : distance * offset / Math.sin(offset);
    return { seconds, position, offset, courseTurn: distance > 0 ? 2 * Math.sin(offset) * TORPEDO_MIN_TURN_RADIUS / distance : 0,
      error: arcLength - TORPEDO_SPEED * seconds };
  };
  let previous = at(0);
  // Scan before refining: a turning target need not yield a monotonic residual.
  for (let step = 1; step <= 100; step += 1) {
    const current = at(step * TORPEDO_FUSE_MS / 1000 / 100);
    if (previous.error > 0 && current.error <= 0) {
      let low = previous.seconds, high = current.seconds;
      for (let iteration = 0; iteration < 32; iteration += 1) {
        const middle = (low + high) / 2;
        if (at(middle).error > 0) low = middle;
        else high = middle;
      }
      const solution = at(high);
      if (Math.abs(solution.error) < 1e-5 && Math.abs(solution.courseTurn) <= 1 && solution.seconds < TORPEDO_FUSE_MS / 1000) return solution;
    }
    previous = current;
  }
  return null;
}
