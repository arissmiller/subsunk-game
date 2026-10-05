import { SPRITE_WORLD_UNITS_PER_PIXEL } from "./spriteGeometry";
import { visibleGridEdges } from "./grid";
import { Assets, Container, Graphics, Sprite, Text, TextStyle, Texture } from "pixi.js";
import {
  clampWorldToRadarRadius,
  projectWorldToRadar,
  RADAR_WORLD_RADIUS_UNITS,
  worldDistance,
  type WorldPoint,
} from "../engine/navigation";
import type { System } from "../engine/types";
import type { World } from "../engine/world";
import type { RadarEntity, SonarState, VesselNavigation } from "../radarTypes";
import {
  DEPTH_CHARGE_BLAST_RADIUS,
  DEPTH_CHARGE_SINK_MS,
  GRID_COLOR,
  SONAR_PULSE_BAND_UNITS,
  CONTACT_DETONATION_MS,
  CONTACT_VISIBLE_RADIUS,
  COURSE_PREVIEW_DISTANCE,
  COURSE_PREVIEW_MIN_SPEED,
  COURSE_PREVIEW_STEP_SECONDS,
  DEGREE_LABELS,
  DETECTION_PING_MS,
  PLAYER_DETONATION_MS,
  TORPEDO_WIDTH_PX,
  TORPEDO_COLLISION_RADIUS,
  TORPEDO_MIN_TURN_RADIUS,
  VESSEL_MIN_TURN_RADIUS,
} from "./config";
import { advanceFixedCourse, clamp, isPlayerActive, pulseRadiusAt, requirePlayer } from "./entities/shared";

interface RadarView {
  root: Container;
  content: Container;
  background: Graphics;
  grid: Graphics;
  sonar: Graphics;
  paths: Graphics;
  sprites: Container;
  effects: Graphics;
  ticks: Graphics;
  frame: Graphics;
  labels: Text[];
  mask: Graphics;
}

export interface RadarDrawing {
  root: Container;
  system: System<World>;
}

type EntitySprite = Sprite;

export async function createRadarDrawing(sonar: SonarState): Promise<RadarDrawing> {
  const [playerTexture, enemyTexture, mineTexture, boatTexture] = await Promise.all([
    loadTexture("/sprites/player.png"),
    loadTexture("/sprites/enemy.png"),
    loadTexture("/sprites/mine.png"),
    loadTexture("/sprites/enemy_ship.png"),
  ]);
  const view = createView();
  const textures = { player: playerTexture, enemy: enemyTexture, mine: mineTexture, boat: boatTexture };
  const registry = new Map<string, EntitySprite>();
  view.content.addChild(view.background, view.grid, view.sonar, view.paths, view.sprites, view.effects);
  view.root.addChild(view.content, view.ticks, view.frame, view.mask, ...view.labels);
  return { root: view.root, system: createRadarDrawingSystem(view, sonar, textures, registry) };
}

async function loadTexture(path: string) {
  try {
    return await Assets.load({ src: path, data: { scaleMode: "nearest" } });
  } catch {
    return Texture.WHITE;
  }
}

function createView(): RadarView {
  const labels = DEGREE_LABELS.map(({ label }) => {
    const text = new Text({
      text: label,
      style: new TextStyle({ fill: 0xefe0ba, fontFamily: "Georgia", fontSize: 12, letterSpacing: 3 }),
    });
    text.anchor.set(0.5);
    return text;
  });
  return {
    root: new Container(),
    content: new Container(),
    background: new Graphics(),
    grid: new Graphics(),
    sonar: new Graphics(),
    paths: new Graphics(),
    sprites: new Container(),
    effects: new Graphics(),
    ticks: new Graphics(),
    frame: new Graphics(),
    labels,
    mask: new Graphics(),
  };
}

function createRadarDrawingSystem(
  view: RadarView,
  sonar: SonarState,
  textures: { player: Texture; enemy: Texture; mine: Texture; boat: Texture },
  registry: Map<string, EntitySprite>,
): System<World> {
  return {
    attach() {
      view.content.mask = view.mask;
    },
    resize(_world, viewportSize) {
      drawStatic(view, viewportSize);
    },
    update(world) {
      renderWorld(world, view, sonar, textures, registry);
    },
    destroy() {
      for (const sprite of registry.values()) sprite.destroy();
      registry.clear();
      view.root.destroy({ children: true });
    },
  };
}

