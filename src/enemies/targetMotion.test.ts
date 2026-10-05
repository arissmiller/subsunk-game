import { describe, expect, it } from "vitest";
import { worldDistance } from "../engine/navigation";
import { estimateTargetTurn, predictTargetMotion } from "./targetMotion";
import { calculateInterceptPoint, canMakeFiringDetour } from "./submarine";

describe("curved target prediction", () => {
  it("estimates signed turns across north only from successive observations", () => {
    const current = { headingDeg: 10, observedAtMs: 3000, velocity: { x: 0, y: -100 } };
    expect(estimateTargetTurn(null, current)).toBe(0);
    expect(estimateTargetTurn({ headingDeg: 350, observedAtMs: 0 }, current)).toBeCloseTo(20 / 3);
    expect(estimateTargetTurn({ headingDeg: 30, observedAtMs: 0 }, current)).toBeCloseTo(-20 / 3);
    expect(estimateTargetTurn({ headingDeg: 350, observedAtMs: 3000 }, current)).toBe(0);
    expect(estimateTargetTurn({ headingDeg: 350, observedAtMs: -10000 }, current)).toBe(0);
  });

  it("predicts clockwise and counterclockwise arcs and their new velocity", () => {
    for (const direction of [-1, 1]) {
      const result = predictTargetMotion({ position: { x: 0, y: 0 }, velocity: { x: 0, y: -100 }, turnRateDegPerSecond: direction * 90 }, 1);
      expect(result.position.x).toBeCloseTo(direction * 200 / Math.PI);
      expect(result.position.y).toBeCloseTo(-200 / Math.PI);
      expect(result.velocity.x).toBeCloseTo(direction * 100);
      expect(result.velocity.y).toBeCloseTo(0);
    }
  });

  it("caps curved extrapolation and continues along the final tangent", () => {
    const target = { position: { x: 10, y: 20 }, velocity: { x: 0, y: -100 }, turnRateDegPerSecond: 15 };
    const six = predictTargetMotion(target, 6);
    const nine = predictTargetMotion(target, 9);
    expect(nine.position.x).toBeCloseTo(six.position.x + 300);
    expect(nine.position.y).toBeCloseTo(six.position.y);
    expect(nine.turnRemainingSeconds).toBe(0);
    expect(predictTargetMotion(six, 3)).toEqual(nine);
  });

  it("intercepts a turning target instead of its straight-line projection", () => {
    const shooter = { x: 0, y: 0 };
    const target = { position: { x: 0, y: -500 }, velocity: { x: 180, y: 0 }, turnRateDegPerSecond: 30 };
    const hit = calculateInterceptPoint(shooter, target.position, target.velocity, 360, 10, 30, 6);
    const time = worldDistance(shooter, hit) / 360;
    expect(worldDistance(hit, predictTargetMotion(target, time).position)).toBeLessThan(0.001);
    const straight = calculateInterceptPoint(shooter, target.position, target.velocity, 360, 10);
    expect(worldDistance(straight, predictTargetMotion(target, worldDistance(shooter, straight) / 360).position)).toBeGreaterThan(50);
  });
});

describe("short firing detours", () => {
  const target = { position: { x: 0, y: -500 }, velocity: { x: 0, y: 0 } };
  it("accepts a short turn and return using real movement limits", () => {
    expect(canMakeFiringDetour({ position: { x: 0, y: 0 }, headingDeg: 170, speedUnitsPerSecond: 180, courseTurn: 0 }, target, 170, 85)).toBe(true);
  });
  it("rejects turns that are too slow and out-of-range shots", () => {
    for (const [heading, speed] of [[170, 0]]) {
      expect(canMakeFiringDetour({ position: { x: 0, y: 0 }, headingDeg: heading, speedUnitsPerSecond: speed, courseTurn: 0 }, target, heading, 85)).toBe(false);
    }
    expect(canMakeFiringDetour({ position: { x: 0, y: 0 }, headingDeg: 170, speedUnitsPerSecond: 180, courseTurn: 0 }, { ...target, position: { x: 0, y: -900 } }, 45, 180)).toBe(false);
  });
});
