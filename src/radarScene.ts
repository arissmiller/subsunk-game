import {
  Assets,
  Container,
  GraphicsContext,
  Graphics,
  Rectangle,
  Sprite,
  Text,
  TextStyle,
  type Application,
  type FederatedPointerEvent,
} from "pixi.js";
import {
  clampWorldToRadarRadius,
  normalizeDegrees,
  projectWorldToRadar,
  RADAR_WORLD_RADIUS_UNITS,
  worldDistance,
  worldBearingDeg,
} from "./engine/navigation";
import { World } from "./engine/world";
import type { System } from "./engine/types";
import type { GameScene } from "./sceneTypes";
import type {
  EnemySubComponents,
  EnemyTorpedoComponents,
  MineComponents,
  MineLayerComponents,
  PlayerDetonationCause,
  PlayerComponents,
  RadarEntity,
  RadarView,
  ThrottleLevel,
  TorpedoComponents,
} from "./radarTypes";

interface RadarSceneOptions {
  onGameOver: (cause: PlayerDetonationCause) => void;
}

interface SweepSample {
  angleDeg: number;
  recordedAtMs: number;
}

interface SweepState {
  currentAngleDeg: number;
  samples: SweepSample[];
}

const SWEEP_DEGREES_PER_SECOND = 40;
const SWEEP_TRAIL_DEGREES = 8.5;
const DETECTION_PING_DURATION_MS = 220;
const RADAR_GRID_MINOR_SPACING_UNITS = 125;
const RADAR_GRID_MAJOR_SPACING_UNITS = RADAR_GRID_MINOR_SPACING_UNITS * 4;
const RADAR_GRID_SCAN_FADE_MS = (180 / SWEEP_DEGREES_PER_SECOND) * 1000;
const RADAR_GRID_GLOW_HALF_ANGLE_DEG = 7;
const PLAYER_TARGET_SIZE_PX = 24;
const MINE_TARGET_SIZE_PX = 20;
const PLAYER_COLLISION_RADIUS_UNITS = 54;
const MINE_COLLISION_RADIUS_UNITS = 48;
const RADAR_CONTACT_VISIBLE_RADIUS_UNITS = RADAR_WORLD_RADIUS_UNITS * 0.9;
const DETONATION_DURATION_MS = 1400;
const MINE_DETONATION_DURATION_MS = 900;
const PLAYER_MIN_TURN_RADIUS_UNITS = 220;
const COURSE_TURN_STEP = 0.2;
const COURSE_TURN_LIMIT = 1;
const COURSE_PREVIEW_DISTANCE_UNITS = 720;
const COURSE_PREVIEW_STEP_SECONDS = 0.35;
const COURSE_PREVIEW_MIN_SPEED = 72;
const PLAYER_THROTTLE_SPEEDS: Record<ThrottleLevel, number> = {
  0: 0,
  1: 85,
  2: 180,
};
const PLAYER_ACCELERATION_UNITS_PER_SECOND_SQUARED = 42;
const PLAYER_DECELERATION_UNITS_PER_SECOND_SQUARED = 30;
const TORPEDO_SPEED_UNITS_PER_SECOND = 980;
const TORPEDO_FUSE_DURATION_MS = 10000;
const TORPEDO_TRAIL_LENGTH_UNITS = 125;
const TORPEDO_VISUAL_WIDTH_PX = 2;
const TORPEDO_TRAIL_GRADIENT_SEGMENTS = 12;
const TORPEDO_CROSSHAIR_DURATION_MS = 520;
const TORPEDO_CROSSHAIR_SIZE_PX = 10;
const TORPEDO_BAY_MAX_COUNT = 6;
const TORPEDO_BAY_RELOAD_DURATION_MS = 5000;
const THROTTLE_LEVELS = [
  { level: 0 as ThrottleLevel, label: "Stopped" },
  { level: 1 as ThrottleLevel, label: "Slow" },
  { level: 2 as ThrottleLevel, label: "Fast" },
] as const;
const DEGREE_LABELS = [
  { angleDeg: 0, label: "000" },
  { angleDeg: 45, label: "045" },
  { angleDeg: 90, label: "090" },
  { angleDeg: 135, label: "135" },
  { angleDeg: 180, label: "180" },
  { angleDeg: 225, label: "225" },
  { angleDeg: 270, label: "270" },
  { angleDeg: 315, label: "315" },
] as const;
const TEST_MINE_PLACEMENTS = [
  { id: "mine-1", x: 260, y: -340 },
  { id: "mine-2", x: 420, y: 380 },
  { id: "mine-3", x: -520, y: 120 },
] as const;

const ENEMY_SUB_SPEED_UNITS_PER_SECOND = 110;
const ENEMY_SUB_ACCELERATION_UNITS_PER_SECOND_SQUARED = 28;
const ENEMY_SUB_MIN_TURN_RADIUS_UNITS = 280;
const ENEMY_SUB_ENGAGEMENT_RANGE_UNITS = 450;
const ENEMY_SUB_MIN_FIRE_RANGE_UNITS = 180;
const ENEMY_SUB_MAX_FIRE_RANGE_UNITS = 820;
const ENEMY_SUB_FIRE_INTERVAL_BASE_MS = 14000;
const ENEMY_SUB_TRACK_DURATION_MS = 4000;
const ENEMY_SUB_COLLISION_RADIUS_UNITS = 36;

const MINE_LAYER_SPEED_UNITS_PER_SECOND = 58;
const MINE_LAYER_MIN_TURN_RADIUS_UNITS = PLAYER_MIN_TURN_RADIUS_UNITS;
const MINE_LAYER_LAY_INTERVAL_MS = 25000;
const MINE_LAYER_LAY_INTERVAL_VARIANCE_MS = 20000;
const MINE_LAYER_MINES_PER_GROUP_MIN = 3;
const MINE_LAYER_MINES_PER_GROUP_MAX = 6;
const MINE_LAYER_SPREAD_RADIUS_UNITS = 130;
const MINE_LAYER_WANDER_INTERVAL_MS = 10000;

const ENEMY_TORPEDO_SPEED_UNITS_PER_SECOND = 660;
const ENEMY_TORPEDO_TRAIL_LENGTH_UNITS = 95;
const ENEMY_TORPEDO_COLLISION_RADIUS_UNITS = 42;

const ENEMY_SPAWN_MINE_LAYER_COUNT = 2;
const ENEMY_SPAWN_MINE_LAYER_DISTANCE_MIN = 1400;
const ENEMY_SPAWN_MINE_LAYER_DISTANCE_MAX = 2200;
const ENEMY_SPAWN_INITIAL_SUB_DELAY_MS = 18000;
const ENEMY_SPAWN_RESPAWN_INTERVAL_MS = 24000;
const ENEMY_SPAWN_INTENSITY_STEP_MS = 75000;
const ENEMY_SPAWN_ACTIVE_SUB_TARGET_MAX = 3;
const ENEMY_SPAWN_SUB_DISTANCE_MIN = 750;
const ENEMY_SPAWN_SUB_DISTANCE_MAX = 950;

export async function createRadarScene(
  app: Application,
  options: RadarSceneOptions,
): Promise<GameScene> {
  const world = new World();
  const view = createRadarView();
  const sweepState: SweepState = {
    currentAngleDeg: 0,
    samples: [],
  };
  const throttleHud = createThrottleHudView();
  const steeringHud = createSteeringHudView();
  const torpedoBayHud = createTorpedoBayHudView();
  const killCounterHud = createKillCounterHudView();

  app.stage.addChild(world.root);
  view.contentLayer.addChild(
    view.background,
    view.grid,
    view.rings,
    view.sweepTrail,
    view.sweepLineGlow,
    view.sweepLine,
    view.detectionBlips,
    view.collisionEffects,
    view.contactsLayer,
    view.coursePlot,
    view.crosshairLayer,
  );
  view.overlayLayer.addChild(
    view.ticks,
    view.frame,
    ...view.labels,
  );
  world.root.addChild(
    view.contentLayer,
    view.overlayLayer,
    view.mask,
  );
  app.stage.addChild(throttleHud.container);
  app.stage.addChild(steeringHud.container);
  app.stage.addChild(torpedoBayHud.container);
  app.stage.addChild(killCounterHud.container);
  view.contentLayer.mask = view.mask;

  world.addEntity<PlayerComponents>({
    id: "player",
    components: {
      kind: "player",
      sprite: await createPlayerSprite(),
      collision: {
        layer: "player",
        radiusUnits: PLAYER_COLLISION_RADIUS_UNITS,
        collidesWith: ["hazard"],
      },
      status: {
        state: "active",
        detonatedAtMs: null,
        detonationCause: null,
      },
      navigation: {
        position: { x: 0, y: 0 },
        headingDeg: 0,
        throttleLevel: 0,
        speedUnitsPerSecond: 0,
        courseTurn: 0,
      },
      torpedoBay: {
        count: TORPEDO_BAY_MAX_COUNT,
        reloadStartMs: null,
      },
    },
  });

  const mineSpriteFactory = await createMineSpriteFactory();
  const enemySubSpriteFactory = await createEnemySubSpriteFactory();

  for (const mine of TEST_MINE_PLACEMENTS) {
    world.addEntity<MineComponents>({
      id: mine.id,
      components: {
        kind: "mine",
        sprite: mineSpriteFactory(),
        collision: {
          layer: "hazard",
          radiusUnits: MINE_COLLISION_RADIUS_UNITS,
          collidesWith: ["player"],
          isColliding: false,
          collidedAtMs: null,
        },
        position: {
          x: mine.x,
          y: mine.y,
        },
        detection: {
          state: "hidden",
          revealedAtMs: null,
        },
        status: {
          state: "active",
          detonatedAtMs: null,
        },
      },
    });
  }

  const systems: System<World>[] = [
    createRadarFrameSystem(view),
    createNavigationSystem(),
    createSweepSystem(view, sweepState),
    createRadarGridSystem(view, sweepState),
    createEnemySpawnerSystem(mineSpriteFactory, enemySubSpriteFactory),
    createMineLayerAISystem(mineSpriteFactory),
    createEnemySubAISystem(),
    createCollisionSystem(),
    createDetonationSystem(view, options.onGameOver),
    createPlayerRenderSystem(),
    createMineRenderSystem(view),
    createEnemySubRenderSystem(view),
    createTorpedoRenderSystem(view),
    createEnemyTorpedoSystem(view),
    createThrottleHudSystem(throttleHud),
    createCoursePlotSystem(view),
    createSteeringHudSystem(steeringHud),
    createTorpedoBayHudSystem(torpedoBayHud),
    createKillCounterHudSystem(killCounterHud),
  ];

  for (const system of systems) {
    world.addSystem(system);
  }

  await world.attach();

  const onPointerTap = (event: FederatedPointerEvent) => {
    firePlayerTorpedo(world, event);
  };

  world.root.eventMode = "static";
  world.root.hitArea = new Rectangle(0, 0, app.renderer.width, app.renderer.height);
  world.root.on("pointertap", onPointerTap);

  return {
    resize(viewportSize) {
      world.resize(viewportSize);
      world.root.hitArea = new Rectangle(0, 0, viewportSize, viewportSize);
    },
    update(deltaMs) {
      world.update(deltaMs);
    },
    destroy() {
      world.root.off("pointertap", onPointerTap);
      throttleHud.container.destroy({ children: true });
      steeringHud.container.destroy({ children: true });
      torpedoBayHud.container.destroy({ children: true });
      killCounterHud.container.destroy({ children: true });
      world.destroy();
    },
    handleKeyDown(event) {
      const key = event.key.toLowerCase();

      if (key === "w") {
        setPlayerThrottle(world, 1);
        return true;
      }

      if (key === "s") {
        setPlayerThrottle(world, -1);
        return true;
      }

      if (key === "a" || key === "arrowleft") {
        nudgePlayerCourse(world, -COURSE_TURN_STEP);
        return true;
      }

      if (key === "d" || key === "arrowright") {
        nudgePlayerCourse(world, COURSE_TURN_STEP);
        return true;
      }

      if (key === "r") {
        triggerManualReload(world);
        return true;
      }

      return false;
    },
  };
}