function renderWorld(
  world: World,
  view: RadarView,
  sonar: SonarState,
  textures: { player: Texture; enemy: Texture; mine: Texture; boat: Texture },
  registry: Map<string, EntitySprite>,
) {
  const entities = world.getEntities() as RadarEntity[];
  const player = requirePlayer(world);
  const origin = player.components.navigation.position;
  const center = world.viewportSize / 2;
  const radius = getRadarRadius(world.viewportSize);
  const frameMs = performance.now();
  const existingSpriteIds = new Set<string>();
  for (const sprite of registry.values()) sprite.visible = false;
  view.sonar.clear();
  view.paths.clear();
  view.effects.clear();

  view.grid.clear();
  for (const edge of visibleGridEdges(origin, RADAR_WORLD_RADIUS_UNITS, sonar.coverage, frameMs)) {
    const from = projectWorldToRadar(center, radius, origin, edge.from);
    const to = projectWorldToRadar(center, radius, origin, edge.to);
    view.grid.moveTo(from.x, from.y).lineTo(to.x, to.y).stroke({ width: 1, color: GRID_COLOR, alpha: edge.alpha });
  }

  drawSonar(view.sonar, sonar, origin, center, radius, frameMs);
  if (isPlayerActive(player)) drawCourse(view.paths, player.components.navigation, center, radius);

  for (const entity of entities) {
    const components = entity.components;
    if (components.kind === "torpedo") {
      drawTrail(view.paths, components.trail.points, components.owner, origin, center, radius);
      continue;
    }
    if (components.kind === "depth-charge") {
      const point = visiblePoint(origin, components.position, center, radius);
      if (point) {
        const blastRadius = DEPTH_CHARGE_BLAST_RADIUS * radius / RADAR_WORLD_RADIUS_UNITS;
        if (components.detonatedAtMs !== null) {
          drawDetonation(view.effects, point.x, point.y, frameMs, components.detonatedAtMs, CONTACT_DETONATION_MS, blastRadius);
        } else {
          const progress = clamp((frameMs - components.launchedAtMs) / DEPTH_CHARGE_SINK_MS, 0, 1);
          view.effects.circle(point.x, point.y, blastRadius).stroke({ width: 1, color: 0xffb85c, alpha: 0.55 });
          view.effects.circle(point.x, point.y, Math.max(1, blastRadius * (1 - progress))).stroke({ width: 1.5, color: 0xffb85c, alpha: 0.9 });
          view.effects.circle(point.x, point.y, 2).fill({ color: 0xffb85c, alpha: 0.9 });
          if (frameMs - components.launchedAtMs < 400) {
            const splash = (frameMs - components.launchedAtMs) / 400;
            view.effects.circle(point.x, point.y, 3 + splash * 12).stroke({ width: 2, color: 0xf6fffa, alpha: 1 - splash });
          }
        }
      }
      continue;
    }
    if (components.kind === "mine-layer") continue;

    if (components.kind === "player") {
      existingSpriteIds.add(entity.id);
      if (components.status.state !== "destroyed") {
        const sprite = obtainSprite(registry, entity.id, textures.player, view.sprites);
        layoutSprite(sprite, center, center, components.navigation.headingDeg, radius);
      }
      if (components.status.state === "detonating" && components.status.detonatedAtMs !== null) {
        drawDetonation(view.effects, center, center, frameMs, components.status.detonatedAtMs, PLAYER_DETONATION_MS, radius * 0.5);
      }
      continue;
    }

    if (components.kind === "mine") {
      existingSpriteIds.add(entity.id);
      const point = visiblePoint(origin, components.position, center, radius);
      if (components.status.state === "active" && components.detection.state !== "hidden" && point) {
        const sprite = obtainSprite(registry, entity.id, textures.mine, view.sprites);
        layoutSprite(sprite, point.x, point.y, 0, radius);
        if (components.detection.state === "ping") {
          drawPing(view.effects, point, frameMs, components.detection.revealedAtMs);
        }
      }
      if (components.status.state === "detonating" && components.status.detonatedAtMs !== null && point) {
        drawDetonation(view.effects, point.x, point.y, frameMs, components.status.detonatedAtMs, CONTACT_DETONATION_MS, 32);
      }
      continue;
    }

    existingSpriteIds.add(entity.id);
    const reported = components.detection.lastKnownPosition;
    const point = reported ? visiblePoint(origin, reported, center, radius) : null;
    if (components.detection.state !== "hidden" && point && components.status.state === "active") {
      const sprite = obtainSprite(registry, entity.id, components.kind === "boat" ? textures.boat : textures.enemy, view.sprites);
      layoutSprite(sprite, point.x, point.y, components.detection.lastKnownHeadingDeg ?? 0, radius);
      if (components.detection.lastKnownCourse) {
        drawEnemyCourse(view.paths, components.detection.lastKnownCourse, origin, center, radius);
      }
      if (components.detection.state === "ping") {
        drawPing(view.effects, point, frameMs, components.detection.revealedAtMs);
      }
    }
    if (components.status.state === "destroyed" && components.status.destroyedAtMs !== null) {
      const actual = visiblePoint(origin, components.navigation.position, center, radius);
      if (actual) drawDetonation(view.effects, actual.x, actual.y, frameMs, components.status.destroyedAtMs, CONTACT_DETONATION_MS, 32);
    }
  }

  for (const [id, sprite] of registry) {
    if (existingSpriteIds.has(id)) continue;
    registry.delete(id);
    sprite.destroy();
  }
}

