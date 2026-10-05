import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("pixi.js", () => ({
  Container: class {
    destroy() {}
  },
}));

import { calculateTorpedoSolution } from "./torpedoSolution";
import { predictTargetMotion } from "./targetMotion";
import { worldBearingDeg } from "../engine/navigation";
import { advanceNavigation } from "../radar/entities/shared";
import { World } from "../engine/world";
import type { EnemySubComponents, SonarState, TorpedoComponents } from "../radarTypes";
import { THROTTLE_SPEEDS, TORPEDO_SPEED, VESSEL_ACCELERATION, VESSEL_DECELERATION, VESSEL_MIN_TURN_RADIUS } from "../radar/config";
import { getGameOverMessage } from "../gameOverScene";
import { createMine, createDetonationLifecycleSystem } from "../radar/entities/mines";
import { PLAYER_DETONATION_MS } from "../radar/config";
import { createPlayerEntity } from "../radar/entities/player";
import { advanceAlongCourse, createTorpedo, createTorpedoSystem } from "../radar/entities/torpedoes";
import {
  acquireEnemyTarget,
  createEnemySubmarineSonarSystem,
  advanceEnemyFireCadence,
  applySeparationBias,
  calculateInterceptPoint,
  calculateNavigationIntent,
  canEnemyFire,
  createEnemySubmarineBehaviorSystem,
  findIncomingThreat,
} from "./submarine";

const stationaryTarget = {
  position: { x: 0, y: -500 },
  velocity: { x: 0, y: 0 },
};

function navigation(
  position = { x: 0, y: 0 },
  headingDeg = 0,
  speedUnitsPerSecond = 0,
) {
  return { position, headingDeg, speedUnitsPerSecond, courseTurn: 0 };
}

function enemy(id: string, x: number, y: number, headingDeg = 0) {
  return {
    id,
    components: {
      kind: "enemy-sub" as const,
      navigation: navigation({ x, y }, headingDeg),
      detection: {
        state: "hidden" as const,
        revealedAtMs: null,
        trackedUntilMs: null,
        lastKnownPosition: null,
        lastKnownHeadingDeg: null,
      },
      status: { state: "active" as const, destroyedAtMs: null },
      sonar: { lastEmittedAtMs: null, targetTrack: null },
      torpedoBay: { count: 6, reloadStartMs: null },
      ai: { disengageBearing: null, disengageUntilMs: 0, reengageBearing: null, reengageUntilMs: 0, shotsFiredInBurst: 0, nextFireAtMs: 0 },
    },
  };
}

