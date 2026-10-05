import { describe, expect, it } from "vitest";
import { worldDistance } from "../engine/navigation";
import { TORPEDO_MIN_TURN_RADIUS, TORPEDO_SPEED } from "../radar/config";
import { advanceAlongCourse, createTorpedo } from "../radar/entities/torpedoes";
import { calculateTorpedoSolution } from "./torpedoSolution";
import { predictTargetMotion } from "./targetMotion";

const source = { position: { x: 0, y: 0 }, headingDeg: 0, courseTurn: 0, speedUnitsPerSecond: 85 };

describe("tight torpedo trajectories", () => {
  it.each([-1, 1])("uses full rudder for a broadside target in direction %s", (direction) => {
    const target = { position: { x: direction * 440, y: 0 }, velocity: { x: 0, y: 0 } };
    const solution = calculateTorpedoSolution(source, target)!;
    expect(solution).not.toBeNull();
    expect(solution.courseTurn).toBeCloseTo(direction, 10);
    expect(solution.seconds).toBeCloseTo(Math.PI * TORPEDO_MIN_TURN_RADIUS / TORPEDO_SPEED, 10);
    const shot = createTorpedo("enemy", "sub", source, 0, solution.courseTurn);
    for (let frame = 0; frame < 120; frame++) {
      advanceAlongCourse(shot.components, solution.seconds / 120);
      // Independently verify every point lies on the minimum-radius circle.
      expect(worldDistance(shot.components.navigation.position, { x: direction * 220, y: 0 })).toBeCloseTo(220, 8);
      if (frame === 59) {
        expect(shot.components.navigation.position.x).toBeCloseTo(direction * 220, 8);
        expect(shot.components.navigation.position.y).toBeCloseTo(-220, 8);
      }
    }
    expect(worldDistance(shot.components.navigation.position, target.position)).toBeLessThan(1e-6);
    expect(shot.components.navigation.headingDeg).toBeCloseTo(180, 8);
  });

  it.each([-1, 1])("intercepts behind the beam with a long arc in direction %s", (direction) => {
    const target = { position: { x: direction * 220, y: 220 }, velocity: { x: 0, y: 0 } };
    const solution = calculateTorpedoSolution(source, target)!;
    expect(solution).not.toBeNull();
    expect(Math.abs(solution.courseTurn)).toBeCloseTo(1, 10);
    const shot = createTorpedo("enemy", "sub", source, 0, solution.courseTurn);
    advanceAlongCourse(shot.components, solution.seconds);
    expect(worldDistance(shot.components.navigation.position, target.position)).toBeLessThan(1e-6);
  });

  it.each([-1, 1])("leads a turning target on a tight arc in direction %s", (direction) => {
    const target = { position: { x: direction * 450, y: -50 }, velocity: { x: 0, y: 60 }, turnRateDegPerSecond: -direction * 15 };
    const solution = calculateTorpedoSolution(source, target)!;
    expect(solution).not.toBeNull();
    expect(Math.abs(solution.courseTurn)).toBeGreaterThan(0.8);
    const shot = createTorpedo("enemy", "sub", source, 0, solution.courseTurn);
    // Uneven frame durations must preserve the same arc and intercept.
    for (const fraction of [0.01, 0.13, 0.06, 0.3, 0.5]) advanceAlongCourse(shot.components, solution.seconds * fraction);
    expect(worldDistance(shot.components.navigation.position, predictTargetMotion(target, solution.seconds).position)).toBeLessThan(1e-6);
  });

  it("rejects an impossible turn and a target directly astern", () => {
    for (const position of [{ x: 200, y: 0 }, { x: 0, y: 500 }]) {
      expect(calculateTorpedoSolution(source, { position, velocity: { x: 0, y: 0 } })).toBeNull();
    }
  });
});