function obtainSprite(registry: Map<string, Sprite>, id: string, texture: Texture, layer: Container) {
  let sprite = registry.get(id);
  if (!sprite) {
    sprite = new Sprite({ texture, anchor: 0.5, roundPixels: true });
    registry.set(id, sprite);
    layer.addChild(sprite);
  }
  return sprite;
}

function layoutSprite(sprite: Sprite, x: number, y: number, headingDeg: number, radarRadius: number) {
  sprite.position.set(x, y);
  sprite.rotation = (headingDeg * Math.PI) / 180;
  const scale = SPRITE_WORLD_UNITS_PER_PIXEL * radarRadius / RADAR_WORLD_RADIUS_UNITS;
  sprite.scale.set(scale);
  sprite.visible = true;
}

function drawStatic(view: RadarView, viewportSize: number) {
  const center = viewportSize / 2;
  const radius = getRadarRadius(viewportSize);
  view.mask.clear().circle(center, center, radius).fill(0xffffff);
  view.background.clear().circle(center, center, radius).fill({ color: 0x071b23, alpha: 0.98 });
  for (const fraction of [0.25, 0.5, 0.75, 1]) {
    view.background.circle(center, center, radius * fraction).stroke({ width: fraction === 1 ? 2 : 1, color: 0x4d897f, alpha: fraction === 1 ? 0.6 : 0.28 });
  }
  view.ticks.clear();
  for (let angle = 0; angle < 360; angle += 5) {
    const major = angle % 45 === 0;
    const from = pointOnRadar(center, radius + (major ? 3 : 6), angle);
    const to = pointOnRadar(center, radius + (major ? 15 : 11), angle);
    view.ticks.moveTo(from.x, from.y).lineTo(to.x, to.y).stroke({ width: major ? 2 : 1, color: 0xefe0ba, alpha: major ? 0.9 : 0.5 });
  }
  view.frame.clear().circle(center, center, radius + 2).stroke({ width: 3, color: 0xefe0ba, alpha: 0.8 });
  view.labels.forEach((label, index) => {
    const point = pointOnRadar(center, radius + 27, DEGREE_LABELS[index].angleDeg);
    label.position.set(point.x, point.y);
  });
}

function drawSonar(graphic: Graphics, sonar: SonarState, origin: WorldPoint, center: number, radius: number, frameMs: number) {
  const scale = radius / RADAR_WORLD_RADIUS_UNITS;
  for (const pulse of sonar.pulses) {
    // Retained player pulses still deliver echoes after the visible ring expires.
    if (pulseRadiusAt(pulse, frameMs) > (pulse.rangeUnits ?? CONTACT_VISIBLE_RADIUS) + SONAR_PULSE_BAND_UNITS) continue;
    const pulseCenter = projectWorldToRadar(center, radius, origin, pulse.origin);
    const pulseRadius = pulseRadiusAt(pulse, frameMs) * scale;
    const color = pulse.owner === "player" ? 0x74f0d2 : 0xffa66e;
    graphic.circle(pulseCenter.x, pulseCenter.y, pulseRadius).stroke({ width: 6, color, alpha: 0.12 });
    graphic.circle(pulseCenter.x, pulseCenter.y, pulseRadius).stroke({ width: 1.5, color, alpha: 0.85 });
  }
}