function createRadarView(): RadarView {
  return {
    contentLayer: new Container(),
    overlayLayer: new Container(),
    background: new Graphics(),
    grid: new Graphics(),
    rings: new Graphics(),
    sweepTrail: new Graphics(),
    sweepLineGlow: new Graphics(),
    sweepLine: new Graphics(),
    detectionBlips: new Graphics(),
    collisionEffects: new Graphics(),
    ticks: new Graphics(),
    contactsLayer: new Graphics(),
    coursePlot: new Graphics(),
    crosshairLayer: new Graphics(),
    labels: createDegreeLabels(),
    frame: new Graphics(),
    mask: new Graphics(),
  };
}

function createDegreeLabels() {
  const style = new TextStyle({
    fill: 0xefe0ba,
    fontFamily: "Georgia",
    fontSize: 12,
    letterSpacing: 3,
  });

  return DEGREE_LABELS.map(({ label, angleDeg }) => {
    const text = new Text({ text: label, style });
    text.anchor.set(0.5);
    text.alpha = 0.92;
    text.roundPixels = true;
    text.label = `deg-${angleDeg}`;
    return text;
  });
}

interface ThrottleHudView {
  container: Container;
  panel: Graphics;
  title: Text;
  buttons: Array<{
    level: ThrottleLevel;
    box: Graphics;
    label: Text;
  }>;
}

interface SteeringHudView {
  container: Container;
  panel: Graphics;
  title: Text;
  leftButton: Graphics;
  leftLabel: Text;
  rightButton: Graphics;
  rightLabel: Text;
  statusLabel: Text;
}

interface TorpedoBayHudView {
  container: Container;
  panel: Graphics;
  title: Text;
  reloadButton: Graphics;
  reloadButtonLabel: Text;
}

interface KillCounterHudView {
  container: Container;
  panel: Graphics;
  title: Text;
  countLabel: Text;
}

function createThrottleHudView(): ThrottleHudView {
  const container = new Container();
  const panel = new Graphics();
  const title = new Text({
    text: "Throttle",
    style: new TextStyle({
      fill: 0xefe0ba,
      fontFamily: "Georgia",
      fontSize: 12,
      letterSpacing: 2,
    }),
  });

  title.anchor.set(0, 0.5);
  title.alpha = 0.92;

  const buttonStyle = new TextStyle({
    fill: 0xd3dde3,
    fontFamily: "Georgia",
    fontSize: 13,
  });

  const buttons = THROTTLE_LEVELS.map(({ level, label }) => {
    const box = new Graphics();
    box.eventMode = "static";
    box.cursor = "pointer";

    const text = new Text({
      text: label,
      style: buttonStyle,
    });
    text.anchor.set(0.5);

    container.addChild(box, text);

    return {
      level,
      box,
      label: text,
    };
  });

  container.addChild(panel, title);

  return {
    container,
    panel,
    title,
    buttons,
  };
}

function createSteeringHudView(): SteeringHudView {
  const container = new Container();
  const panel = new Graphics();
  const title = new Text({
    text: "Course",
    style: new TextStyle({
      fill: 0xefe0ba,
      fontFamily: "Georgia",
      fontSize: 12,
      letterSpacing: 2,
    }),
  });

  title.anchor.set(0, 0.5);
  title.alpha = 0.92;

  const labelStyle = new TextStyle({
    fill: 0xd3dde3,
    fontFamily: "Georgia",
    fontSize: 13,
  });

  const leftButton = new Graphics();
  leftButton.eventMode = "static";
  leftButton.cursor = "pointer";
  const leftLabel = new Text({ text: "Port", style: labelStyle });
  leftLabel.anchor.set(0.5);

  const rightButton = new Graphics();
  rightButton.eventMode = "static";
  rightButton.cursor = "pointer";
  const rightLabel = new Text({ text: "Starboard", style: labelStyle });
  rightLabel.anchor.set(0.5);

  const statusLabel = new Text({
    text: "Straight",
    style: new TextStyle({
      fill: 0xf6fffa,
      fontFamily: "Georgia",
      fontSize: 12,
      letterSpacing: 1,
    }),
  });
  statusLabel.anchor.set(0.5);

  container.addChild(panel, title, leftButton, leftLabel, rightButton, rightLabel, statusLabel);

  return {
    container,
    panel,
    title,
    leftButton,
    leftLabel,
    rightButton,
    rightLabel,
    statusLabel,
  };
}

function createTorpedoBayHudView(): TorpedoBayHudView {
  const container = new Container();
  const panel = new Graphics();

  const title = new Text({
    text: "Tubes",
    style: new TextStyle({
      fill: 0xefe0ba,
      fontFamily: "Georgia",
      fontSize: 12,
      letterSpacing: 2,
    }),
  });
  title.anchor.set(0, 0.5);
  title.alpha = 0.92;

  const reloadButton = new Graphics();
  reloadButton.eventMode = "static";
  reloadButton.cursor = "pointer";

  const reloadButtonLabel = new Text({
    text: "Reload",
    style: new TextStyle({
      fill: 0xd3dde3,
      fontFamily: "Georgia",
      fontSize: 11,
      letterSpacing: 1,
    }),
  });
  reloadButtonLabel.anchor.set(0.5, 0.5);

  container.addChild(panel, title, reloadButton, reloadButtonLabel);

  return { container, panel, title, reloadButton, reloadButtonLabel };
}

function createKillCounterHudView(): KillCounterHudView {
  const container = new Container();
  const panel = new Graphics();

  const title = new Text({
    text: "Kills",
    style: new TextStyle({
      fill: 0xefe0ba,
      fontFamily: "Georgia",
      fontSize: 12,
      letterSpacing: 2,
    }),
  });
  title.anchor.set(0, 0.5);
  title.alpha = 0.92;

  const countLabel = new Text({
    text: "0",
    style: new TextStyle({
      fill: 0xf6fffa,
      fontFamily: "Georgia",
      fontSize: 26,
      letterSpacing: 2,
    }),
  });
  countLabel.anchor.set(0.5, 0.5);

  container.addChild(panel, title, countLabel);

  return { container, panel, title, countLabel };
}

async function createPlayerSprite() {
  const texture = await Assets.load({
    src: "/sprites/player.png",
    data: {
      scaleMode: "nearest",
    },
  });

  const sprite = new Sprite({
    texture,
    anchor: 0.5,
    roundPixels: true,
  });

  return sprite;
}

function createTorpedoGraphic() {
  return new Graphics(new GraphicsContext());
}

async function createMineSpriteFactory() {
  const texture = await tryLoadMineTexture();

  return () => {
    if (texture) {
      return new Sprite({
        texture,
        anchor: 0.5,
        roundPixels: true,
      });
    }

    const fallback = new Graphics();
    fallback
      .circle(0, 0, MINE_TARGET_SIZE_PX * 0.35)
      .fill({ color: 0x8f6d52, alpha: 0.95 })
      .circle(0, 0, MINE_TARGET_SIZE_PX * 0.18)
      .fill({ color: 0xdab58c, alpha: 0.9 });

    for (let angleDeg = 0; angleDeg < 360; angleDeg += 45) {
      const outer = pointOnRadar(0, MINE_TARGET_SIZE_PX * 0.55, angleDeg);
      const inner = pointOnRadar(0, MINE_TARGET_SIZE_PX * 0.28, angleDeg);

      fallback
        .moveTo(inner.x, inner.y)
        .lineTo(outer.x, outer.y)
        .stroke({ width: 2, color: 0xdab58c, alpha: 0.82, cap: "round" });
    }

    return fallback;
  };
}

async function createEnemySubSpriteFactory() {
  const texture = await Assets.load({
    src: "/sprites/enemy.png",
    data: { scaleMode: "nearest" },
  });

  return () =>
    new Sprite({
      texture,
      anchor: 0.5,
      roundPixels: true,
    });
}

async function tryLoadMineTexture() {
  const candidatePaths = [
    "/sprites/mine.png",
    "/sprites/naval-mine.png",
    "/sprites/sea-mine.png",
  ];

  for (const candidatePath of candidatePaths) {
    try {
      return await Assets.load({
        src: candidatePath,
        data: {
          scaleMode: "nearest",
        },
      });
    } catch {
      // Try the next likely filename.
    }
  }

  return null;
}

function drawMask(graphic: Graphics, center: number, radius: number) {
  graphic.clear().circle(center, center, radius).fill({ color: 0xffffff });
}

function createRadarFrameSystem(view: RadarView): System<World> {
  return {
    attach(_world) {
      view.contentLayer.mask = view.mask;
    },
    resize(_world, viewportSize) {
      const center = viewportSize / 2;
      const radius = getRadarRadius(viewportSize);

      drawMask(view.mask, center, radius);
      drawBackground(view.background, center, radius);
      drawRings(view.rings, center, radius);
      drawTicks(view.ticks, center, radius);
      drawRadarFrame(view.frame, center, radius);
      layoutDegreeLabels(view.labels, center, radius);
    },
  };
}

function createRadarGridSystem(view: RadarView, sweepState: SweepState): System<World> {
  return {
    resize(world, viewportSize) {
      const player = requirePlayer(world);
      const center = viewportSize / 2;
      const radius = getRadarRadius(viewportSize);

      drawCartesianGrid(
        view.grid,
        center,
        radius,
        player.components.navigation.position,
        sweepState.samples,
      );
    },
    update(world) {
      const player = requirePlayer(world);
      const center = world.viewportSize / 2;
      const radius = getRadarRadius(world.viewportSize);

      drawCartesianGrid(
        view.grid,
        center,
        radius,
        player.components.navigation.position,
        sweepState.samples,
      );
    },
  };
}

function createSweepSystem(view: RadarView, sweepState: SweepState): System<World> {
  let sweepAngleDeg = 0;
  let previousSweepAngleDeg = 0;

  return {
    update(world, deltaMs) {
      const center = world.viewportSize / 2;
      const radius = getRadarRadius(world.viewportSize);

      previousSweepAngleDeg = sweepAngleDeg;
      sweepAngleDeg = normalizeAngle(
        sweepAngleDeg + (deltaMs / 1000) * SWEEP_DEGREES_PER_SECOND,
      );
      sweepState.currentAngleDeg = sweepAngleDeg;

      drawSweepTrail(view.sweepTrail, center, radius, sweepAngleDeg, SWEEP_TRAIL_DEGREES);
      drawSweepLineGlow(view.sweepLineGlow, center, radius, sweepAngleDeg);
      drawSweepLine(view.sweepLine, center, radius, sweepAngleDeg);

      const mines = world.getEntities<MineComponents>().filter(isMineEntity);
      const player = requirePlayer(world);
      const frameMs = performance.now();

      sweepState.samples.push({
        angleDeg: sweepAngleDeg,
        recordedAtMs: frameMs,
      });
      pruneSweepSamples(sweepState.samples, frameMs);

      for (const entity of mines) {
        if (entity.components.status.state !== "active") {
          continue;
        }

        updateMineDetection(
          player.components.navigation.position,
          entity.components,
          previousSweepAngleDeg,
          sweepAngleDeg,
          frameMs,
        );
      }

      const enemySubs = world.getEntities<EnemySubComponents>().filter(isEnemySubEntity);

      for (const sub of enemySubs) {
        updateEnemySubDetection(
          player.components.navigation.position,
          sub.components,
          previousSweepAngleDeg,
          sweepAngleDeg,
          frameMs,
        );
      }
    },
  };
}

