import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("pixi.js", () => ({ Container: class { destroy() {} } }));
import { World } from "../engine/world";
import { worldDistance } from "../engine/navigation";
import type { DepthChargeComponents, RadarEntity, SonarState } from "../radarTypes";
import { createPlayerEntity, createPlayerSonarSystem } from "../radar/entities/player";
import { createMine, createDetonationLifecycleSystem } from "../radar/entities/mines";
import { createTorpedo, createTorpedoSystem } from "../radar/entities/torpedoes";
import { createDepthCharge, createDepthChargeSystem } from "../radar/entities/depthCharges";
import { createChunkSystem } from "../radar/chunks";
import { isBoatEntity, isEnemyEntity, isMineEntity } from "../radar/entities/shared";
import { BOAT_FIRE_RANGE, BOAT_MIN_FIRE_RANGE, BOAT_MINE_INTERVAL_MS, BOAT_MINE_SPACING, MINE_COLLISION_RADIUS } from "../radar/config";
import { BOAT_COLLISION_RADIUS, BOAT_SPEED, DEPTH_CHARGE_SINK_MS, CONTACT_DETONATION_MS, PLAYER_DETONATION_MS } from "../radar/config";
import { predictTargetMotion } from "./targetMotion";
import { getGameOverMessage } from "../gameOverScene";
import { createBoat, createBoatBehaviorSystem, boatNavigationIntent } from "./boat";
import { acquireEnemyTarget, createEnemySubmarine, createEnemySubmarineSonarSystem, createEnemySubmarineLifecycleSystem } from "./submarine";

function setup(position = { x: 0, y: -1300 }) {
  let now = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  const world = new World();
  const player = world.addEntity(createPlayerEntity());
  const boat = world.addEntity(createBoat(world, "boat", position));
  const sonar: SonarState = { pulses: [], echoes: [], coverage: new Map(), playerLastEmittedAtMs: null };
  const charges = () => world.getEntities<DepthChargeComponents>().filter((e) => e.components.kind === "depth-charge");
  return { world, player, boat, sonar, charges, time: (value: number) => { now = value; } };
}
function track(subject: ReturnType<typeof setup>, observedAtMs = 0) {
  subject.boat.components.sonar.targetTrack = { position: { x: 0, y: 0 }, velocity: { x: 0, y: 0 }, headingDeg: 0, observedAtMs };
}
afterEach(() => vi.restoreAllMocks());

describe("ship mine laying", () => {
  it.each([0, 90, 180, 270])("drops a row of three hidden mines clear of the stern at heading %s", heading => {
    const s = setup();
    const nav = s.boat.components.navigation;
    nav.headingDeg = heading;
    nav.speedUnitsPerSecond = BOAT_SPEED;
    const system = createBoatBehaviorSystem();
    const mines = () => (s.world.getEntities() as RadarEntity[]).filter(isMineEntity);
    s.time(BOAT_MINE_INTERVAL_MS - 1);
    system.update!(s.world, 0);
    expect(mines()).toHaveLength(0);
    s.time(BOAT_MINE_INTERVAL_MS);
    system.update!(s.world, 0);
    expect(mines()).toHaveLength(3);
    const mine = mines()[1].components;
    const offset = BOAT_COLLISION_RADIUS + MINE_COLLISION_RADIUS + 20;
    expect(mine.position.x).toBeCloseTo(nav.position.x - Math.sin(heading * Math.PI / 180) * offset);
    expect(mine.position.y).toBeCloseTo(nav.position.y + Math.cos(heading * Math.PI / 180) * offset);
    expect(mine.detection.state).toBe("hidden");
    expect(mine.status.state).toBe("active");
    for (const [index, entity] of mines().entries()) {
      expect(entity.components.position.x).toBeCloseTo(mine.position.x + Math.cos(heading * Math.PI / 180) * (index - 1) * BOAT_MINE_SPACING);
      expect(entity.components.position.y).toBeCloseTo(mine.position.y + Math.sin(heading * Math.PI / 180) * (index - 1) * BOAT_MINE_SPACING);
    }
    expect(BOAT_MINE_INTERVAL_MS).toBe(4000);
    // A stalled ship cannot pile up mines, even after a long frame gap.
    s.time(BOAT_MINE_INTERVAL_MS * 10);
    system.update!(s.world, 0);
    expect(mines()).toHaveLength(3);
    nav.position.x += 600;
    s.time(BOAT_MINE_INTERVAL_MS * 11);
    system.update!(s.world, 0);
    expect(mines()).toHaveLength(6);
    s.boat.components.status.state = "destroyed";
    nav.position.x += 600;
    s.time(BOAT_MINE_INTERVAL_MS * 12);
    system.update!(s.world, 0);
    expect(mines()).toHaveLength(6);
    s.world.destroy();
  });

  it("does not lay mines while stopped or after the player is lost", () => {
    const s = setup();
    const system = createBoatBehaviorSystem();
    s.time(BOAT_MINE_INTERVAL_MS);
    system.update!(s.world, 0);
    expect((s.world.getEntities() as RadarEntity[]).filter(isMineEntity)).toHaveLength(0);
    s.boat.components.navigation.speedUnitsPerSecond = BOAT_SPEED;
    s.player.components.status.state = "destroyed";
    s.time(BOAT_MINE_INTERVAL_MS * 2);
    system.update!(s.world, 0);
    expect((s.world.getEntities() as RadarEntity[]).filter(isMineEntity)).toHaveLength(0);
    s.world.destroy();
  });
});

