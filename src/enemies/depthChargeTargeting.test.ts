import { afterEach, describe, expect, it, vi } from "vitest";
import { worldDistance } from "../engine/navigation";
import { BOAT_SCATTER_RADIUS } from "../radar/config";
import { calculateDepthChargeSalvo, depthChargeAimPoint } from "./depthChargeTargeting";
import { predictTargetMotion } from "./targetMotion";

afterEach(() => vi.restoreAllMocks());
describe("ping course scatter", () => {
  it.each([-30, 0, 30])("leads the captured course with turn rate %s", turnRateDegPerSecond => {
    const track = { position: { x: 10, y: 20 }, velocity: { x: 180, y: 0 }, turnRateDegPerSecond };
    const center = depthChargeAimPoint(track, 2);
    expect(center).toEqual(predictTargetMotion(track, 5).position);
    const random = vi.spyOn(Math, "random").mockReturnValue(0.25);
    const salvo = calculateDepthChargeSalvo(track, 2);
    expect(salvo).toHaveLength(5);
    expect(random).toHaveBeenCalledTimes(10);
    for (const point of salvo) {
      expect(point.x).toBeCloseTo(center.x);
      expect(point.y).toBeCloseTo(center.y + BOAT_SCATTER_RADIUS / 2);
    }
  });

  it("keeps randomized charges within the scatter disk", () => {
    const track = { position: { x: 0, y: 0 }, velocity: { x: 0, y: -85 }, turnRateDegPerSecond: 10 };
    const center = depthChargeAimPoint(track, 1);
    for (let i = 0; i < 100; i++) {
      for (const point of calculateDepthChargeSalvo(track, 1)) expect(worldDistance(point, center)).toBeLessThanOrEqual(BOAT_SCATTER_RADIUS);
    }
  });
});