function createCollisionSystem(): System<World> {
  return {
    update(world) {
      const player = requirePlayer(world);
      const mines = world.getEntities<MineComponents>().filter(isMineEntity);
      const torpedoes = world.getEntities<TorpedoComponents>().filter(isTorpedoEntity);
      const frameMs = performance.now();

      for (const mine of mines) {
        mine.components.collision.isColliding = false;
      }

      if (player.components.status.state === "active") {
        for (const mine of mines) {
          if (mine.components.status.state !== "active") {
            continue;
          }

          if (
            !player.components.collision.collidesWith.includes(mine.components.collision.layer) ||
            !mine.components.collision.collidesWith.includes(player.components.collision.layer)
          ) {
            continue;
          }

          const separation = worldDistance(
            player.components.navigation.position,
            mine.components.position,
          );
          const minimumSeparation =
            player.components.collision.radiusUnits + mine.components.collision.radiusUnits;

          if (separation >= minimumSeparation) {
            continue;
          }

          mine.components.collision.isColliding = true;
          mine.components.collision.collidedAtMs = frameMs;
          mine.components.detection.state = "tracked";
          mine.components.detection.revealedAtMs ??= frameMs;
          player.components.navigation.speedUnitsPerSecond = 0;
          player.components.navigation.throttleLevel = 0;
          player.components.navigation.courseTurn = 0;
          player.components.status.state = "detonating";
          player.components.status.detonatedAtMs = frameMs;
          player.components.status.detonationCause = "mine";
          break;
        }
      }

      const toRemoveTorpedoes = new Set<string>();

      for (const torpedo of torpedoes) {
        const { trail } = torpedo.components;
        const progress = clamp((frameMs - trail.firedAtMs) / trail.durationMs, 0, 1);

        if (progress >= 1) {
          continue;
        }

        const headPos = interpolateWorldPoint(trail.start, trail.target, progress);

        for (const mine of mines) {
          if (mine.components.status.state !== "active") {
            continue;
          }

          if (worldDistance(headPos, mine.components.position) < mine.components.collision.radiusUnits) {
            mine.components.status.state = "detonating";
            mine.components.status.detonatedAtMs = frameMs;
            mine.components.detection.state = "tracked";
            mine.components.detection.revealedAtMs ??= frameMs;
            toRemoveTorpedoes.add(torpedo.id);
            break;
          }
        }
      }

      for (const id of toRemoveTorpedoes) {
        const torpedo = world.getEntity<TorpedoComponents>(id);
        torpedo?.components.trail.graphic?.destroy();
        world.removeEntity(id);
      }
    },
  };
}

function createDetonationSystem(
  view: RadarView,
  onGameOver: (cause: PlayerDetonationCause) => void,
): System<World> {
  let hasTriggeredGameOver = false;

  return {
    update(world) {
      const player = requirePlayer(world);
      const mines = world.getEntities<MineComponents>().filter(isMineEntity);
      const frameMs = performance.now();
      const center = world.viewportSize / 2;
      const radius = getRadarRadius(world.viewportSize);

      view.collisionEffects.clear();

      if (
        player.components.status.state === "detonating" &&
        player.components.status.detonatedAtMs !== null
      ) {
        drawDetonationEffects(
          view.collisionEffects,
          center,
          radius,
          frameMs,
          player.components.status.detonatedAtMs,
        );

        if (
          !hasTriggeredGameOver &&
          frameMs - player.components.status.detonatedAtMs >= DETONATION_DURATION_MS
        ) {
          hasTriggeredGameOver = true;
          player.components.status.state = "destroyed";
          onGameOver(player.components.status.detonationCause ?? "mine");
        }
      }

      for (const mine of mines) {
        if (
          mine.components.status.state !== "detonating" ||
          mine.components.status.detonatedAtMs === null
        ) {
          continue;
        }

        const elapsed = frameMs - mine.components.status.detonatedAtMs;

        if (elapsed >= MINE_DETONATION_DURATION_MS) {
          mine.components.status.state = "destroyed";
          continue;
        }

        const mineRadarPos = projectEntityToRadarIfVisible(
          center,
          radius,
          player.components.navigation.position,
          mine.components.position,
        );

        if (mineRadarPos) {
          drawMineDetonationEffect(
            view.collisionEffects,
            mineRadarPos.x,
            mineRadarPos.y,
            frameMs,
            mine.components.status.detonatedAtMs,
          );
        }
      }
    },
    destroy() {
      view.collisionEffects.clear();
    },
  };
}

function createNavigationSystem(): System<World> {
  return {
    update(world, deltaMs) {
      const player = requirePlayer(world);

      if (player.components.status.state !== "active") {
        return;
      }

      const navigation = player.components.navigation;
      const deltaSeconds = deltaMs / 1000;
      const targetSpeed = PLAYER_THROTTLE_SPEEDS[navigation.throttleLevel];
      const speedDelta = targetSpeed - navigation.speedUnitsPerSecond;

      if (speedDelta !== 0) {
        const acceleration =
          speedDelta > 0
            ? PLAYER_ACCELERATION_UNITS_PER_SECOND_SQUARED
            : PLAYER_DECELERATION_UNITS_PER_SECOND_SQUARED;
        const maxStep = acceleration * deltaSeconds;

        if (Math.abs(speedDelta) <= maxStep) {
          navigation.speedUnitsPerSecond = targetSpeed;
        } else {
          navigation.speedUnitsPerSecond += Math.sign(speedDelta) * maxStep;
        }
      }

      if (navigation.speedUnitsPerSecond === 0) {
        return;
      }

      if (navigation.courseTurn !== 0) {
        const turnRadius = PLAYER_MIN_TURN_RADIUS_UNITS / Math.abs(navigation.courseTurn);
        const turnRateDegPerSecond =
          (navigation.speedUnitsPerSecond / turnRadius) * (180 / Math.PI);

        navigation.headingDeg = normalizeDegrees(
          navigation.headingDeg +
            Math.sign(navigation.courseTurn) * turnRateDegPerSecond * deltaSeconds,
        );
      }

      const headingRad = ((navigation.headingDeg - 90) * Math.PI) / 180;
      const distance = navigation.speedUnitsPerSecond * deltaSeconds;

      navigation.position.x += Math.cos(headingRad) * distance;
      navigation.position.y += Math.sin(headingRad) * distance;
    },
  };
}

function createPlayerRenderSystem(): System<World> {
  return {
    attach(world) {
      const player = world.getEntity<PlayerComponents>("player");

      if (player?.components.sprite) {
        world.root.addChild(player.components.sprite);
      }
    },
    resize(world, viewportSize) {
      const player = world.getEntity<PlayerComponents>("player");

      if (!player?.components.sprite) {
        return;
      }

      layoutPlayerSprite(
        player.components.sprite,
        viewportSize / 2,
        player.components.navigation.headingDeg,
        player.components.status,
        performance.now(),
      );
    },
    update(world) {
      const player = world.getEntity<PlayerComponents>("player");

      if (!player?.components.sprite) {
        return;
      }

      layoutPlayerSprite(
        player.components.sprite,
        world.viewportSize / 2,
        player.components.navigation.headingDeg,
        player.components.status,
        performance.now(),
      );
    },
  };
}

function createThrottleHudSystem(view: ThrottleHudView): System<World> {
  return {
    attach(world) {
      for (const button of view.buttons) {
        button.box.on("pointertap", () => {
          const player = requirePlayer(world);

          if (!isPlayerActive(player)) {
            return;
          }

          player.components.navigation.throttleLevel = button.level;
        });
      }
    },
    resize(world, viewportSize) {
      const player = requirePlayer(world);
      layoutThrottleHud(
        view,
        viewportSize,
        player.components.navigation.throttleLevel,
        isPlayerActive(player),
      );
    },
    update(world) {
      const player = requirePlayer(world);
      layoutThrottleHud(
        view,
        world.viewportSize,
        player.components.navigation.throttleLevel,
        isPlayerActive(player),
      );
    },
  };
}

function createSteeringHudSystem(view: SteeringHudView): System<World> {
  return {
    attach(world) {
      view.leftButton.on("pointertap", () => {
        nudgePlayerCourse(world, -COURSE_TURN_STEP);
      });

      view.rightButton.on("pointertap", () => {
        nudgePlayerCourse(world, COURSE_TURN_STEP);
      });
    },
    resize(world, viewportSize) {
      const player = requirePlayer(world);
      layoutSteeringHud(
        view,
        viewportSize,
        player.components.navigation.courseTurn,
        isPlayerActive(player),
      );
    },
    update(world) {
      const player = requirePlayer(world);
      layoutSteeringHud(
        view,
        world.viewportSize,
        player.components.navigation.courseTurn,
        isPlayerActive(player),
      );
    },
  };
}

function createTorpedoBayHudSystem(view: TorpedoBayHudView): System<World> {
  return {
    attach(world) {
      view.reloadButton.on("pointertap", () => {
        triggerManualReload(world);
      });
    },
    resize(world, viewportSize) {
      const player = requirePlayer(world);
      layoutTorpedoBayHud(view, viewportSize, player.components.torpedoBay, isPlayerActive(player));
    },
    update(world) {
      const player = requirePlayer(world);
      const bay = player.components.torpedoBay;
      const frameMs = performance.now();

      if (bay.reloadStartMs !== null && frameMs - bay.reloadStartMs >= TORPEDO_BAY_RELOAD_DURATION_MS) {
        bay.count = TORPEDO_BAY_MAX_COUNT;
        bay.reloadStartMs = null;
      }

      layoutTorpedoBayHud(view, world.viewportSize, bay, isPlayerActive(player));
    },
  };
}

function createCoursePlotSystem(view: RadarView): System<World> {
  return {
    update(world) {
      const player = requirePlayer(world);
      const center = world.viewportSize / 2;
      const radius = getRadarRadius(world.viewportSize);

      drawCoursePlot(
        view.coursePlot,
        center,
        radius,
        player.components.navigation,
        isPlayerActive(player),
      );
    },
  };
}

function createMineRenderSystem(view: RadarView): System<World> {
  return {
    attach(world) {
      const mines = world.getEntities<MineComponents>().filter(isMineEntity);

      for (const mine of mines) {
        if (mine.components.sprite) {
          world.root.addChild(mine.components.sprite);
        }
      }
    },
    resize(world, viewportSize) {
      const center = viewportSize / 2;
      const radius = getRadarRadius(viewportSize);
      const mines = world.getEntities<MineComponents>().filter(isMineEntity);
      const player = requirePlayer(world);

      for (const mine of mines) {
        if (!mine.components.sprite) {
          continue;
        }

        if (mine.components.status.state !== "active") {
          mine.components.sprite.visible = false;
          continue;
        }

        layoutMineSprite(
          mine.components.sprite,
          center,
          radius,
          player.components.navigation.position,
          mine.components.position,
          mine.components.detection.state,
        );
      }
    },
    update(world) {
      const center = world.viewportSize / 2;
      const radius = getRadarRadius(world.viewportSize);
      const mines = world.getEntities<MineComponents>().filter(isMineEntity);
      const player = requirePlayer(world);
      const frameMs = performance.now();

      drawDetectionBlips(
        view.detectionBlips,
        mines,
        center,
        radius,
        player.components.navigation.position,
        frameMs,
      );

      for (const mine of mines) {
        if (!mine.components.sprite) {
          continue;
        }

        if (!mine.components.sprite.parent) {
          world.root.addChild(mine.components.sprite);
        }

        if (mine.components.status.state !== "active") {
          mine.components.sprite.visible = false;
          continue;
        }

        layoutMineSprite(
          mine.components.sprite,
          center,
          radius,
          player.components.navigation.position,
          mine.components.position,
          mine.components.detection.state,
        );
      }
    },
  };
}

function createTorpedoRenderSystem(view: RadarView): System<World> {
  return {
    update(world) {
      const center = world.viewportSize / 2;
      const radius = getRadarRadius(world.viewportSize);
      const player = requirePlayer(world);
      const torpedoes = world.getEntities<TorpedoComponents>().filter(isTorpedoEntity);
      const enemySubs = world.getEntities<EnemySubComponents>().filter(isEnemySubEntity);
      const frameMs = performance.now();

      view.crosshairLayer.clear();

      for (const torpedo of torpedoes) {
        const { trail } = torpedo.components;
        trail.graphic ??= createTorpedoGraphic();

        if (!trail.graphic.parent) {
          world.root.addChild(trail.graphic);
        }

        const progress = clamp((frameMs - trail.firedAtMs) / trail.durationMs, 0, 1);

        if (progress >= 1) {
          trail.graphic.destroy();
          world.removeEntity(torpedo.id);
          continue;
        }

        const torpedoPos = interpolateWorldPoint(trail.start, trail.target, progress);
        let hitSub = false;

        for (const sub of enemySubs) {
          if (sub.components.status.state !== "active") {
            continue;
          }

          if (
            worldDistance(torpedoPos, sub.components.navigation.position) <
            ENEMY_SUB_COLLISION_RADIUS_UNITS
          ) {
            trail.graphic.destroy();
            world.removeEntity(torpedo.id);
            sub.components.status.state = "destroyed";
            sub.components.status.destroyedAtMs = frameMs;
            sub.components.detection.state = "tracked";
            sub.components.detection.trackedUntilMs = frameMs + MINE_DETONATION_DURATION_MS + 200;
            hitSub = true;
            break;
          }
        }

        if (hitSub) {
          continue;
        }

        drawTorpedoTrail(
          trail.graphic,
          center,
          radius,
          player.components.navigation.position,
          trail.start,
          trail.target,
          progress,
          trail.lengthUnits,
        );

        const crosshairAge = frameMs - trail.firedAtMs;

        if (crosshairAge < TORPEDO_CROSSHAIR_DURATION_MS) {
          drawTorpedoCrosshair(
            view.crosshairLayer,
            trail.clickScreenPos.x,
            trail.clickScreenPos.y,
            clamp(crosshairAge / TORPEDO_CROSSHAIR_DURATION_MS, 0, 1),
          );
        }
      }
    },
    destroy(world) {
      const torpedoes = world.getEntities<TorpedoComponents>().filter(isTorpedoEntity);

      for (const torpedo of torpedoes) {
        torpedo.components.trail.graphic?.destroy();
      }
    },
  };
}