describe("boat targeting and movement", () => {
  it.each([0, 180])("fires a full salvo at the range edge with outward target speed %s", speed => {
    const s = setup({ x: 0, y: -BOAT_FIRE_RANGE });
    track(s);
    s.boat.components.sonar.targetTrack!.velocity.y = speed;
    s.time(2000);
    // Every random sample points outward, so filtering would discard all five.
    vi.spyOn(Math, "random").mockReturnValue(0.25);
    const system = createBoatBehaviorSystem();
    system.update!(s.world, 0);
    expect(s.charges()).toHaveLength(5);
    for (const charge of s.charges()) {
      expect(worldDistance(s.boat.components.navigation.position, charge.components.position)).toBeCloseTo(BOAT_FIRE_RANGE, 8);
    }
    system.update!(s.world, 0);
    expect(s.charges()).toHaveLength(5);
    s.world.destroy();
  });

  it("still withholds fire inside the minimum range", () => {
    const s = setup({ x: 0, y: -BOAT_MIN_FIRE_RANGE + 1 });
    track(s);
    createBoatBehaviorSystem().update!(s.world, 0);
    expect(s.charges()).toHaveLength(0);
    s.world.destroy();
  });

  it("delivers captured speed and turn rate to ships and subs only when the echo returns", () => {
    const s = setup({ x: 0, y: -500 });
    const sub = s.world.addEntity(createEnemySubmarine(s.world, "sub", { x: 0, y: -500 }));
    const nav = s.player.components.navigation;
    nav.headingDeg = 90;
    nav.speedUnitsPerSecond = 180;
    nav.courseTurn = -0.5;
    const system = createEnemySubmarineSonarSystem(s.sonar);
    system.update!(s.world, 0);
    s.time(1000);
    system.update!(s.world, 0);
    expect(s.boat.components.sonar.targetTrack).toBeNull();
    expect(sub.components.sonar.targetTrack).toBeNull();
    nav.headingDeg = 180;
    nav.speedUnitsPerSecond = 0;
    nav.courseTurn = 1;
    s.time(2000);
    system.update!(s.world, 0);
    for (const vessel of [s.boat, sub]) {
      const snapshot = vessel.components.sonar.targetTrack!;
      expect(snapshot.headingDeg).toBe(90);
      expect(snapshot.speedUnitsPerSecond).toBe(180);
      expect(snapshot.turnRateDegPerSecond).toBeCloseTo(-0.5 * 180 / 220 * 180 / Math.PI);
      expect(snapshot.observedAtMs).toBe(1000);
    }
    expect(acquireEnemyTarget(s.world, sub, 2000)).toEqual(predictTargetMotion(sub.components.sonar.targetTrack!, 1));
    s.world.destroy();
  });

  it("waits for a long-range echo and stores measured player velocity", () => {
    const s = setup({ x: 0, y: -1800 });
    s.player.components.navigation.speedUnitsPerSecond = 85;
    s.player.components.navigation.headingDeg = 90;
    const sonarSystem = createEnemySubmarineSonarSystem(s.sonar);
    sonarSystem.update!(s.world, 0);
    expect(s.sonar.pulses[0].rangeUnits).toBe(2400);
    s.time(3500);
    sonarSystem.update!(s.world, 0);
    expect(s.boat.components.sonar.targetTrack).toBeNull();
    expect(s.sonar.echoes).toHaveLength(1);
    s.time(7000);
    sonarSystem.update!(s.world, 0);
    expect(s.boat.components.sonar.targetTrack?.velocity.x).toBeCloseTo(85);
    expect(s.sonar.coverage.size).toBe(0);
  });

  it("reveals boats to player sonar only on echo return", () => {
    const s = setup({ x: 0, y: -500 });
    s.boat.components.navigation.speedUnitsPerSecond = 110;
    s.boat.components.navigation.courseTurn = 0.5;
    const observed = { ...s.boat.components.navigation, position: { ...s.boat.components.navigation.position } };
    const system = createPlayerSonarSystem(s.sonar);
    system.update!(s.world, 0);
    s.time(1000);
    system.update!(s.world, 0);
    expect(s.boat.components.detection.state).toBe("hidden");
    expect(s.sonar.echoes[0].contactKind).toBe("boat");
    expect(s.boat.components.detection.lastKnownCourse).toBeUndefined();
    s.boat.components.navigation.courseTurn = -1;
    s.boat.components.navigation.speedUnitsPerSecond = 0;
    s.time(2000);
    system.update!(s.world, 0);
    expect(s.boat.components.detection.state).toBe("ping");
    expect(s.boat.components.detection.lastKnownCourse).toEqual(observed);
    expect(s.boat.components.detection.lastKnownPosition).toEqual({ x: 0, y: -500 });
  });

  it.each([0, 90, 180, 270])("fires a locked predicted salvo at heading %s", (heading) => {
    const s = setup();
    track(s);
    s.boat.components.sonar.targetTrack!.velocity = { x: 50, y: 0 };
    s.boat.components.navigation.headingDeg = heading;
    s.time(2000);
    vi.spyOn(Math, "random").mockReturnValue(0);
    const system = createBoatBehaviorSystem();
    system.update!(s.world, 16);
    expect(s.charges()).toHaveLength(5);
    expect(s.charges()[0].components.position).toEqual({ x: 250, y: 0 });
    const lockedPositions = s.charges().map(charge => ({ ...charge.components.position }));
    s.player.components.navigation.position.x = 500;
    s.time(3000);
    system.update!(s.world, 16);
    expect(s.charges()).toHaveLength(5);
    expect(s.charges().map(charge => charge.components.position)).toEqual(lockedPositions);
    s.time(8000);
    system.update!(s.world, 16);
    expect(s.charges()).toHaveLength(5);
    track(s, 8000);
    system.update!(s.world, 16);
    expect(s.charges()).toHaveLength(10);
  });

  it("suppresses firing without fresh tracks or when the contact is beyond range", () => {
    const s = setup();
    const system = createBoatBehaviorSystem();
    system.update!(s.world, 16);
    expect(s.charges()).toHaveLength(0);
    track(s);
    s.time(10001);
    system.update!(s.world, 16);
    expect(s.charges()).toHaveLength(0);
    track(s, 10001);
    s.boat.components.sonar.targetTrack!.position.x = 2000;
    system.update!(s.world, 16);
    expect(s.charges()).toHaveLength(0);
  });

  it("retreats, holds, approaches, and keeps below submarine top speed", () => {
    expect(boatNavigationIntent({ x: 0, y: -1000 }, { x: 0, y: 0 }, true)).toEqual({ bearing: 0, speed: 110 });
    expect(boatNavigationIntent({ x: 0, y: -1300 }, { x: 0, y: 0 }, true).speed).toBe(0);
    expect(boatNavigationIntent({ x: 0, y: -1600 }, { x: 0, y: 0 }, true)).toEqual({ bearing: 180, speed: 110 });
    const s = setup();
    const system = createBoatBehaviorSystem();
    s.player.components.navigation.position.x = 1000;
    for (let i = 0; i < 200; i++) system.update!(s.world, 16);
    expect(s.boat.components.navigation.position.y).toBeGreaterThan(-1300);
    expect(s.boat.components.navigation.position.x).toBeCloseTo(0);
    expect(s.boat.components.navigation.speedUnitsPerSecond).toBeLessThanOrEqual(BOAT_SPEED);
  });

  it("continues toward its last estimated target after the track expires", () => {
    const s = setup();
    track(s);
    s.boat.components.sonar.targetTrack!.velocity.x = 10;
    s.time(1000);
    const system = createBoatBehaviorSystem();
    system.update!(s.world, 0);
    expect(s.boat.components.ai.lastEstimatedTarget).toEqual({ x: 10, y: 0 });
    s.time(11000);
    system.update!(s.world, 1000);
    expect(s.boat.components.ai.lastEstimatedTarget).toEqual({ x: 10, y: 0 });
    expect(s.boat.components.navigation.speedUnitsPerSecond).toBeGreaterThan(0);
    expect(s.charges()).toHaveLength(5);
  });

  it("steers inward and clamps to the loaded-area inset", () => {
    const s = setup({ x: 5990, y: 0 });
    s.boat.components.navigation.headingDeg = 90;
    s.boat.components.navigation.speedUnitsPerSecond = BOAT_SPEED;
    createBoatBehaviorSystem().update!(s.world, 1000);
    expect(s.boat.components.navigation.position.x).toBeLessThanOrEqual(6000 - BOAT_COLLISION_RADIUS);
    expect(s.boat.components.navigation.courseTurn).not.toBe(0);
  });


});