function drawCourse(graphic: Graphics, navigation: VesselNavigation, center: number, radius: number) {
  const points = sampleCourse(navigation);
  for (let index = 0; index < points.length - 1; index += 2) {
    const a = projectWorldToRadar(center, radius, navigation.position, clampWorldToRadarRadius(navigation.position, points[index], RADAR_WORLD_RADIUS_UNITS * 0.9));
    const b = projectWorldToRadar(center, radius, navigation.position, clampWorldToRadarRadius(navigation.position, points[Math.min(index + 1, points.length - 1)], RADAR_WORLD_RADIUS_UNITS * 0.9));
    graphic.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 2, color: 0xefe0ba, alpha: 0.82 });
  }
}

function sampleCourse(source: VesselNavigation) {
  const navigation = { ...source, position: { ...source.position } };
  const speed = Math.max(source.speedUnitsPerSecond, COURSE_PREVIEW_MIN_SPEED);
  const points = [{ ...navigation.position }];
  let traveled = 0;
  while (traveled < COURSE_PREVIEW_DISTANCE) {
    const before = { ...navigation.position };
    advanceFixedCourse(navigation, speed * COURSE_PREVIEW_STEP_SECONDS, TORPEDO_MIN_TURN_RADIUS);
    traveled += worldDistance(before, navigation.position);
    points.push({ ...navigation.position });
  }
  return points;
}

function drawTrail(graphic: Graphics, points: WorldPoint[], owner: "player" | "enemy", origin: WorldPoint, center: number, radius: number) {
  const color = owner === "player" ? 0xf6fffa : 0xff9875;
  const projected = points.map((point) => projectWorldToRadar(center, radius, origin, clampWorldToRadarRadius(origin, point)));
  for (let index = 0; index < projected.length - 1; index += 1) {
    graphic.moveTo(projected[index].x, projected[index].y).lineTo(projected[index + 1].x, projected[index + 1].y).stroke({ width: TORPEDO_WIDTH_PX, color, alpha: 0.2 + 0.8 * ((index + 1) / projected.length) });
  }
  const head = projected[projected.length - 1];
  if (head) graphic.circle(head.x, head.y, TORPEDO_COLLISION_RADIUS * radius / RADAR_WORLD_RADIUS_UNITS).fill({ color, alpha: 0.95 });
}

function drawPing(graphic: Graphics, point: WorldPoint, frameMs: number, revealedAtMs: number | null) {
  const progress = clamp((frameMs - (revealedAtMs ?? frameMs)) / DETECTION_PING_MS, 0, 1);
  graphic.circle(point.x, point.y, 10 + progress * 18).stroke({ width: 2, color: 0xf6fffa, alpha: 0.7 * (1 - progress) });
}

function drawDetonation(graphic: Graphics, x: number, y: number, frameMs: number, startedAtMs: number, durationMs: number, maxRadius: number) {
  const progress = clamp((frameMs - startedAtMs) / durationMs, 0, 1);
  graphic.circle(x, y, 4 + maxRadius * progress * 0.3).fill({ color: 0xfff2c9, alpha: 0.8 * (1 - progress) });
  graphic.circle(x, y, 6 + maxRadius * progress).stroke({ width: 2.5, color: 0xff9875, alpha: 0.8 * (1 - progress) });
}

function visiblePoint(origin: WorldPoint, target: WorldPoint, center: number, radius: number) {
  return worldDistance(origin, target) <= CONTACT_VISIBLE_RADIUS
    ? projectWorldToRadar(center, radius, origin, target)
    : null;
}

function pointOnRadar(center: number, radius: number, angleDeg: number) {
  const radians = ((angleDeg - 90) * Math.PI) / 180;
  return { x: center + Math.cos(radians) * radius, y: center + Math.sin(radians) * radius };
}

function getRadarRadius(viewportSize: number) {
  return viewportSize / 2 - Math.max(26, Math.round(viewportSize * 0.08));
}


function drawEnemyCourse(graphic: Graphics, source: VesselNavigation, origin: WorldPoint, center: number, radius: number) {
  const navigation = { ...source, position: { ...source.position } };
  // Six seconds of the reported course, frozen until the next sonar return.
  for (let step = 0; step < 24; step++) {
    const a = projectWorldToRadar(center, radius, origin, navigation.position);
    advanceFixedCourse(navigation, source.speedUnitsPerSecond * 0.25, VESSEL_MIN_TURN_RADIUS);
    const b = projectWorldToRadar(center, radius, origin, navigation.position);
    if (step % 2 === 0) graphic.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 2, color: 0xff6666, alpha: 0.45 * (1 - step / 32) });
  }
}