function drawBackground(graphic: Graphics, center: number, radius: number) {
  graphic
    .clear()
    .circle(center, center, radius)
    .fill({ color: 0x031116, alpha: 0.99 })
    .circle(center, center, radius * 0.78)
    .fill({ color: 0x0a2a2e, alpha: 0.48 })
    .circle(center, center, radius * 0.36)
    .fill({ color: 0x2d8074, alpha: 0.14 });
}

function drawRadarFrame(graphic: Graphics, center: number, radius: number) {
  graphic
    .clear()
    .circle(center, center, radius)
    .stroke({ width: 3, color: 0x74f0d2, alpha: 0.58 })
    .circle(center, center, radius + 1)
    .stroke({ width: 1, color: 0xd6c089, alpha: 0.2 });
}

function drawRings(graphic: Graphics, center: number, radius: number) {
  const ringRadii = [0.22, 0.46, 0.7, 0.9].map((value) => radius * value);

  graphic.clear();

  for (const ringRadius of ringRadii) {
    graphic
      .circle(center, center, ringRadius)
      .stroke({ width: 1, color: 0x74f0d2, alpha: 0.16 });
  }
}

function drawTicks(graphic: Graphics, center: number, radius: number) {
  graphic.clear();

  for (let angleDeg = 0; angleDeg < 360; angleDeg += 5) {
    const isMajor = angleDeg % 45 === 0;
    const isMedium = !isMajor && angleDeg % 15 === 0;
    const outer = pointOnRadar(center, radius - 2, angleDeg);
    const innerOffset = isMajor ? 16 : isMedium ? 10 : 6;
    const inner = pointOnRadar(center, radius - innerOffset, angleDeg);

    graphic
      .moveTo(inner.x, inner.y)
      .lineTo(outer.x, outer.y)
      .stroke({
        width: isMajor ? 2 : 1,
        color: 0xefe0ba,
        alpha: isMajor ? 0.9 : isMedium ? 0.45 : 0.24,
        cap: "round",
      });
  }
}

function layoutDegreeLabels(labels: Text[], center: number, radius: number) {
  const labelRadius = radius - 32;
  const fontSize = Math.max(9, Math.round(radius * 0.04));
  const letterSpacing = Math.max(2, Math.round(radius * 0.01));

  for (let index = 0; index < labels.length; index += 1) {
    const label = labels[index];
    const angleDeg = DEGREE_LABELS[index].angleDeg;
    const point = pointOnRadar(center, labelRadius, angleDeg);

    label.style.fontSize = fontSize;
    label.style.letterSpacing = letterSpacing;
    label.position.set(point.x, point.y);
  }
}

function layoutPlayerSprite(
  sprite: Sprite,
  center: number,
  headingDeg: number,
  status: PlayerComponents["status"],
  frameMs: number,
) {
  sprite.position.set(center, center);
  sprite.rotation = (headingDeg * Math.PI) / 180;

  const textureWidth = sprite.texture.width || 1;
  const textureHeight = sprite.texture.height || 1;
  sprite.scale.set(
    PLAYER_TARGET_SIZE_PX / textureWidth,
    PLAYER_TARGET_SIZE_PX / textureHeight,
  );

  if (status.state === "active") {
    sprite.alpha = 1;
    return;
  }

  if (status.state === "destroyed") {
    sprite.alpha = 0;
    return;
  }

  const elapsedMs = frameMs - (status.detonatedAtMs ?? frameMs);
  const flash = 0.35 + Math.abs(Math.sin(elapsedMs / 38)) * 0.65;
  sprite.alpha = Math.max(0, 1 - elapsedMs / DETONATION_DURATION_MS) * flash;
}

function layoutThrottleHud(
  view: ThrottleHudView,
  viewportSize: number,
  activeLevel: ThrottleLevel,
  isInteractive: boolean,
) {
  const panelWidth = Math.max(108, Math.round(viewportSize * 0.18));
  const rowHeight = Math.max(24, Math.round(viewportSize * 0.042));
  const panelHeight = 24 + rowHeight * view.buttons.length + 18;
  const margin = Math.max(18, Math.round(viewportSize * 0.04));
  const x = margin;
  const y = viewportSize - panelHeight - margin;

  view.container.position.set(x, y);
  view.container.alpha = isInteractive ? 1 : 0.38;

  view.panel
    .clear()
    .roundRect(0, 0, panelWidth, panelHeight, 14)
    .fill({ color: 0x061118, alpha: 0.72 })
    .roundRect(0, 0, panelWidth, panelHeight, 14)
    .stroke({ width: 1, color: 0x74f0d2, alpha: 0.24 });

  view.title.position.set(12, 14);
  view.title.style.fontSize = Math.max(11, Math.round(viewportSize * 0.02));

  for (let index = 0; index < view.buttons.length; index += 1) {
    const button = view.buttons[index];
    const top = 26 + index * rowHeight;
    const isActive = button.level === activeLevel;

    button.box
      .clear()
      .roundRect(10, top, panelWidth - 20, rowHeight - 4, 10)
      .fill({
        color: isActive ? 0x1f5e57 : 0x0b2128,
        alpha: isActive ? 0.96 : 0.66,
      })
      .roundRect(10, top, panelWidth - 20, rowHeight - 4, 10)
      .stroke({
        width: 1,
        color: isActive ? 0xf6fffa : 0x74f0d2,
        alpha: isActive ? 0.42 : 0.2,
      });

    button.label.position.set(panelWidth / 2, top + (rowHeight - 4) / 2);
    button.label.style.fontSize = Math.max(11, Math.round(viewportSize * 0.021));
    button.label.style.fill = isActive ? 0xf6fffa : 0xd3dde3;
    button.label.alpha = isActive ? 1 : 0.88;
  }
}

function layoutSteeringHud(
  view: SteeringHudView,
  viewportSize: number,
  courseTurn: number,
  isInteractive: boolean,
) {
  const panelWidth = Math.max(156, Math.round(viewportSize * 0.24));
  const panelHeight = Math.max(94, Math.round(viewportSize * 0.16));
  const margin = Math.max(18, Math.round(viewportSize * 0.04));
  const x = viewportSize - panelWidth - margin;
  const y = viewportSize - panelHeight - margin;
  const buttonWidth = (panelWidth - 30) / 2;
  const buttonHeight = Math.max(26, Math.round(viewportSize * 0.042));

  view.container.position.set(x, y);
  view.container.alpha = isInteractive ? 1 : 0.38;

  view.panel
    .clear()
    .roundRect(0, 0, panelWidth, panelHeight, 14)
    .fill({ color: 0x061118, alpha: 0.72 })
    .roundRect(0, 0, panelWidth, panelHeight, 14)
    .stroke({ width: 1, color: 0x74f0d2, alpha: 0.24 });

  view.title.position.set(12, 14);
  view.title.style.fontSize = Math.max(11, Math.round(viewportSize * 0.02));

  const leftActive = courseTurn < 0;
  const rightActive = courseTurn > 0;
  const top = 26;

  drawHudButton(view.leftButton, 10, top, buttonWidth, buttonHeight, leftActive);
  drawHudButton(view.rightButton, 20 + buttonWidth, top, buttonWidth, buttonHeight, rightActive);

  view.leftLabel.position.set(10 + buttonWidth / 2, top + buttonHeight / 2);
  view.rightLabel.position.set(20 + buttonWidth + buttonWidth / 2, top + buttonHeight / 2);
  view.leftLabel.style.fontSize = Math.max(11, Math.round(viewportSize * 0.02));
  view.rightLabel.style.fontSize = Math.max(11, Math.round(viewportSize * 0.02));

  view.statusLabel.position.set(panelWidth / 2, panelHeight - 18);
  view.statusLabel.style.fontSize = Math.max(11, Math.round(viewportSize * 0.019));
  view.statusLabel.text = isInteractive ? formatCourseStatus(courseTurn) : "Offline";
}

function layoutTorpedoBayHud(
  view: TorpedoBayHudView,
  viewportSize: number,
  bay: PlayerComponents["torpedoBay"],
  isInteractive: boolean,
) {
  const panelWidth = Math.max(148, Math.round(viewportSize * 0.24));
  const slotGap = Math.max(4, Math.round(panelWidth * 0.028));
  const slotWidth = Math.floor((panelWidth - 20 - slotGap * (TORPEDO_BAY_MAX_COUNT - 1)) / TORPEDO_BAY_MAX_COUNT);
  const slotHeight = Math.round(slotWidth * 1.8);
  const buttonHeight = Math.max(20, Math.round(viewportSize * 0.032));
  const panelHeight = 26 + slotHeight + 8 + buttonHeight + 10;
  const margin = Math.max(18, Math.round(viewportSize * 0.04));
  const x = Math.round(viewportSize / 2 - panelWidth / 2);
  const y = viewportSize - panelHeight - margin;

  view.container.position.set(x, y);
  view.container.alpha = isInteractive ? 1 : 0.38;

  const isReloading = bay.reloadStartMs !== null;
  const canReload = isInteractive && !isReloading && bay.count < TORPEDO_BAY_MAX_COUNT;
  const reloadProgress = isReloading
    ? clamp((performance.now() - (bay.reloadStartMs ?? 0)) / TORPEDO_BAY_RELOAD_DURATION_MS, 0, 1)
    : 0;

  view.panel
    .clear()
    .roundRect(0, 0, panelWidth, panelHeight, 14)
    .fill({ color: 0x061118, alpha: 0.72 })
    .roundRect(0, 0, panelWidth, panelHeight, 14)
    .stroke({ width: 1, color: 0x74f0d2, alpha: 0.24 });

  view.title.position.set(12, 14);
  view.title.style.fontSize = Math.max(11, Math.round(viewportSize * 0.02));

  const slotsY = 24;

  for (let i = 0; i < TORPEDO_BAY_MAX_COUNT; i++) {
    const slotX = 10 + i * (slotWidth + slotGap);
    const loaded = !isReloading && i < bay.count;

    view.panel
      .roundRect(slotX, slotsY, slotWidth, slotHeight, 3)
      .fill({ color: loaded ? 0x0a2e2c : 0x060e14, alpha: 0.95 });

    if (loaded) {
      view.panel
        .roundRect(slotX + 2, slotsY + 2, slotWidth - 4, slotHeight - 4, 2)
        .fill({ color: 0x74f0d2, alpha: 0.16 });

      view.panel
        .roundRect(slotX + 3, slotsY + 3, slotWidth - 6, Math.round((slotHeight - 6) * 0.4), 2)
        .fill({ color: 0x74f0d2, alpha: 0.36 });

      view.panel
        .circle(slotX + slotWidth / 2, slotsY + 4, 1.5)
        .fill({ color: 0xf6fffa, alpha: 0.85 });
    }

    view.panel
      .roundRect(slotX, slotsY, slotWidth, slotHeight, 3)
      .stroke({
        width: 1,
        color: loaded ? 0x74f0d2 : 0x1a3e4a,
        alpha: loaded ? 0.62 : 0.25,
      });
  }

  const btnX = 10;
  const btnY = slotsY + slotHeight + 8;
  const btnW = panelWidth - 20;
  const btnLabelFontSize = Math.max(10, Math.round(viewportSize * 0.018));

  view.reloadButton.clear();

  if (isReloading) {
    view.reloadButton.cursor = "default";

    view.reloadButton
      .roundRect(btnX, btnY, btnW, buttonHeight, 8)
      .fill({ color: 0x060f14, alpha: 0.9 })
      .roundRect(btnX, btnY, btnW, buttonHeight, 8)
      .stroke({ width: 1, color: 0x74f0d2, alpha: 0.28 });

    if (reloadProgress > 0.01) {
      view.reloadButton
        .roundRect(btnX + 1, btnY + 1, Math.max(4, (btnW - 2) * reloadProgress), buttonHeight - 2, 7)
        .fill({ color: 0x74f0d2, alpha: 0.5 });
    }

    view.reloadButtonLabel.text = "Reloading";
    view.reloadButtonLabel.alpha = 0.72 + Math.abs(Math.sin(performance.now() / 420)) * 0.28;
    view.reloadButtonLabel.style.fill = 0x74f0d2;
  } else {
    view.reloadButton.cursor = canReload ? "pointer" : "default";

    view.reloadButton
      .roundRect(btnX, btnY, btnW, buttonHeight, 8)
      .fill({ color: canReload ? 0x0d3030 : 0x080e14, alpha: canReload ? 0.88 : 0.55 })
      .roundRect(btnX, btnY, btnW, buttonHeight, 8)
      .stroke({ width: 1, color: canReload ? 0x74f0d2 : 0x1a3e4a, alpha: canReload ? 0.48 : 0.18 });

    view.reloadButtonLabel.text = "Reload  [R]";
    view.reloadButtonLabel.alpha = canReload ? 0.88 : 0.32;
    view.reloadButtonLabel.style.fill = canReload ? 0xd3dde3 : 0x4a6a74;
  }

  view.reloadButtonLabel.position.set(btnX + btnW / 2, btnY + buttonHeight / 2);
  view.reloadButtonLabel.style.fontSize = btnLabelFontSize;
}