describe("depth charge combat", () => {
  it("waits for sinking, damages all vessel kinds and mines once, then cleans up", () => {
    const s = setup({ x: 100, y: 0 });
    const sub = s.world.addEntity(createEnemySubmarine(s.world, "sub", { x: -100, y: 0 }));
    const mine = s.world.addEntity(createMine("mine", 0, 80));
    const safeMine = s.world.addEntity(createMine("safe", 0, 150));
    const charge = s.world.addEntity(createDepthCharge(s.boat.id, { x: 0, y: 0 }, 0));
    s.world.addEntity(createDepthCharge(s.boat.id, { x: 0, y: 0 }, 0));
    const system = createDepthChargeSystem();
    s.time(DEPTH_CHARGE_SINK_MS - 1);
    system.update!(s.world, 0);
    expect(s.player.components.status.state).toBe("active");
    s.time(DEPTH_CHARGE_SINK_MS);
    system.update!(s.world, 0);
    expect(s.player.components.status.detonationCause).toBe("depth-charge");
    expect(sub.components.status.state).toBe("destroyed");
    expect(s.boat.components.status.state).toBe("destroyed");
    expect(mine.components.status.state).toBe("detonating");
    expect(safeMine.components.status.state).toBe("active");
    s.time(DEPTH_CHARGE_SINK_MS + 1);
    system.update!(s.world, 0);
    expect(s.boat.components.status.destroyedAtMs).toBe(DEPTH_CHARGE_SINK_MS);
    expect(s.player.components.status.detonatedAtMs).toBe(DEPTH_CHARGE_SINK_MS);
    s.time(DEPTH_CHARGE_SINK_MS + CONTACT_DETONATION_MS);
    system.update!(s.world, 0);
    createEnemySubmarineLifecycleSystem().update!(s.world, 0);
    expect(s.world.getEntity(charge.id)).toBeUndefined();
    expect(s.world.getEntity(s.boat.id)).toBeUndefined();
    const onGameOver = vi.fn();
    const lifecycle = createDetonationLifecycleSystem(onGameOver);
    s.time(DEPTH_CHARGE_SINK_MS + PLAYER_DETONATION_MS);
    lifecycle.update!(s.world, 0);
    lifecycle.update!(s.world, 0);
    expect(onGameOver).toHaveBeenCalledTimes(1);
    expect(onGameOver).toHaveBeenCalledWith("depth-charge");
    expect(getGameOverMessage("depth-charge")).toBe("Depth charge blast compromised the hull.");
  });

  it.each(["player", "enemy"] as const)("allows %s torpedoes to sink boats while their charges survive", (owner) => {
    const s = setup();
    const charge = s.world.addEntity(createDepthCharge(s.boat.id, { x: 0, y: 0 }, 0));
    s.world.addEntity(createTorpedo(owner, "other", s.boat.components.navigation, 0));
    createTorpedoSystem().update!(s.world, 0);
    expect(s.boat.components.status.state).toBe("destroyed");
    s.world.removeEntity(s.boat.id);
    s.time(DEPTH_CHARGE_SINK_MS);
    createDepthChargeSystem().update!(s.world, 0);
    expect(charge.components.detonatedAtMs).toBe(DEPTH_CHARGE_SINK_MS);
    expect(s.player.components.status.state).toBe("detonating");
  });
});