function torpedo(
  owner: "player" | "enemy",
  position: { x: number; y: number },
  headingDeg: number,
) {
  return {
    id: `${owner}-torpedo`,
    components: {
      kind: "torpedo" as const,
      owner,
      sourceId: "shooter",
      clearedSource: true,
      navigation: {
        ...navigation(position, headingDeg, TORPEDO_SPEED),
        plottedHeadingDeg: null,
      },
      trail: { points: [position], firedAtMs: 0, durationMs: 10000, lengthUnits: 125 },
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("enemy targeting and movement", () => {
  it("leads a moving player", () => {
    const intercept = calculateInterceptPoint(
      { x: 0, y: 0 },
      { x: 0, y: -360 },
      { x: 100, y: 0 },
      TORPEDO_SPEED,
      4.5,
    );

    expect(intercept.x).toBeGreaterThan(0);
    expect(intercept.y).toBe(-360);
  });

  it("approaches, withdraws, and aligns at the configured distance band", () => {
    const nav = navigation();
    const far = calculateNavigationIntent(nav, {
      position: { x: 0, y: -700 },
      velocity: { x: 0, y: 0 },
    });
    const near = calculateNavigationIntent(nav, {
      position: { x: 0, y: -150 },
      velocity: { x: 0, y: 0 },
    });
    const holding = calculateNavigationIntent(nav, {
      position: { x: 0, y: -450 },
      velocity: { x: 0, y: 0 },
    });

    expect(far.targetBearing).toBeCloseTo(0);
    expect(far.targetSpeed).toBe(THROTTLE_SPEEDS[2]);
    expect(near.targetBearing).toBeCloseTo(180);
    expect(near.targetSpeed).toBe(THROTTLE_SPEEDS[2]);
    expect(holding.targetBearing).toBeCloseTo(0);
    expect(holding.targetSpeed).toBe(THROTTLE_SPEEDS[1]);
  });

  it("biases nearby enemies away from one another", () => {
    const subject = enemy("subject", 0, 0);
    const neighbor = enemy("neighbor", 30, 0);
    const bearing = applySeparationBias(0, subject, [subject, neighbor]);

    expect(bearing).toBeGreaterThan(340);
    expect(bearing).toBeLessThan(360);
  });
});

describe("enemy firing", () => {
  it.each([-1, 1])("launches and lands a full-rudder broadside shot in direction %s", (direction) => {
    let now = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const world = new World();
    const player = world.addEntity(createPlayerEntity());
    player.components.navigation.position = { x: direction * 440, y: 0 };
    const sub = world.addEntity<EnemySubComponents>(enemy("attacker", 0, 0));
    sub.components.sonar.targetTrack = {
      position: { ...player.components.navigation.position }, velocity: { x: 0, y: 0 }, headingDeg: 0, observedAtMs: now,
    };
    createEnemySubmarineBehaviorSystem().update!(world, 0);
    const shot = (world.getEntities() as { components: TorpedoComponents }[]).find(entity => entity.components.kind === "torpedo")!;
    expect(shot).toBeDefined();
    expect(shot.components.navigation.headingDeg).toBe(0);
    expect(shot.components.navigation.courseTurn).toBeCloseTo(direction, 10);
    expect(sub.components.ai.firingManeuver).toBeFalsy();
    const system = createTorpedoSystem();
    for (let frame = 0; frame < 140 && player.components.status.state === "active"; frame++) {
      now += 16;
      system.update!(world, 16);
    }
    expect(player.components.status.detonationCause).toBe("enemy-sub");
    expect(sub.components.status.state).toBe("active");
    world.destroy();
  });

  it("requires ammunition, cadence, and range", () => {
    expect(canEnemyFire(navigation(), stationaryTarget, 6, 0, 0)).toBe(true);
    expect(canEnemyFire(navigation(undefined, 30), stationaryTarget, 6, 0, 0)).toBe(true);
    expect(canEnemyFire(navigation(), stationaryTarget, 0, 0, 0)).toBe(false);
    expect(canEnemyFire(navigation(), stationaryTarget, 6, 100, 99)).toBe(false);
    expect(
      canEnemyFire(
        navigation(),
        { position: { x: 0, y: -100 }, velocity: { x: 0, y: 0 } },
        6,
        0,
        0,
      ),
    ).toBe(false);
    expect(
      canEnemyFire(
        navigation(),
        { position: { x: 0, y: -900 }, velocity: { x: 0, y: 0 } },
        6,
        0,
        0,
      ),
    ).toBe(false);
  });

  it("fires three spaced shots followed by a three-second recovery", () => {
    const first = advanceEnemyFireCadence(0, 1000);
    const second = advanceEnemyFireCadence(first.shotsFiredInBurst, first.nextFireAtMs);
    const third = advanceEnemyFireCadence(second.shotsFiredInBurst, second.nextFireAtMs);

    expect(first).toEqual({ shotsFiredInBurst: 1, nextFireAtMs: 1650 });
    expect(second).toEqual({ shotsFiredInBurst: 2, nextFireAtMs: 2300 });
    expect(third).toEqual({ shotsFiredInBurst: 0, nextFireAtMs: 5300 });
  });

  it("kills a player that remains stationary", () => {
    let frameMs = 0;
    vi.spyOn(performance, "now").mockImplementation(() => frameMs);
    const world = new World();
    const player = createPlayerEntity();
    const attacker = enemy("attacker", 0, -500, 180);
    world.addEntity(player);
    world.addEntity<EnemySubComponents>(attacker);
    world.addSystem(createEnemySubmarineSonarSystem({ pulses: [], echoes: [], coverage: new Map(), playerLastEmittedAtMs: null }));
    world.addSystem(createEnemySubmarineBehaviorSystem());
    world.addSystem(createTorpedoSystem());

    for (let frame = 0; frame < 350 && player.components.status.state === "active"; frame += 1) {
      frameMs += 16;
      world.update(16);
    }

    expect(player.components.status.state).toBe("detonating");
    expect(player.components.status.detonationCause).toBe("enemy-sub");
    world.destroy();
  });
});

describe("enemy torpedo avoidance", () => {
  it("detects collision courses and intended-path crossings", () => {
    const nav = navigation();
    const incoming = torpedo("player", { x: 0, y: -500 }, 180);

    expect(findIncomingThreat(nav, 90, THROTTLE_SPEEDS[2], [incoming])).not.toBeNull();
  });

  it("ignores safe torpedoes but detects friendly collision courses", () => {
    const nav = navigation();
    const safe = torpedo("player", { x: 500, y: 0 }, 0);
    const friendly = torpedo("enemy", { x: 0, y: -500 }, 180);

    expect(findIncomingThreat(nav, 0, THROTTLE_SPEEDS[1], [safe])).toBeNull();
    expect(findIncomingThreat(nav, 0, THROTTLE_SPEEDS[1], [friendly])).not.toBeNull();
  });

  it("can fire in the same frame that it begins avoiding", () => {
    let frameMs = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => frameMs);
    const world = new World();
    const player = createPlayerEntity();
    player.components.navigation.position = { x: 0, y: -500 };
    const attacker = enemy("attacker", 0, 0, 0);
    const incoming = torpedo("player", { x: 0, y: -300 }, 180);
    world.addEntity(player);
    world.addEntity<EnemySubComponents>(attacker);
    world.addEntity<TorpedoComponents>(incoming);
    world.addSystem(createEnemySubmarineBehaviorSystem());

    world.getEntity<EnemySubComponents>(attacker.id)!.components.sonar.targetTrack = {
      position: { x: 0, y: -500 }, velocity: { x: 0, y: 0 },
      headingDeg: 0, observedAtMs: frameMs,
    };
    world.update(16);

    const enemyShots = world
      .getEntities<TorpedoComponents>()
      .filter((entity) => entity.components.kind === "torpedo" && entity.components.owner === "enemy");
    expect(enemyShots).toHaveLength(1);
    expect(attacker.components.navigation.courseTurn).not.toBe(0);
    world.destroy();
  });
});


describe("enemy sonar tracks", () => {
  it("waits for its own echo, remembers measured motion, and refreshes on the next ping", () => {
    let frameMs = 0;
    vi.spyOn(performance, "now").mockImplementation(() => frameMs);
    const world = new World();
    const player = createPlayerEntity();
    player.components.navigation = { ...player.components.navigation,
      position: { x: 0, y: -520 }, headingDeg: 90, speedUnitsPerSecond: 100 };
    world.addEntity<EnemySubComponents>(enemy("attacker", 0, 0));
    world.addEntity(player);
    const sonar: SonarState = { pulses: [], echoes: [], coverage: new Map(), playerLastEmittedAtMs: null };
    const system = createEnemySubmarineSonarSystem(sonar);
    const subject = world.getEntity<EnemySubComponents>("attacker")!;
    system.update!(world, 0);
    expect(acquireEnemyTarget(world, subject, frameMs)).toBeNull();
    frameMs = 1000;
    system.update!(world, 0);
    expect(acquireEnemyTarget(world, subject, frameMs)).toBeNull();
    expect(sonar.echoes).toHaveLength(1);
    player.components.navigation.position = { x: 300, y: 0 };
    player.components.navigation.headingDeg = 180;
    player.components.navigation.speedUnitsPerSecond = 0;
    frameMs = 2000;
    system.update!(world, 0);
    const track = acquireEnemyTarget(world, subject, frameMs)!;
    expect(track.position.x).toBeCloseTo(100);
    expect(track.position.y).toBeCloseTo(-520);
    expect(track.velocity.x).toBeCloseTo(100);
    expect(subject.components.sonar.targetTrack!.headingDeg).toBe(90);
    const uninformed = enemy("uninformed", 0, 0);
    expect(acquireEnemyTarget(world, uninformed, frameMs)).toBeNull();
    frameMs = 3000;
    system.update!(world, 0);
    frameMs = 3600;
    system.update!(world, 0);
    frameMs = 4200;
    system.update!(world, 0);
    expect(acquireEnemyTarget(world, subject, frameMs)).toMatchObject({
      position: { x: 300, y: 0 }, velocity: { x: 0, y: 0 },
    });
    world.destroy();
  });

  it("does not fire without a sonar track", () => {
    const world = new World();
    world.addEntity(createPlayerEntity());
    const subject = enemy("attacker", 0, -500, 180);
    world.addEntity<EnemySubComponents>(subject);
    world.addSystem(createEnemySubmarineBehaviorSystem());
    world.update(16);
    expect(subject.components.torpedoBay.count).toBe(6);
    world.destroy();
  });
});


describe("plotted torpedo intercepts", () => {
  it.each([
    { position: { x: 0, y: -500 }, velocity: { x: 180, y: 0 } },
    { position: { x: 0, y: 500 }, velocity: { x: -180, y: 0 } },
    { position: { x: 820, y: 0 }, velocity: { x: 180, y: 0 } },
    { position: { x: 0, y: -500 }, velocity: { x: 180, y: 0 }, turnRateDegPerSecond: 30 },
  ])("meets a constant-velocity target at $position", (target) => {
    const source = navigation();
    const intent = calculateNavigationIntent(source, target);
    source.headingDeg = (intent.firingBearing + 10) % 360;
    source.courseTurn = -0.5;
    expect(canEnemyFire(source, target, 6, 0, 0)).toBe(true);
    const solution = calculateTorpedoSolution(source, target)!;
    expect(solution).not.toBeNull();
    const shot = createTorpedo("enemy", "shooter", source, 0, solution.courseTurn);
    expect(shot.components.navigation.headingDeg).toBe(source.headingDeg);
    expect(Math.abs(solution.courseTurn)).toBeGreaterThan(0.01);
    expect(Math.abs(solution.courseTurn)).toBeLessThanOrEqual(1);
    const initialHeading = source.headingDeg;
    for (let frame = 0; frame < 300; frame += 1) {
      advanceAlongCourse(shot.components, solution.seconds / 300);
    }
    expect(shot.components.navigation.headingDeg).not.toBeCloseTo(initialHeading);
    const predicted = predictTargetMotion(target, solution.seconds).position;
    expect(shot.components.navigation.position.x).toBeCloseTo(predicted.x, 5);
    expect(shot.components.navigation.position.y).toBeCloseTo(predicted.y, 5);
    const singleStep = createTorpedo("enemy", "shooter", source, 0, solution.courseTurn);
    advanceAlongCourse(singleStep.components, solution.seconds);
    expect(singleStep.components.navigation.position.x).toBeCloseTo(predicted.x, 5);
    expect(singleStep.components.navigation.position.y).toBeCloseTo(predicted.y, 5);
  });

  it("rejects arcs that exceed the rudder limit or torpedo lifetime", () => {
    expect(calculateTorpedoSolution(navigation(undefined, 30), {
      position: { x: 0, y: -180 }, velocity: { x: 0, y: 0 },
    })).toBeNull();
    expect(calculateTorpedoSolution(navigation(), {
      position: { x: 0, y: -4000 }, velocity: { x: 0, y: 0 },
    })).toBeNull();
  });

  it.each([-20, 0, 20])("solves both rudder directions and straight shots from heading %s", (heading) => {
    const source = navigation(undefined, heading);
    const solution = calculateTorpedoSolution(source, stationaryTarget)!;
    expect(solution).not.toBeNull();
    const shot = createTorpedo("enemy", "shooter", source, 0, solution.courseTurn);
    advanceAlongCourse(shot.components, solution.seconds);
    expect(shot.components.navigation.position.x).toBeCloseTo(0, 5);
    expect(shot.components.navigation.position.y).toBeCloseTo(-500, 5);
  });

  it("preserves the player's heading and course for unplotted shots", () => {
    const source = { ...navigation(undefined, 75), courseTurn: 0.4 };
    const shot = createTorpedo("player", "player", source, 0);
    expect(shot.components.navigation.headingDeg).toBe(75);
    expect(shot.components.navigation.courseTurn).toBe(0.4);
  });
});


describe("enemy close-range recovery", () => {
  it.each(["straight", "pursuit"])("reengages an equal-speed player in %s motion", (motion) => {
    let frameMs = 0;
    vi.spyOn(performance, "now").mockImplementation(() => frameMs);
    const world = new World();
    world.addEntity(createPlayerEntity());
    world.addEntity<EnemySubComponents>(enemy("attacker", 0, -100));
    const subject = world.getEntity<EnemySubComponents>("attacker")!;
    subject.components.navigation.speedUnitsPerSecond = THROTTLE_SPEEDS[2];
    const pursuingPlayer = navigation({ x: 0, y: 0 }, 0, THROTTLE_SPEEDS[2]);
    const playerPosition = pursuingPlayer.position;
    world.addSystem(createEnemySubmarineBehaviorSystem());
    let longestRetreatMs = 0;
    let retreatMs = 0;
    let lateralDistance = 0;
    for (let frame = 0; frame < 2500; frame += 1) {
      frameMs += 16;
      const position = subject.components.navigation.position;
      const previousPosition = { ...playerPosition };
      advanceNavigation(pursuingPlayer, THROTTLE_SPEEDS[2], 0.016, {
        acceleration: VESSEL_ACCELERATION, deceleration: VESSEL_DECELERATION,
        minimumTurnRadius: VESSEL_MIN_TURN_RADIUS,
        targetBearing: motion === "straight" ? 0 : worldBearingDeg(playerPosition, position),
      });
      const velocity = {
        x: (playerPosition.x - previousPosition.x) / 0.016,
        y: (playerPosition.y - previousPosition.y) / 0.016,
      };
      subject.components.sonar.targetTrack = {
        position: { ...playerPosition }, velocity, headingDeg: 0, observedAtMs: frameMs,
      };
      world.update(16);
      retreatMs = subject.components.ai.disengageBearing === null ? 0 : retreatMs + 16;
      longestRetreatMs = Math.max(longestRetreatMs, retreatMs);
      lateralDistance = Math.max(lateralDistance, Math.abs(position.x));
    }
    expect(longestRetreatMs).toBeGreaterThan(0);
    expect(longestRetreatMs).toBeLessThanOrEqual(4016);
    expect(lateralDistance).toBeGreaterThan(100);
    expect(subject.components.torpedoBay.count).toBeLessThan(6);
    world.destroy();
  });

  it.each([0, 90, 180, 270])("escapes a close encounter and fires from heading %s", (heading) => {
    let frameMs = 0;
    vi.spyOn(performance, "now").mockImplementation(() => frameMs);
    const world = new World();
    world.addEntity(createPlayerEntity());
    world.addEntity<EnemySubComponents>(enemy("attacker", 0, -100, heading));
    const subject = world.getEntity<EnemySubComponents>("attacker")!;
    subject.components.navigation.speedUnitsPerSecond = THROTTLE_SPEEDS[2];
    subject.components.sonar.targetTrack = {
      position: { x: 0, y: 0 }, velocity: { x: 0, y: 0 },
      headingDeg: 0, observedAtMs: 0,
    };
    world.addSystem(createEnemySubmarineBehaviorSystem());
    let regainedDistance = false;
    let maximumDistance = 0;
    for (let frame = 0; frame < 1500; frame += 1) {
      frameMs += 16;
      world.update(16);
      const position = subject.components.navigation.position;
      const distance = Math.hypot(position.x, position.y);
      maximumDistance = Math.max(maximumDistance, distance);
      if (distance >= 360) regainedDistance = true;
    }
    expect(regainedDistance).toBe(true);
    expect(maximumDistance).toBeLessThan(820);
    expect(subject.components.torpedoBay.count).toBeLessThan(6);
    world.destroy();
  });

  it.each([90, 120, 240, 270])("accepts feasible curved shots at %s degrees", (heading) => {
    expect(canEnemyFire(navigation(undefined, heading), stationaryTarget, 6, 0, 0)).toBe(true);
  });
});


describe("friendly fire", () => {
  it.each(["player", "enemy"] as const)("protects a %s launch, then allows a returning self-hit", (owner) => {
    let frameMs = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => frameMs);
    const world = new World();
    const player = world.addEntity(createPlayerEntity());
    const shooter = owner === "player" ? player : world.addEntity<EnemySubComponents>(enemy("shooter", 500, 0));
    const shot = world.addEntity(createTorpedo(owner, shooter.id, shooter.components.navigation, frameMs));
    const onGameOver = vi.fn();
    world.addSystem(createTorpedoSystem());
    world.addSystem(createDetonationLifecycleSystem(onGameOver));
    world.update(16);
    expect(shooter.components.status.state).toBe("active");
    expect(shot.components.clearedSource).toBe(false);
    world.update(300);
    expect(shot.components.clearedSource).toBe(true);
    expect(shooter.components.status.state).toBe("active");
    shot.components.navigation.position = { ...shooter.components.navigation.position };
    world.update(0);
    expect(world.getEntity(shot.id)).toBeUndefined();
    if (owner === "player") {
      expect(player.components.status.detonationCause).toBe("own-torpedo");
      frameMs += PLAYER_DETONATION_MS;
      world.update(0);
      world.update(0);
      expect(onGameOver).toHaveBeenCalledTimes(1);
      expect(onGameOver).toHaveBeenCalledWith("own-torpedo");
      expect(getGameOverMessage("own-torpedo")).toBe("Your own torpedo compromised the hull.");
    } else {
      expect(shooter.components.status.state).toBe("destroyed");
      expect(onGameOver).not.toHaveBeenCalled();
    }
    world.destroy();
  });

  it("lets an enemy shot destroy another enemy even before clearing its shooter", () => {
    vi.spyOn(performance, "now").mockReturnValue(1000);
    const world = new World();
    world.addEntity(createPlayerEntity());
    const shooter = world.addEntity<EnemySubComponents>(enemy("shooter", 500, 0));
    const victim = world.addEntity<EnemySubComponents>(enemy("victim", 500, -20));
    const shot = world.addEntity(createTorpedo("enemy", shooter.id, shooter.components.navigation, 1000));
    world.addSystem(createTorpedoSystem());
    world.update(0);
    expect(shooter.components.status.state).toBe("active");
    expect(victim.components.status.state).toBe("destroyed");
    expect(victim.components.detection.state).toBe("tracked");
    expect(world.getEntity(shot.id)).toBeUndefined();
    world.destroy();
  });

  it.each(["player", "enemy"] as const)("lets %s torpedoes detonate mines", (owner) => {
    vi.spyOn(performance, "now").mockReturnValue(1000);
    const world = new World();
    world.addEntity(createPlayerEntity());
    const mine = world.addEntity(createMine("mine", 500, 0));
    const shot = world.addEntity(createTorpedo(owner, "shooter", navigation({ x: 500, y: 0 }), 1000));
    world.addSystem(createTorpedoSystem());
    world.update(0);
    expect(mine.components.status.state).toBe("detonating");
    expect(world.getEntity(shot.id)).toBeUndefined();
    world.destroy();
  });

  it("evades friendly shots without a sonar track and ignores its protected launch", () => {
    const world = new World();
    world.addEntity(createPlayerEntity());
    const subject = world.addEntity<EnemySubComponents>(enemy("subject", 500, 0));
    const shot = world.addEntity(createTorpedo("enemy", subject.id, subject.components.navigation, 0));
    world.addSystem(createEnemySubmarineBehaviorSystem());
    world.update(16);
    expect(subject.components.navigation.courseTurn).toBe(0);
    shot.components.sourceId = "other-enemy";
    shot.components.navigation.position = { x: 500, y: -300 };
    shot.components.navigation.headingDeg = 180;
    world.update(16);
    expect(subject.components.navigation.courseTurn).not.toBe(0);
    expect(subject.components.torpedoBay.count).toBe(6);
    world.destroy();
  });
});


describe("opportunistic firing course changes", () => {
  it("temporarily leaves a navigation course, fires, and returns to it", () => {
    let now = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const world = new World();
    const player = world.addEntity(createPlayerEntity());
    player.components.navigation.position = { x: 0, y: -500 };
    const sub = world.addEntity<EnemySubComponents>(enemy("attacker", 0, 0, 170));
    sub.components.navigation.speedUnitsPerSecond = 180;
    sub.components.ai.reengageUntilMs = 100000;
    sub.components.ai.reengageBearing = 170;
    sub.components.sonar.targetTrack = { position: { x: 0, y: -500 }, velocity: { x: 0, y: 0 }, headingDeg: 0, observedAtMs: now };
    const system = createEnemySubmarineBehaviorSystem();
    system.update!(world, 16);
    expect(sub.components.ai.firingManeuver?.phase).toBe("aiming");
    let sawReturn = false;
    for (let i = 0; i < 200; i++) {
      now += 16;
      system.update!(world, 16);
      if (sub.components.ai.firingManeuver?.phase === "returning") sawReturn = true;
      if (sawReturn && !sub.components.ai.firingManeuver) break;
    }
    expect(sawReturn).toBe(true);
    expect(sub.components.torpedoBay.count).toBeLessThan(6);
    expect(sub.components.ai.reengageBearing).toBe(170);
    expect(sub.components.navigation.headingDeg).toBeGreaterThanOrEqual(164);
    world.destroy();
  });

  it("cancels an aiming detour when an incoming torpedo demands evasion", () => {
    vi.spyOn(performance, "now").mockReturnValue(1000);
    const world = new World();
    world.addEntity(createPlayerEntity());
    const sub = world.addEntity<EnemySubComponents>(enemy("attacker", 0, 0, 45));
    sub.components.navigation.speedUnitsPerSecond = 180;
    sub.components.sonar.targetTrack = { position: { x: 0, y: -500 }, velocity: { x: 0, y: 0 }, headingDeg: 0, observedAtMs: 1000 };
    sub.components.ai.firingManeuver = { phase: "aiming", returnBearing: 45, untilMs: 2000 };
    world.addEntity(torpedo("player", { x: 0, y: -80 }, 180));
    createEnemySubmarineBehaviorSystem().update!(world, 16);
    expect(sub.components.ai.firingManeuver).toBeNull();
    expect(sub.components.ai.nextManeuverAtMs).toBeGreaterThan(1000);
    world.destroy();
  });
});

describe("missed firing window regressions", () => {
  it("does not treat a safely departing torpedo as an incoming threat", () => {
    const nav = navigation(undefined, 0, 85);
    const departing = torpedo("enemy", { x: 0, y: -65 }, 0);
    expect(findIncomingThreat(nav, 0, 85, [departing])).toBeNull();
    departing.components.navigation.headingDeg = 180;
    expect(findIncomingThreat(nav, 0, 85, [departing])).not.toBeNull();
  });

  it("takes a close-range shot while still choosing to retreat", () => {
    const close = { position: { x: 0, y: -100 }, velocity: { x: 0, y: 0 } };
    expect(canEnemyFire(navigation(), close, 6, 0, 1000)).toBe(true);
    expect(calculateNavigationIntent(navigation(), close).targetBearing).toBe(180);
  });

  it("fires when ordinary steering opens a firing window within the frame", () => {
    vi.spyOn(performance, "now").mockReturnValue(1000);
    const world = new World();
    world.addEntity(createPlayerEntity());
    const sub = world.addEntity<EnemySubComponents>(enemy("attacker", 0, 0, 31));
    sub.components.navigation.speedUnitsPerSecond = 180;
    sub.components.ai.nextManeuverAtMs = 10000;
    sub.components.sonar.targetTrack = { position: { x: 0, y: -500 }, velocity: { x: 0, y: 0 }, headingDeg: 0, observedAtMs: 1000 };
    createEnemySubmarineBehaviorSystem().update!(world, 100);
    expect(sub.components.ai.firingManeuver).toBeFalsy();
    expect(sub.components.torpedoBay.count).toBe(5);
    world.destroy();
  });

  it("holds a feasible curved course during cooldown and fires when the tube is ready", () => {
    let now = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const world = new World();
    world.addEntity(createPlayerEntity());
    const sub = world.addEntity<EnemySubComponents>(enemy("attacker", 0, 0, 45));
    sub.components.navigation.speedUnitsPerSecond = 180;
    sub.components.ai.nextFireAtMs = 1650;
    sub.components.ai.reengageUntilMs = 100000;
    sub.components.ai.reengageBearing = 45;
    sub.components.sonar.targetTrack = { position: { x: 0, y: -500 }, velocity: { x: 0, y: 0 }, headingDeg: 0, observedAtMs: 1000 };
    const system = createEnemySubmarineBehaviorSystem();
    system.update!(world, 16);
    expect(sub.components.ai.firingManeuver).toBeFalsy();
    for (now = 1016; now < 1650; now += 16) {
      system.update!(world, 16);
      expect(sub.components.torpedoBay.count).toBe(6);
    }
    system.update!(world, 16);
    expect(sub.components.torpedoBay.count).toBe(5);
    world.destroy();
  });
});
