import { createBoatBehaviorSystem } from "../enemies/boat";
import { createDepthChargeSystem } from "./entities/depthCharges";
import { World } from "../engine/world";
import { createChunkSystem } from "./chunks";
import {
  createEnemySubmarineBehaviorSystem,
  createEnemySubmarineLifecycleSystem,
  createEnemySubmarineSonarSystem,
} from "../enemies/submarine";
import type { PlayerDetonationCause, SonarState } from "../radarTypes";
import { createDetonationLifecycleSystem, createMineCollisionSystem } from "./entities/mines";
import { changeCourse, changeThrottle, createPlayerEntity, createPlayerNavigationSystem, createPlayerSonarSystem } from "./entities/player";
import { createTorpedoSystem, firePlayerTorpedo, reloadPlayerTorpedoes } from "./entities/torpedoes";

export interface RadarCommands {
  changeThrottle(delta: number): void;
  changeCourse(delta: number): void;
  firePlayerTorpedo(): void;
  reloadPlayerTorpedoes(): void;
}

export interface RadarRuntime {
  world: World;
  sonar: SonarState;
  commands: RadarCommands;
}

export function createRadarWorld(options: {
  onGameOver: (cause: PlayerDetonationCause) => void;
}): RadarRuntime {
  const world = new World();
  const sonar: SonarState = {
    pulses: [],
    echoes: [],
    coverage: new Map(),
    playerLastEmittedAtMs: null,
  };

  world.addEntity(createPlayerEntity());

  world.addSystem(createPlayerNavigationSystem());
  world.addSystem(createChunkSystem(sonar));
  world.addSystem(createPlayerSonarSystem(sonar));
  world.addSystem(createEnemySubmarineSonarSystem(sonar));
  world.addSystem(createEnemySubmarineBehaviorSystem());
  world.addSystem(createBoatBehaviorSystem());
  world.addSystem(createTorpedoSystem());
  world.addSystem(createDepthChargeSystem());
  world.addSystem(createMineCollisionSystem());
  world.addSystem(createDetonationLifecycleSystem(options.onGameOver));
  world.addSystem(createEnemySubmarineLifecycleSystem());

  return {
    world,
    sonar,
    commands: {
      changeThrottle: (delta) => changeThrottle(world, delta),
      changeCourse: (delta) => changeCourse(world, delta),
      firePlayerTorpedo: () => void firePlayerTorpedo(world),
      reloadPlayerTorpedoes: () => void reloadPlayerTorpedoes(world),
    },
  };
}