describe("boat population", () => {
  it("independently reinforces one boat and three subs, and removes out-of-area charges", () => {
    const s = setup();
    s.world.removeEntity(s.boat.id);
    const chunks = createChunkSystem(s.sonar);
    chunks.attach!(s.world);
    for (const e of s.world.getEntities() as RadarEntity[]) {
      if (isBoatEntity(e) || isEnemyEntity(e)) s.world.removeEntity(e.id);
    }
    const enemies = () => s.world.getEntities() as RadarEntity[];
    s.time(23999);
    chunks.update!(s.world, 0);
    expect(enemies().filter(isBoatEntity)).toHaveLength(0);
    s.time(24000);
    chunks.update!(s.world, 0);
    expect(enemies().filter(isBoatEntity)).toHaveLength(1);
    expect(enemies().filter(isEnemyEntity)).toHaveLength(1);
    for (let i = 2; i <= 5; i++) { s.time(24000 * i); chunks.update!(s.world, 0); }
    expect(enemies().filter(isBoatEntity)).toHaveLength(1);
    expect(enemies().filter(isEnemyEntity)).toHaveLength(3);
    const removed = enemies().find(isBoatEntity)!;
    removed.components.navigation.position = { x: 100000, y: 0 };
    const charge = s.world.addEntity(createDepthCharge(removed.id, { x: 100000, y: 0 }, 120000));
    chunks.update!(s.world, 0);
    expect(s.world.getEntity(removed.id)).toBeUndefined();
    expect(s.world.getEntity(charge.id)).toBeUndefined();
  });

  it("respects both caps during generation and keeps boat spawns outside player visibility", () => {
    const s = setup();
    s.world.removeEntity(s.boat.id);
    let seed = 12345;
    vi.spyOn(Math, "random").mockImplementation(() => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    });
    createChunkSystem(s.sonar).attach!(s.world);
    const entities = s.world.getEntities() as RadarEntity[];
    expect(entities.filter(isBoatEntity)).toHaveLength(1);
    expect(entities.filter(isEnemyEntity).length).toBeGreaterThan(0);
    expect(entities.filter(isEnemyEntity).length).toBeLessThanOrEqual(3);
    for (const boat of entities.filter(isBoatEntity)) expect(worldDistance(boat.components.navigation.position, s.player.components.navigation.position)).toBeGreaterThan(900);
  });
});