function layoutMineSprite(
  sprite: Sprite | Graphics,
  center: number,
  radius: number,
  playerPosition: PlayerComponents["navigation"]["position"],
  minePosition: MineComponents["position"],
  detectionState: MineComponents["detection"]["state"],
) {
  const point = projectEntityToRadarIfVisible(center, radius, playerPosition, minePosition);
  const isVisible = detectionState !== "hidden" && point !== null;

  sprite.visible = isVisible;

  if (point) {
    sprite.position.set(point.x, point.y);
  }

  sprite.alpha = detectionState === "ping" ? 1 : 0.92;

  if (sprite instanceof Sprite) {
    const textureWidth = sprite.texture.width || 1;
    const textureHeight = sprite.texture.height || 1;
    const baseScaleX = MINE_TARGET_SIZE_PX / textureWidth;
    const baseScaleY = MINE_TARGET_SIZE_PX / textureHeight;
    const pingScale = detectionState === "ping" ? 1.2 : 1;

    sprite.scale.set(baseScaleX * pingScale, baseScaleY * pingScale);
    return;
  }

  const pingScale = detectionState === "ping" ? 1.2 : 1;
  sprite.scale.set(pingScale);
}

function drawCoursePlot(
  graphic: Graphics,
  center: number,
  radius: number,
  navigation: PlayerComponents["navigation"],
  isVisible: boolean,
) {
  if (!isVisible) {
    graphic.clear();
    return;
  }

  const previewPoints = sampleCoursePreview(navigation);

  graphic.clear();

  for (let index = 0; index < previewPoints.length - 1; index += 1) {
    if (index % 2 === 1) {
      continue;
    }

    const from = clampWorldToRadarRadius(
      navigation.position,
      previewPoints[index],
      RADAR_WORLD_RADIUS_UNITS * 0.9,
    );
    const to = clampWorldToRadarRadius(
      navigation.position,
      previewPoints[index + 1],
      RADAR_WORLD_RADIUS_UNITS * 0.9,
    );
    const fromPoint = projectWorldToRadar(
      center,
      radius,
      navigation.position,
      from,
      RADAR_WORLD_RADIUS_UNITS,
    );
    const toPoint = projectWorldToRadar(
      center,
      radius,
      navigation.position,
      to,
      RADAR_WORLD_RADIUS_UNITS,
    );

    graphic
      .moveTo(fromPoint.x, fromPoint.y)
      .lineTo(toPoint.x, toPoint.y)
      .stroke({ width: 2, color: 0xefe0ba, alpha: 0.82, cap: "round" });
  }
}

function drawTorpedoTrail(
  graphic: Graphics,
  center: number,
  radius: number,
  origin: PlayerComponents["navigation"]["position"],
  start: { x: number; y: number },
  target: { x: number; y: number },
  progress: number,
  lengthUnits: number,
  color = 0xf6fffa,
) {
  const totalDistance = worldDistance(start, target);

  if (totalDistance === 0) {
    graphic.clear();
    return;
  }

  const headDistance = totalDistance * progress;
  const tailDistance = Math.max(0, headDistance - lengthUnits);
  const headPointWorld = interpolateWorldPoint(start, target, headDistance / totalDistance);
  const tailPointWorld = interpolateWorldPoint(start, target, tailDistance / totalDistance);
  const clampedHead = clampWorldToRadarRadius(origin, headPointWorld);
  const clampedTail = clampWorldToRadarRadius(origin, tailPointWorld);
  const headPoint = projectWorldToRadar(center, radius, origin, clampedHead, RADAR_WORLD_RADIUS_UNITS);
  const tailPoint = projectWorldToRadar(center, radius, origin, clampedTail, RADAR_WORLD_RADIUS_UNITS);

  graphic.clear();

  for (let seg = 0; seg < TORPEDO_TRAIL_GRADIENT_SEGMENTS; seg++) {
    const tFrom = seg / TORPEDO_TRAIL_GRADIENT_SEGMENTS;
    const tTo = (seg + 1) / TORPEDO_TRAIL_GRADIENT_SEGMENTS;
    const segAlpha = ((tFrom + tTo) / 2) * 0.96;
    const fromX = tailPoint.x + (headPoint.x - tailPoint.x) * tFrom;
    const fromY = tailPoint.y + (headPoint.y - tailPoint.y) * tFrom;
    const toX = tailPoint.x + (headPoint.x - tailPoint.x) * tTo;
    const toY = tailPoint.y + (headPoint.y - tailPoint.y) * tTo;

    graphic
      .moveTo(fromX, fromY)
      .lineTo(toX, toY)
      .stroke({ width: TORPEDO_VISUAL_WIDTH_PX, color, alpha: segAlpha, cap: "round" });
  }

  graphic
    .circle(headPoint.x, headPoint.y, 2.5)
    .fill({ color, alpha: 0.95 });
}

function drawTorpedoCrosshair(
  graphic: Graphics,
  x: number,
  y: number,
  fadeProgress: number,
) {
  const alpha = (1 - fadeProgress) * 0.88;
  const expand = fadeProgress * 4;
  const size = TORPEDO_CROSSHAIR_SIZE_PX + expand;

  graphic
    .moveTo(x - size, y)
    .lineTo(x - 3 - expand, y)
    .moveTo(x + 3 + expand, y)
    .lineTo(x + size, y)
    .moveTo(x, y - size)
    .lineTo(x, y - 3 - expand)
    .moveTo(x, y + 3 + expand)
    .lineTo(x, y + size)
    .stroke({ width: 1, color: 0x74f0d2, alpha, cap: "square" });

  graphic
    .circle(x, y, 2.5 + expand * 0.4)
    .stroke({ width: 1, color: 0x74f0d2, alpha: alpha * 0.7 });
}

function drawSweepTrail(
  graphic: Graphics,
  center: number,
  radius: number,
  sweepAngleDeg: number,
  trailDegrees: number,
) {
  graphic.clear();

  const layerCount = 7;

  for (let layer = 0; layer < layerCount; layer += 1) {
    const progress = layer / (layerCount - 1);
    const layerTrailDegrees = trailDegrees * (1 - progress * 0.65);
    const layerRadius = radius * (1 - progress * 0.015);
    const layerAngleDeg = sweepAngleDeg - progress * trailDegrees * 0.14;
    const alpha = 0.02 + (1 - progress) * 0.045;
    const color = layer < 2 ? 0xbaffee : 0x74f0d2;
    const points = buildSweepPolygonPoints(center, layerRadius, layerAngleDeg, layerTrailDegrees);

    graphic.poly(points).fill({ color, alpha });
  }
}

function drawSweepLineGlow(
  graphic: Graphics,
  center: number,
  radius: number,
  sweepAngleDeg: number,
) {
  const end = pointOnRadar(center, radius, sweepAngleDeg);

  graphic
    .clear()
    .moveTo(center, center)
    .lineTo(end.x, end.y)
    .stroke({ width: 6, color: 0x74f0d2, alpha: 0.14, cap: "round" });
}

function drawSweepLine(
  graphic: Graphics,
  center: number,
  radius: number,
  sweepAngleDeg: number,
) {
  const end = pointOnRadar(center, radius, sweepAngleDeg);

  graphic
    .clear()
    .moveTo(center, center)
    .lineTo(end.x, end.y)
    .stroke({ width: 2, color: 0xf6fffa, alpha: 0.95, cap: "round" });
}

function drawCartesianGrid(
  graphic: Graphics,
  center: number,
  radius: number,
  origin: PlayerComponents["navigation"]["position"],
  sweepSamples: SweepSample[],
) {
  graphic.clear();
  const frameMs = performance.now();

  drawGridCellGlowFamily(
    graphic,
    center,
    radius,
    origin,
    RADAR_GRID_MINOR_SPACING_UNITS,
    sweepSamples,
    frameMs,
    { color: 0x74f0d2, maxAlpha: 0.2, insetPx: 1 },
  );
  drawGridFamily(
    graphic,
    center,
    radius,
    origin,
    RADAR_GRID_MINOR_SPACING_UNITS,
    { color: 0x74f0d2, alpha: 0.08, width: 1 },
  );
  drawGridFamily(
    graphic,
    center,
    radius,
    origin,
    RADAR_GRID_MAJOR_SPACING_UNITS,
    { color: 0xbaffee, alpha: 0.18, width: 1.4 },
  );
}

function drawGridFamily(
  graphic: Graphics,
  center: number,
  radius: number,
  origin: PlayerComponents["navigation"]["position"],
  spacingUnits: number,
  style: { color: number; alpha: number; width: number },
) {
  const scale = radius / RADAR_WORLD_RADIUS_UNITS;
  const minWorldX = origin.x - RADAR_WORLD_RADIUS_UNITS;
  const maxWorldX = origin.x + RADAR_WORLD_RADIUS_UNITS;
  const minVerticalIndex = Math.ceil(minWorldX / spacingUnits);
  const maxVerticalIndex = Math.floor(maxWorldX / spacingUnits);

  for (let lineIndex = minVerticalIndex; lineIndex <= maxVerticalIndex; lineIndex += 1) {
    const worldX = lineIndex * spacingUnits;
    const screenX = center + (worldX - origin.x) * scale;
    const xDelta = screenX - center;

    if (Math.abs(xDelta) >= radius) {
      continue;
    }

    const halfChord = Math.sqrt(radius * radius - xDelta * xDelta);
    graphic
      .moveTo(screenX, center - halfChord)
      .lineTo(screenX, center + halfChord)
      .stroke(style);
  }

  const minWorldY = origin.y - RADAR_WORLD_RADIUS_UNITS;
  const maxWorldY = origin.y + RADAR_WORLD_RADIUS_UNITS;
  const minHorizontalIndex = Math.ceil(minWorldY / spacingUnits);
  const maxHorizontalIndex = Math.floor(maxWorldY / spacingUnits);

  for (let lineIndex = minHorizontalIndex; lineIndex <= maxHorizontalIndex; lineIndex += 1) {
    const worldY = lineIndex * spacingUnits;
    const screenY = center + (worldY - origin.y) * scale;
    const yDelta = screenY - center;

    if (Math.abs(yDelta) >= radius) {
      continue;
    }

    const halfChord = Math.sqrt(radius * radius - yDelta * yDelta);
    graphic
      .moveTo(center - halfChord, screenY)
      .lineTo(center + halfChord, screenY)
      .stroke(style);
  }
}

