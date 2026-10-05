import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("pixi.js", () => ({ Container: class { destroy() {} } }));
import type { SonarState, SonarPulse } from "../radarTypes";
import { World } from "../engine/world";
import { projectWorldToRadar } from "../engine/navigation";
import { createPlayerEntity, createPlayerSonarSystem } from "./entities/player";
import { createChunkSystem } from "./chunks";
import { createRadarWorld } from "./world";
import { gridCellAt, gridCellAlpha, updateGridCoverage, visibleGridEdges } from "./grid";
import { SONAR_WAVE_SPEED, CHUNK_SIZE } from "./config";

function pulse(owner: "player" | "enemy" = "player", emittedAtMs = 0): SonarPulse {
  return { sourceId: owner, owner, emittedAtMs, origin: { x: 50, y: 50 }, illuminatedContactIds: new Set() };
}
function state(pulses = [pulse()]): SonarState {
  return { coverage: new Map(), pulses, echoes: [], playerLastEmittedAtMs: 0 };
}
const origin = { x: 50, y: 50 };
afterEach(() => vi.restoreAllMocks());

describe("sonar grid", () => {
  it("aligns world cells across zero and chunk boundaries", () => {
    expect(gridCellAt({ x: -0.1, y: 100 })).toEqual({ x: -1, y: 1 });
    expect(gridCellAt({ x: -CHUNK_SIZE, y: CHUNK_SIZE })).toEqual({ x: -20, y: 20 });
  });

  it("waits for round-trip echo arrival without refreshing timestamps every frame", () => {
    const sonar = state();
    const arrival = 100 / SONAR_WAVE_SPEED * 2000;
    updateGridCoverage(sonar, arrival / 2, origin);
    expect(sonar.coverage.has("1,0")).toBe(false);
    updateGridCoverage(sonar, arrival - 1, origin);
    expect(sonar.coverage.has("1,0")).toBe(false);
    updateGridCoverage(sonar, arrival + 1, origin);
    expect(sonar.coverage.get("1,0")).toBeCloseTo(arrival);
    updateGridCoverage(sonar, 1000, origin);
    expect(sonar.coverage.get("1,0")).toBeCloseTo(arrival);
    sonar.pulses.push(pulse("player", 3000));
    updateGridCoverage(sonar, 4000, origin);
    expect(sonar.coverage.get("1,0")).toBeCloseTo(3000 + arrival);
  });

  it("caps coverage at sonar range and ignores enemy pulses", () => {
    const sonar = state([pulse("enemy")]);
    updateGridCoverage(sonar, 10000, origin);
    expect(sonar.coverage.size).toBe(0);
    sonar.pulses.push(pulse());
    updateGridCoverage(sonar, 10000, origin);
    expect(sonar.coverage.has("9,0")).toBe(true);
    expect(sonar.coverage.has("10,0")).toBe(false);
  });

  it("draws no grid in unscanned areas, and only the scanned cell outline", () => {
    expect(visibleGridEdges(origin, 1000, new Map(), 0)).toEqual([]);
    const edges = visibleGridEdges(origin, 1000, new Map([["0,0", 0]]), 0);
    expect(edges).toHaveLength(4);
    expect(edges.every((edge) => edge.alpha === 0.30)).toBe(true);
  });

  it("retains pulses until distant echoes return, then removes them", () => {
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const world = new World();
    const player = world.addEntity(createPlayerEntity());
    player.components.navigation.position = origin;
    const sonar = state();
    const system = createPlayerSonarSystem(sonar);
    now = 2000;
    system.update!(world, 2000);
    expect(sonar.pulses.some((p) => p.emittedAtMs === 0)).toBe(true);
    expect(sonar.coverage.has("9,0")).toBe(false);
    now = 3500;
    system.update!(world, 1500);
    expect(sonar.coverage.get("9,0")).toBeCloseTo(900 / SONAR_WAVE_SPEED * 2000);
    now = 3600;
    system.update!(world, 100);
    expect(sonar.pulses.some((p) => p.emittedAtMs === 0)).toBe(false);
    world.destroy();
  });

  it("fades highlights to a permanent scanned baseline", () => {
    const coverage = new Map<string, number>();
    expect(gridCellAlpha(coverage, 0, 0, 1000)).toBe(0);
    coverage.set("0,0", 1000);
    expect(gridCellAlpha(coverage, 0, 0, 1000)).toBeCloseTo(0.30);
    expect(gridCellAlpha(coverage, 0, 0, 1400)).toBeCloseTo(0.22);
    expect(gridCellAlpha(coverage, 0, 0, 1800)).toBeCloseTo(0.14);
    expect(gridCellAlpha(coverage, 0, 0, 100000)).toBeCloseTo(0.14);
  });

  it("finishes coverage before an expired pulse is removed on a long frame", () => {
    vi.spyOn(performance, "now").mockReturnValue(10000);
    const world = new World();
    const player = world.addEntity(createPlayerEntity());
    player.components.navigation.position = origin;
    const sonar = state();
    createPlayerSonarSystem(sonar).update!(world, 10000);
    expect(sonar.coverage.has("9,0")).toBe(true);
    expect(sonar.coverage.get("9,0")).toBeCloseTo(900 / SONAR_WAVE_SPEED * 2000);
    expect(sonar.pulses.some((p) => p.emittedAtMs === 0)).toBe(false);
  });

  it("retains loaded coverage, prunes departing chunks, and does not restore it from old pulses", () => {
    vi.spyOn(performance, "now").mockReturnValue(0);
    const world = new World();
    const player = world.addEntity(createPlayerEntity());
    const sonar = state([]);
    const chunks = createChunkSystem(sonar);
    chunks.attach!(world);
    sonar.coverage.set("-40,0", 0);
    sonar.coverage.set("0,0", 0);
    player.components.navigation.position.x = CHUNK_SIZE;
    chunks.update!(world, 0);
    expect(sonar.coverage.has("-40,0")).toBe(false);
    expect(sonar.coverage.has("0,0")).toBe(true);
    const oldPulse = pulse();
    oldPulse.origin = { x: -3950, y: 50 };
    sonar.pulses.push(oldPulse);
    updateGridCoverage(sonar, 10000, player.components.navigation.position);
    expect(sonar.coverage.has("-40,0")).toBe(false);
    player.components.navigation.position.x = 0;
    chunks.update!(world, 0);
    expect(sonar.coverage.has("-40,0")).toBe(false);
    chunks.destroy!(world);
    expect(sonar.coverage.size).toBe(0);
  });

  it("starts each game with independent empty coverage", () => {
    const first = createRadarWorld({ onGameOver() {} });
    first.sonar.coverage.set("0,0", 0);
    const second = createRadarWorld({ onGameOver() {} });
    expect(second.sonar.coverage.size).toBe(0);
    first.world.destroy();
    second.world.destroy();
  });

  it("draws shared edges once with the brighter neighbor and stable world positions", () => {
    const coverage = new Map([["0,0", 0]]);
    const edges = visibleGridEdges(origin, 1000, coverage, 1000);
    expect(new Set(edges.map((edge) => JSON.stringify([edge.from, edge.to]))).size).toBe(edges.length);
    const shared = edges.find((edge) => edge.from.x === 100 && edge.from.y === 0 && edge.to.y === 100)!;
    expect(shared.alpha).toBe(0.14);
    expect(visibleGridEdges(origin, 1000, coverage, 1000)).toEqual(edges);
    const moved = { x: 60, y: 50 };
    for (const radius of [140, 400]) {
      const before = projectWorldToRadar(500, radius, origin, shared.from);
      const after = projectWorldToRadar(500, radius, moved, shared.from);
      expect(after.x - before.x).toBeCloseTo(-10 * radius / 1000);
      expect(after.y).toBe(before.y);
    }
  });
});