function drawGridCellGlowFamily(
  graphic: Graphics,
  center: number,
  radius: number,
  origin: PlayerComponents["navigation"]["position"],
  spacingUnits: number,
  sweepSamples: SweepSample[],
  frameMs: number,
  style: { color: number; maxAlpha: number; insetPx: number },
) {
  const scale = radius / RADAR_WORLD_RADIUS_UNITS;
  const minWorldX = origin.x - RADAR_WORLD_RADIUS_UNITS;
  const maxWorldX = origin.x + RADAR_WORLD_RADIUS_UNITS;
  const minWorldY = origin.y - RADAR_WORLD_RADIUS_UNITS;
  const maxWorldY = origin.y + RADAR_WORLD_RADIUS_UNITS;
  const minCellXIndex = Math.ceil(minWorldX / spacingUnits);
  const maxCellXIndex = Math.floor(maxWorldX / spacingUnits) - 1;
  const minCellYIndex = Math.ceil(minWorldY / spacingUnits);
  const maxCellYIndex = Math.floor(maxWorldY / spacingUnits) - 1;

  for (let xIndex = minCellXIndex; xIndex <= maxCellXIndex; xIndex += 1) {
    const worldX0 = xIndex * spacingUnits;
    const worldX1 = worldX0 + spacingUnits;
    const screenX0 = center + (worldX0 - origin.x) * scale;
    const screenX1 = center + (worldX1 - origin.x) * scale;

    for (let yIndex = minCellYIndex; yIndex <= maxCellYIndex; yIndex += 1) {
      const worldY0 = yIndex * spacingUnits;
      const worldY1 = worldY0 + spacingUnits;
      const screenY0 = center + (worldY0 - origin.y) * scale;
      const screenY1 = center + (worldY1 - origin.y) * scale;
      const cellCenterX = (screenX0 + screenX1) / 2;
      const cellCenterY = (screenY0 + screenY1) / 2;

      if (Math.hypot(cellCenterX - center, cellCenterY - center) >= radius) {
        continue;
      }

      const alpha = computeGridGlowAlpha(center, cellCenterX, cellCenterY, sweepSamples, frameMs);

      if (alpha <= 0.02) {
        continue;
      }

      const left = Math.min(screenX0, screenX1) + style.insetPx;
      const top = Math.min(screenY0, screenY1) + style.insetPx;
      const width = Math.abs(screenX1 - screenX0) - style.insetPx * 2;
      const height = Math.abs(screenY1 - screenY0) - style.insetPx * 2;

      if (width <= 0 || height <= 0) {
        continue;
      }

      graphic
        .rect(left, top, width, height)
        .fill({
          color: style.color,
          alpha: Math.min(style.maxAlpha, alpha * style.maxAlpha),
        });
    }
  }
}

function computeGridGlowAlpha(
  center: number,
  x: number,
  y: number,
  sweepSamples: SweepSample[],
  frameMs: number,
) {
  const pointAngleDeg = normalizeAngle((Math.atan2(x - center, center - y) * 180) / Math.PI);
  let strongest = 0;

  for (const sample of sweepSamples) {
    const ageMs = frameMs - sample.recordedAtMs;

    if (ageMs < 0 || ageMs > RADAR_GRID_SCAN_FADE_MS) {
      continue;
    }

    const timeStrength = 1 - ageMs / RADAR_GRID_SCAN_FADE_MS;
    const angularDistance = shortestAngleDistanceDeg(pointAngleDeg, sample.angleDeg);

    if (angularDistance > RADAR_GRID_GLOW_HALF_ANGLE_DEG) {
      continue;
    }

    const angularStrength = 1 - angularDistance / RADAR_GRID_GLOW_HALF_ANGLE_DEG;
    strongest = Math.max(strongest, timeStrength * angularStrength);
  }

  return strongest;
}

function pruneSweepSamples(samples: SweepSample[], frameMs: number) {
  while (
    samples.length > 0 &&
    frameMs - samples[0].recordedAtMs > RADAR_GRID_SCAN_FADE_MS
  ) {
    samples.shift();
  }
}

function shortestAngleDistanceDeg(a: number, b: number) {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

function sampleCoursePreview(navigation: PlayerComponents["navigation"]) {
  const previewSpeed = Math.max(
    navigation.speedUnitsPerSecond,
    navigation.throttleLevel === 0 ? COURSE_PREVIEW_MIN_SPEED * 0.6 : COURSE_PREVIEW_MIN_SPEED,
  );
  const points = [{ ...navigation.position }];
  let headingDeg = navigation.headingDeg;
  let position = { ...navigation.position };
  let distanceRemaining = COURSE_PREVIEW_DISTANCE_UNITS;

  while (distanceRemaining > 0) {
    if (navigation.courseTurn !== 0) {
      const turnRadius = PLAYER_MIN_TURN_RADIUS_UNITS / Math.abs(navigation.courseTurn);
      const turnRateDegPerSecond = (previewSpeed / turnRadius) * (180 / Math.PI);
      headingDeg = normalizeDegrees(
        headingDeg +
          Math.sign(navigation.courseTurn) * turnRateDegPerSecond * COURSE_PREVIEW_STEP_SECONDS,
      );
    }

    const headingRad = ((headingDeg - 90) * Math.PI) / 180;
    const distance = Math.min(
      previewSpeed * COURSE_PREVIEW_STEP_SECONDS,
      distanceRemaining,
    );
    position = {
      x: position.x + Math.cos(headingRad) * distance,
      y: position.y + Math.sin(headingRad) * distance,
    };
    points.push(position);
    distanceRemaining -= distance;
  }

  return points;
}

function updateMineDetection(
  playerPosition: PlayerComponents["navigation"]["position"],
  mine: MineComponents,
  previousSweepAngleDeg: number,
  sweepAngleDeg: number,
  frameMs: number,
) {
  const sweptAcrossContact = didSweepLineCrossAngle(
    previousSweepAngleDeg,
    sweepAngleDeg,
    worldBearingDeg(playerPosition, mine.position),
  );

  if (sweptAcrossContact && mine.detection.state === "hidden") {
    mine.detection.state = "ping";
    mine.detection.revealedAtMs = frameMs;
    return;
  }

  if (
    mine.detection.state === "ping" &&
    mine.detection.revealedAtMs !== null &&
    frameMs - mine.detection.revealedAtMs >= DETECTION_PING_DURATION_MS
  ) {
    mine.detection.state = "tracked";
  }
}

function drawDetectionBlips(
  graphic: Graphics,
  mines: EntityWithMine[],
  center: number,
  radius: number,
  playerPosition: PlayerComponents["navigation"]["position"],
  frameMs: number,
) {
  graphic.clear();

  for (const mine of mines) {
    if (mine.components.status.state !== "active") {
      continue;
    }

    if (mine.components.detection.state !== "ping") {
      continue;
    }

    const point = projectEntityToRadarIfVisible(
      center,
      radius,
      playerPosition,
      mine.components.position,
    );

    if (!point) {
      continue;
    }

    const progress = clamp(
      (frameMs - (mine.components.detection.revealedAtMs ?? frameMs)) /
        DETECTION_PING_DURATION_MS,
      0,
      1,
    );
    const pulseRadius = 10 + progress * 18;
    const pulseAlpha = 0.7 * (1 - progress);

    graphic
      .circle(point.x, point.y, pulseRadius)
      .stroke({ width: 2, color: 0xf6fffa, alpha: pulseAlpha })
      .circle(point.x, point.y, 3 + progress * 2)
      .fill({ color: 0xf6fffa, alpha: Math.max(0.16, pulseAlpha) });
  }
}

function drawDetonationEffects(
  graphic: Graphics,
  center: number,
  radius: number,
  frameMs: number,
  detonatedAtMs: number,
) {
  graphic.clear();
  const progress = clamp((frameMs - detonatedAtMs) / DETONATION_DURATION_MS, 0, 1);
  const flashAlpha = progress < 0.2 ? (0.2 - progress) / 0.2 : 0;
  const shockRadius = radius * (0.08 + progress * 0.5);
  const coreRadius = radius * (0.03 + progress * 0.16);

  graphic
    .circle(center, center, coreRadius)
    .fill({ color: 0xfff2c9, alpha: 0.9 * (1 - progress * 0.72) })
    .circle(center, center, shockRadius)
    .stroke({ width: 3, color: 0xff9875, alpha: 0.8 * (1 - progress) })
    .circle(center, center, shockRadius * 0.68)
    .stroke({ width: 1, color: 0xffc07f, alpha: 0.55 * (1 - progress) });

  if (flashAlpha > 0) {
    graphic
      .circle(center, center, radius)
      .fill({ color: 0xffd6a2, alpha: flashAlpha * 0.4 });
  }
}

function drawMineDetonationEffect(
  graphic: Graphics,
  x: number,
  y: number,
  frameMs: number,
  detonatedAtMs: number,
) {
  const progress = clamp((frameMs - detonatedAtMs) / MINE_DETONATION_DURATION_MS, 0, 1);
  const shockRadius = 5 + progress * 30;
  const coreRadius = 3 + progress * 9;
  const alpha = 1 - progress;
  const flashAlpha = progress < 0.15 ? (0.15 - progress) / 0.15 : 0;

  graphic
    .circle(x, y, coreRadius)
    .fill({ color: 0xfff2c9, alpha: 0.9 * alpha })
    .circle(x, y, shockRadius)
    .stroke({ width: 2, color: 0xff9875, alpha: 0.8 * alpha })
    .circle(x, y, shockRadius * 0.62)
    .stroke({ width: 1, color: 0xffc07f, alpha: 0.55 * alpha });

  if (flashAlpha > 0) {
    graphic
      .circle(x, y, shockRadius * 1.4)
      .fill({ color: 0xffd6a2, alpha: flashAlpha * 0.5 });
  }
}

function buildSweepPolygonPoints(
  center: number,
  radius: number,
  sweepAngleDeg: number,
  trailDegrees: number,
) {
  const arcSteps = Math.max(8, Math.ceil(trailDegrees / 4));
  const points = [center, center];
  const trailStartDeg = sweepAngleDeg - trailDegrees;

  for (let step = 0; step <= arcSteps; step += 1) {
    const angleDeg = trailStartDeg + (trailDegrees * step) / arcSteps;
    const point = pointOnRadar(center, radius, angleDeg);
    points.push(point.x, point.y);
  }

  return points;
}

function pointOnRadar(center: number, radius: number, angleDeg: number) {
  const angleRad = degreesToRadians(angleDeg - 90);

  return {
    x: center + Math.cos(angleRad) * radius,
    y: center + Math.sin(angleRad) * radius,
  };
}

function didSweepLineCrossAngle(
  previousSweepAngleDeg: number,
  sweepAngleDeg: number,
  targetAngleDeg: number,
) {
  const start = normalizeAngle(previousSweepAngleDeg);
  const end = normalizeAngle(sweepAngleDeg);
  const target = normalizeAngle(targetAngleDeg);

  if (start <= end) {
    return target > start && target <= end;
  }

  return target > start || target <= end;
}

function normalizeAngle(angleDeg: number) {
  return ((angleDeg % 360) + 360) % 360;
}

function degreesToRadians(angleDeg: number) {
  return (angleDeg * Math.PI) / 180;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function interpolateWorldPoint(
  start: { x: number; y: number },
  target: { x: number; y: number },
  t: number,
) {
  return {
    x: start.x + (target.x - start.x) * t,
    y: start.y + (target.y - start.y) * t,
  };
}

function projectEntityToRadarIfVisible(
  center: number,
  radius: number,
  origin: PlayerComponents["navigation"]["position"],
  target: { x: number; y: number },
) {
  if (worldDistance(origin, target) > RADAR_CONTACT_VISIBLE_RADIUS_UNITS) {
    return null;
  }

  return projectWorldToRadar(
    center,
    radius,
    origin,
    target,
    RADAR_WORLD_RADIUS_UNITS,
  );
}

function getRadarRadius(viewportSize: number) {
  return viewportSize / 2 - Math.max(26, Math.round(viewportSize * 0.08));
}

function triggerManualReload(world: World) {
  const player = requirePlayer(world);

  if (!isPlayerActive(player)) {
    return;
  }

  const bay = player.components.torpedoBay;

  if (bay.reloadStartMs !== null || bay.count >= TORPEDO_BAY_MAX_COUNT) {
    return;
  }

  bay.reloadStartMs = performance.now();
}

function setPlayerThrottle(world: World, delta: -1 | 1) {
  const player = requirePlayer(world);

  if (!isPlayerActive(player)) {
    return;
  }

  const next = clamp(player.components.navigation.throttleLevel + delta, 0, 2) as ThrottleLevel;
  player.components.navigation.throttleLevel = next;
}

function firePlayerTorpedo(world: World, event: FederatedPointerEvent) {
  const player = requirePlayer(world);

  if (!isPlayerActive(player) || world.viewportSize <= 0) {
    return;
  }

  if (player.components.torpedoBay.count <= 0) {
    return;
  }

  const center = world.viewportSize / 2;
  const radarRadius = getRadarRadius(world.viewportSize);
  const clickPoint = event.global;
  const deltaX = clickPoint.x - center;
  const deltaY = clickPoint.y - center;
  const clickDistancePx = Math.hypot(deltaX, deltaY);
  const playerRadiusPx = PLAYER_TARGET_SIZE_PX * 0.7;

  if (clickDistancePx <= playerRadiusPx || clickDistancePx > radarRadius) {
    return;
  }

  const worldScale = RADAR_WORLD_RADIUS_UNITS / radarRadius;
  const origin = player.components.navigation.position;
  const aimOffset = {
    x: deltaX * worldScale,
    y: deltaY * worldScale,
  };
  const aimDistance = Math.hypot(aimOffset.x, aimOffset.y);

  if (aimDistance <= 0) {
    return;
  }

  const travelDistance = (TORPEDO_SPEED_UNITS_PER_SECOND * TORPEDO_FUSE_DURATION_MS) / 1000;
  const target = {
    x: origin.x + (aimOffset.x / aimDistance) * travelDistance,
    y: origin.y + (aimOffset.y / aimDistance) * travelDistance,
  };

  const firedAtMs = performance.now();
  const bay = player.components.torpedoBay;
  bay.count -= 1;

  if (bay.count === 0) {
    bay.reloadStartMs = firedAtMs;
  }

  world.addEntity<TorpedoComponents>({
    id: `torpedo-${firedAtMs}-${Math.random().toString(36).slice(2, 8)}`,
    components: {
      kind: "torpedo",
      trail: {
        start: { ...origin },
        target,
        firedAtMs,
        durationMs: TORPEDO_FUSE_DURATION_MS,
        lengthUnits: TORPEDO_TRAIL_LENGTH_UNITS,
        graphic: createTorpedoGraphic(),
        clickScreenPos: { x: clickPoint.x, y: clickPoint.y },
      },
    },
  });
}

function nudgePlayerCourse(world: World, delta: number) {
  const player = requirePlayer(world);

  if (!isPlayerActive(player)) {
    return;
  }

  const next = clamp(
    player.components.navigation.courseTurn + delta,
    -COURSE_TURN_LIMIT,
    COURSE_TURN_LIMIT,
  );

  player.components.navigation.courseTurn = Number(next.toFixed(4));
}

function drawHudButton(
  graphic: Graphics,
  x: number,
  y: number,
  width: number,
  height: number,
  isActive: boolean,
) {
  graphic
    .clear()
    .roundRect(x, y, width, height, 10)
    .fill({
      color: isActive ? 0x1f5e57 : 0x0b2128,
      alpha: isActive ? 0.96 : 0.66,
    })
    .roundRect(x, y, width, height, 10)
    .stroke({
      width: 1,
      color: isActive ? 0xf6fffa : 0x74f0d2,
      alpha: isActive ? 0.42 : 0.2,
    });
}

function formatCourseStatus(courseTurn: number) {
  if (courseTurn === 0) {
    return "Straight";
  }

  const direction = courseTurn < 0 ? "Port" : "Starboard";
  const intensity = Math.round(Math.abs(courseTurn) * 100);

  return `${direction} ${intensity}%`;
}

function requirePlayer(world: World) {
  const player = world.getEntity<PlayerComponents>("player");

  if (!player) {
    throw new Error("Player entity not found");
  }

  return player;
}

function isPlayerActive(player: { components: PlayerComponents }) {
  return player.components.status.state === "active";
}

type EntityWithMine = {
  id: string;
  components: MineComponents;
};

function isMineEntity(entity: RadarEntity): entity is EntityWithMine {
  return entity.components.kind === "mine";
}

type EntityWithTorpedo = {
  id: string;
  components: TorpedoComponents;
};

function isTorpedoEntity(entity: RadarEntity): entity is EntityWithTorpedo {
  return entity.components.kind === "torpedo";
}

function createKillCounterHudSystem(view: KillCounterHudView): System<World> {
  let kills = 0;
  const counted = new Set<string>();

  return {
    resize(_world, viewportSize) {
      layoutKillCounterHud(view, viewportSize, kills);
    },
    update(world) {
      const subs = world.getEntities<EnemySubComponents>().filter(isEnemySubEntity);

      for (const sub of subs) {
        if (sub.components.status.state === "destroyed" && !counted.has(sub.id)) {
          counted.add(sub.id);
          kills++;
        }
      }

      layoutKillCounterHud(view, world.viewportSize, kills);
    },
  };
}

function layoutKillCounterHud(view: KillCounterHudView, viewportSize: number, kills: number) {
  const margin = Math.max(18, Math.round(viewportSize * 0.04));
  const panelWidth = Math.max(80, Math.round(viewportSize * 0.13));
  const panelHeight = Math.max(62, Math.round(viewportSize * 0.1));

  view.container.position.set(margin, margin);

  view.panel
    .clear()
    .roundRect(0, 0, panelWidth, panelHeight, 14)
    .fill({ color: 0x061118, alpha: 0.72 })
    .roundRect(0, 0, panelWidth, panelHeight, 14)
    .stroke({ width: 1, color: 0x74f0d2, alpha: 0.24 });

  view.title.position.set(12, 14);
  view.title.style.fontSize = Math.max(11, Math.round(viewportSize * 0.02));

  view.countLabel.text = String(kills);
  view.countLabel.style.fontSize = Math.max(20, Math.round(viewportSize * 0.044));
  view.countLabel.position.set(panelWidth / 2, panelHeight / 2 + 6);
}

type EntityWithMineLayer = { id: string; components: MineLayerComponents };
type EntityWithEnemySub = { id: string; components: EnemySubComponents };
type EntityWithEnemyTorpedo = { id: string; components: EnemyTorpedoComponents };

function isMineLayerEntity(entity: RadarEntity): entity is EntityWithMineLayer {
  return entity.components.kind === "mine-layer";
}

function isEnemySubEntity(entity: RadarEntity): entity is EntityWithEnemySub {
  return entity.components.kind === "enemy-sub";
}

function isEnemyTorpedoEntity(entity: RadarEntity): entity is EntityWithEnemyTorpedo {
  return entity.components.kind === "enemy-torpedo";
}

// ─── Enemy Spawner ────────────────────────────────────────────────────────────

function createEnemySpawnerSystem(
  _mineSpriteFactory: () => Sprite | Graphics,
  enemySubSpriteFactory: () => Sprite,
): System<World> {
  let startMs: number | null = null;
  let nextSubSpawnAtElapsedMs = ENEMY_SPAWN_INITIAL_SUB_DELAY_MS;
  let enemySubSequence = 0;

  return {
    attach(world) {
      startMs = performance.now();
      nextSubSpawnAtElapsedMs = ENEMY_SPAWN_INITIAL_SUB_DELAY_MS;
      enemySubSequence = 0;

      for (let i = 0; i < ENEMY_SPAWN_MINE_LAYER_COUNT; i++) {
        const bearing = Math.random() * 360;
        const distance =
          ENEMY_SPAWN_MINE_LAYER_DISTANCE_MIN +
          Math.random() * (ENEMY_SPAWN_MINE_LAYER_DISTANCE_MAX - ENEMY_SPAWN_MINE_LAYER_DISTANCE_MIN);
        const bearingRad = degreesToRadians(bearing - 90);

        world.addEntity<MineLayerComponents>({
          id: `mine-layer-${i}`,
          components: {
            kind: "mine-layer",
            navigation: {
              position: {
                x: Math.cos(bearingRad) * distance,
                y: Math.sin(bearingRad) * distance,
              },
              headingDeg: Math.random() * 360,
              speedUnitsPerSecond: MINE_LAYER_SPEED_UNITS_PER_SECOND,
              courseTurn: 0,
            },
            mineLayer: {
              lastLayedAtMs: null,
              nextLayIntervalMs: 8000 + Math.random() * 12000,
              lastWanderTurnMs: null,
              wanderTurnIntervalMs: MINE_LAYER_WANDER_INTERVAL_MS,
            },
          },
        });
      }
    },
    update(world) {
      if (startMs === null) return;
      const player = requirePlayer(world);
      if (!isPlayerActive(player)) {
        return;
      }

      const elapsed = performance.now() - startMs;
      const activeSubs = world
        .getEntities<EnemySubComponents>()
        .filter(
          (entity) =>
            isEnemySubEntity(entity) && entity.components.status.state === "active",
        );
      const targetActiveSubs = Math.min(
        ENEMY_SPAWN_ACTIVE_SUB_TARGET_MAX,
        1 + Math.floor(Math.max(0, elapsed - ENEMY_SPAWN_INITIAL_SUB_DELAY_MS) / ENEMY_SPAWN_INTENSITY_STEP_MS),
      );

      if (activeSubs.length >= targetActiveSubs || elapsed < nextSubSpawnAtElapsedMs) {
        return;
      }

      spawnEnemySub(world, `enemy-sub-${enemySubSequence}`, enemySubSpriteFactory);
      enemySubSequence += 1;
      nextSubSpawnAtElapsedMs = elapsed + ENEMY_SPAWN_RESPAWN_INTERVAL_MS;
    },
  };
}

function spawnEnemySub(world: World, id: string, spriteFactory: () => Sprite) {
  const player = requirePlayer(world);
  const bearing = Math.random() * 360;
  const distance =
    ENEMY_SPAWN_SUB_DISTANCE_MIN +
    Math.random() * (ENEMY_SPAWN_SUB_DISTANCE_MAX - ENEMY_SPAWN_SUB_DISTANCE_MIN);
  const bearingRad = degreesToRadians(bearing - 90);
  const playerPos = player.components.navigation.position;

  world.addEntity<EnemySubComponents>({
    id,
    components: {
      kind: "enemy-sub",
      sprite: spriteFactory(),
      navigation: {
        position: {
          x: playerPos.x + Math.cos(bearingRad) * distance,
          y: playerPos.y + Math.sin(bearingRad) * distance,
        },
        headingDeg: normalizeDegrees(bearing + 180),
        speedUnitsPerSecond: ENEMY_SUB_SPEED_UNITS_PER_SECOND * 0.5,
        courseTurn: 0,
      },
      detection: {
        state: "hidden",
        revealedAtMs: null,
        trackedUntilMs: null,
      },
      status: {
        state: "active",
        destroyedAtMs: null,
      },
      ai: {
        engagementRangeUnits: ENEMY_SUB_ENGAGEMENT_RANGE_UNITS,
        lastFiredAtMs: null,
        fireIntervalMs: ENEMY_SUB_FIRE_INTERVAL_BASE_MS + Math.random() * 5000,
      },
    },
  });
}

// ─── Mine Layer AI ────────────────────────────────────────────────────────────

function createMineLayerAISystem(
  mineSpriteFactory: () => Sprite | Graphics,
): System<World> {
  return {
    update(world, deltaMs) {
      const mineLayerEntities = world.getEntities<MineLayerComponents>().filter(isMineLayerEntity);
      const deltaSeconds = deltaMs / 1000;
      const frameMs = performance.now();

      for (const entity of mineLayerEntities) {
        const nav = entity.components.navigation;
        const ml = entity.components.mineLayer;

        if (
          ml.lastWanderTurnMs === null ||
          frameMs - ml.lastWanderTurnMs >= ml.wanderTurnIntervalMs
        ) {
          nav.courseTurn = (Math.random() * 2 - 1) * 0.45;
          ml.lastWanderTurnMs = frameMs;
          ml.wanderTurnIntervalMs =
            MINE_LAYER_WANDER_INTERVAL_MS + Math.random() * MINE_LAYER_WANDER_INTERVAL_MS;
        }

        if (nav.courseTurn !== 0 && nav.speedUnitsPerSecond > 0) {
          const turnRadius = MINE_LAYER_MIN_TURN_RADIUS_UNITS / Math.abs(nav.courseTurn);
          const turnRateDegPerSecond = (nav.speedUnitsPerSecond / turnRadius) * (180 / Math.PI);
          nav.headingDeg = normalizeDegrees(
            nav.headingDeg + Math.sign(nav.courseTurn) * turnRateDegPerSecond * deltaSeconds,
          );
        }

        const headingRad = ((nav.headingDeg - 90) * Math.PI) / 180;
        nav.position.x += Math.cos(headingRad) * nav.speedUnitsPerSecond * deltaSeconds;
        nav.position.y += Math.sin(headingRad) * nav.speedUnitsPerSecond * deltaSeconds;

        if (ml.lastLayedAtMs === null || frameMs - ml.lastLayedAtMs >= ml.nextLayIntervalMs) {
          const count =
            MINE_LAYER_MINES_PER_GROUP_MIN +
            Math.floor(
              Math.random() * (MINE_LAYER_MINES_PER_GROUP_MAX - MINE_LAYER_MINES_PER_GROUP_MIN + 1),
            );

          for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const dist = Math.random() * MINE_LAYER_SPREAD_RADIUS_UNITS;
            const mineId = `mine-laid-${frameMs}-${i}-${Math.random().toString(36).slice(2, 6)}`;

            world.addEntity<MineComponents>({
              id: mineId,
              components: {
                kind: "mine",
                sprite: mineSpriteFactory(),
                collision: {
                  layer: "hazard",
                  radiusUnits: MINE_COLLISION_RADIUS_UNITS,
                  collidesWith: ["player"],
                  isColliding: false,
                  collidedAtMs: null,
                },
                position: {
                  x: nav.position.x + Math.cos(angle) * dist,
                  y: nav.position.y + Math.sin(angle) * dist,
                },
                detection: {
                  state: "hidden",
                  revealedAtMs: null,
                },
                status: {
                  state: "active",
                  detonatedAtMs: null,
                },
              },
            });
          }

          ml.lastLayedAtMs = frameMs;
          ml.nextLayIntervalMs =
            MINE_LAYER_LAY_INTERVAL_MS + Math.random() * MINE_LAYER_LAY_INTERVAL_VARIANCE_MS;
        }
      }
    },
  };
}

// ─── Enemy Sub AI ─────────────────────────────────────────────────────────────

function createEnemySubAISystem(): System<World> {
  return {
    update(world, deltaMs) {
      const player = requirePlayer(world);

      if (!isPlayerActive(player)) {
        return;
      }

      const subs = world.getEntities<EnemySubComponents>().filter(isEnemySubEntity);
      const deltaSeconds = deltaMs / 1000;
      const frameMs = performance.now();
      const playerPos = player.components.navigation.position;

      for (const sub of subs) {
        if (sub.components.status.state !== "active") {
          continue;
        }

        const nav = sub.components.navigation;
        const ai = sub.components.ai;
        const distance = worldDistance(nav.position, playerPos);
        const bearingToPlayer = worldBearingDeg(nav.position, playerPos);

        let targetBearing: number;
        let targetSpeed: number;

        if (distance > ai.engagementRangeUnits * 1.35) {
          targetBearing = bearingToPlayer;
          targetSpeed = ENEMY_SUB_SPEED_UNITS_PER_SECOND;
        } else if (distance < ai.engagementRangeUnits * 0.65) {
          targetBearing = normalizeDegrees(bearingToPlayer + 180);
          targetSpeed = ENEMY_SUB_SPEED_UNITS_PER_SECOND;
        } else {
          targetBearing = normalizeDegrees(bearingToPlayer + 90);
          targetSpeed = ENEMY_SUB_SPEED_UNITS_PER_SECOND * 0.72;
        }

        let headingError = normalizeDegrees(targetBearing - nav.headingDeg);
        if (headingError > 180) headingError -= 360;
        nav.courseTurn = clamp(headingError / 50, -1, 1);

        const speedDelta = targetSpeed - nav.speedUnitsPerSecond;
        if (Math.abs(speedDelta) > 0.1) {
          const maxStep = ENEMY_SUB_ACCELERATION_UNITS_PER_SECOND_SQUARED * deltaSeconds;
          nav.speedUnitsPerSecond +=
            Math.sign(speedDelta) * Math.min(maxStep, Math.abs(speedDelta));
        }

        if (nav.courseTurn !== 0 && nav.speedUnitsPerSecond > 0) {
          const turnRadius = ENEMY_SUB_MIN_TURN_RADIUS_UNITS / Math.abs(nav.courseTurn);
          const turnRateDegPerSecond = (nav.speedUnitsPerSecond / turnRadius) * (180 / Math.PI);
          nav.headingDeg = normalizeDegrees(
            nav.headingDeg + Math.sign(nav.courseTurn) * turnRateDegPerSecond * deltaSeconds,
          );
        }

        const headingRad = ((nav.headingDeg - 90) * Math.PI) / 180;
        nav.position.x += Math.cos(headingRad) * nav.speedUnitsPerSecond * deltaSeconds;
        nav.position.y += Math.sin(headingRad) * nav.speedUnitsPerSecond * deltaSeconds;

        const canFire =
          distance >= ENEMY_SUB_MIN_FIRE_RANGE_UNITS &&
          distance <= ENEMY_SUB_MAX_FIRE_RANGE_UNITS &&
          (ai.lastFiredAtMs === null || frameMs - ai.lastFiredAtMs >= ai.fireIntervalMs);

        if (canFire) {
          fireEnemyTorpedo(world, nav.position, playerPos, frameMs);
          ai.lastFiredAtMs = frameMs;
        }
      }
    },
  };
}

// ─── Enemy Sub Render ─────────────────────────────────────────────────────────

function createEnemySubRenderSystem(view: RadarView): System<World> {
  return {
    update(world) {
      const center = world.viewportSize / 2;
      const radius = getRadarRadius(world.viewportSize);
      const player = requirePlayer(world);
      const subs = world.getEntities<EnemySubComponents>().filter(isEnemySubEntity);
      const frameMs = performance.now();

      view.contactsLayer.clear();

      for (const sub of subs) {
        if (sub.components.sprite && !sub.components.sprite.parent) {
          world.root.addChild(sub.components.sprite);
        }

        const point = projectEntityToRadarIfVisible(
          center,
          radius,
          player.components.navigation.position,
          sub.components.navigation.position,
        );

        if (sub.components.status.state === "destroyed") {
          if (sub.components.sprite) {
            sub.components.sprite.visible = false;
          }

          const { destroyedAtMs } = sub.components.status;

          if (destroyedAtMs !== null && point) {
            drawMineDetonationEffect(view.contactsLayer, point.x, point.y, frameMs, destroyedAtMs);
          }

          if (destroyedAtMs !== null && frameMs - destroyedAtMs >= MINE_DETONATION_DURATION_MS) {
            sub.components.sprite?.destroy();
            world.removeEntity(sub.id);
          }

          continue;
        }

        if (sub.components.detection.state === "hidden" || !point) {
          if (sub.components.sprite) {
            sub.components.sprite.visible = false;
          }
          continue;
        }

        if (sub.components.detection.state === "ping" && sub.components.detection.revealedAtMs !== null) {
          const progress = clamp(
            (frameMs - sub.components.detection.revealedAtMs) / DETECTION_PING_DURATION_MS,
            0,
            1,
          );
          const pulseRadius = 10 + progress * 18;
          const pulseAlpha = 0.7 * (1 - progress);

          view.contactsLayer
            .circle(point.x, point.y, pulseRadius)
            .stroke({ width: 2, color: 0xff7040, alpha: pulseAlpha });
        }

        if (sub.components.sprite) {
          sub.components.sprite.visible = true;
          sub.components.sprite.position.set(point.x, point.y);
          sub.components.sprite.rotation = (sub.components.navigation.headingDeg * Math.PI) / 180;

          const textureWidth = sub.components.sprite.texture.width || 1;
          const textureHeight = sub.components.sprite.texture.height || 1;
          sub.components.sprite.scale.set(
            PLAYER_TARGET_SIZE_PX / textureWidth,
            PLAYER_TARGET_SIZE_PX / textureHeight,
          );
        }
      }
    },
    destroy(world) {
      const subs = world.getEntities<EnemySubComponents>().filter(isEnemySubEntity);
      for (const sub of subs) {
        sub.components.sprite?.destroy();
      }
    },
  };
}

function updateEnemySubDetection(
  playerPosition: EnemySubComponents["navigation"]["position"],
  sub: EnemySubComponents,
  previousSweepAngleDeg: number,
  sweepAngleDeg: number,
  frameMs: number,
) {
  const bearing = worldBearingDeg(playerPosition, sub.navigation.position);
  const sweptAcross = didSweepLineCrossAngle(previousSweepAngleDeg, sweepAngleDeg, bearing);

  if (sweptAcross) {
    sub.detection.state = "ping";
    sub.detection.revealedAtMs = frameMs;
    sub.detection.trackedUntilMs = null;
    return;
  }

  if (
    sub.detection.state === "ping" &&
    sub.detection.revealedAtMs !== null &&
    frameMs - sub.detection.revealedAtMs >= DETECTION_PING_DURATION_MS
  ) {
    sub.detection.state = "tracked";
    sub.detection.trackedUntilMs = frameMs + ENEMY_SUB_TRACK_DURATION_MS;
    return;
  }

  if (
    sub.detection.state === "tracked" &&
    sub.detection.trackedUntilMs !== null &&
    frameMs > sub.detection.trackedUntilMs
  ) {
    sub.detection.state = "hidden";
    sub.detection.trackedUntilMs = null;
  }
}

// ─── Enemy Torpedoes ──────────────────────────────────────────────────────────

function createEnemyTorpedoSystem(_view: RadarView): System<World> {
  return {
    update(world) {
      const center = world.viewportSize / 2;
      const radius = getRadarRadius(world.viewportSize);
      const player = requirePlayer(world);
      const torpedoes = world.getEntities<EnemyTorpedoComponents>().filter(isEnemyTorpedoEntity);
      const frameMs = performance.now();

      for (const torpedo of torpedoes) {
        const { trail } = torpedo.components;
        trail.graphic ??= createTorpedoGraphic();

        if (!trail.graphic.parent) {
          world.root.addChild(trail.graphic);
        }

        const progress = clamp((frameMs - trail.firedAtMs) / trail.durationMs, 0, 1);

        if (progress >= 1) {
          trail.graphic.destroy();
          world.removeEntity(torpedo.id);
          continue;
        }

        drawTorpedoTrail(
          trail.graphic,
          center,
          radius,
          player.components.navigation.position,
          trail.start,
          trail.target,
          progress,
          trail.lengthUnits,
          0xff7040,
        );

        if (isPlayerActive(player)) {
          const torpedoPos = interpolateWorldPoint(trail.start, trail.target, progress);
          const dist = worldDistance(torpedoPos, player.components.navigation.position);

          if (dist < ENEMY_TORPEDO_COLLISION_RADIUS_UNITS + PLAYER_COLLISION_RADIUS_UNITS) {
            trail.graphic.destroy();
            world.removeEntity(torpedo.id);
            player.components.navigation.speedUnitsPerSecond = 0;
            player.components.navigation.throttleLevel = 0;
            player.components.navigation.courseTurn = 0;
            player.components.status.state = "detonating";
            player.components.status.detonatedAtMs = frameMs;
            player.components.status.detonationCause = "enemy-sub";
          }
        }
      }
    },
    destroy(world) {
      const torpedoes = world.getEntities<EnemyTorpedoComponents>().filter(isEnemyTorpedoEntity);

      for (const torpedo of torpedoes) {
        torpedo.components.trail.graphic?.destroy();
      }
    },
  };
}

function fireEnemyTorpedo(
  world: World,
  from: { x: number; y: number },
  target: { x: number; y: number },
  frameMs: number,
) {
  const aimOffset = {
    x: target.x - from.x,
    y: target.y - from.y,
  };
  const distance = Math.hypot(aimOffset.x, aimOffset.y);

  if (distance <= 0) {
    return;
  }

  const travelDistance = (ENEMY_TORPEDO_SPEED_UNITS_PER_SECOND * TORPEDO_FUSE_DURATION_MS) / 1000;
  const extendedTarget = {
    x: from.x + (aimOffset.x / distance) * travelDistance,
    y: from.y + (aimOffset.y / distance) * travelDistance,
  };

  world.addEntity<EnemyTorpedoComponents>({
    id: `enemy-torpedo-${frameMs}-${Math.random().toString(36).slice(2, 8)}`,
    components: {
      kind: "enemy-torpedo",
      trail: {
        start: { ...from },
        target: extendedTarget,
        firedAtMs: frameMs,
        durationMs: TORPEDO_FUSE_DURATION_MS,
        lengthUnits: ENEMY_TORPEDO_TRAIL_LENGTH_UNITS,
      },
    },
  });
}
