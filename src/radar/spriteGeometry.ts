import type { WorldPoint } from "../engine/navigation";
import masks from "./spriteMasks.json";

export const SPRITE_WORLD_UNITS_PER_PIXEL = 2.5;
export type SpriteKind = keyof typeof masks;
interface PixelRect { x: number; y: number; halfWidth: number; halfHeight: number }

function rectangles(kind: SpriteKind): PixelRect[] {
  const mask = masks[kind];
  return mask.runs.map(([x, y, width]) => ({
    x: (x + width / 2 - mask.width / 2) * SPRITE_WORLD_UNITS_PER_PIXEL,
    y: (y + 0.5 - mask.height / 2) * SPRITE_WORLD_UNITS_PER_PIXEL,
    halfWidth: width * SPRITE_WORLD_UNITS_PER_PIXEL / 2,
    halfHeight: SPRITE_WORLD_UNITS_PER_PIXEL / 2,
  }));
}
const shapes = Object.fromEntries(Object.keys(masks).map((kind) => [kind, rectangles(kind as SpriteKind)])) as Record<SpriteKind, PixelRect[]>;
export const SPRITE_BOUNDS = Object.fromEntries(Object.entries(masks).map(([kind, mask]) => {
  const minX = Math.min(...mask.runs.map(([x]) => x));
  const maxX = Math.max(...mask.runs.map(([x, , width]) => x + width));
  const minY = Math.min(...mask.runs.map(([, y]) => y));
  const maxY = Math.max(...mask.runs.map(([, y]) => y + 1));
  return [kind, { width: maxX - minX, height: maxY - minY }];
})) as Record<SpriteKind, { width: number; height: number }>;

const boundingRadii = Object.fromEntries(Object.entries(shapes).map(([kind, rects]) => [
  kind, Math.max(...rects.map((r) => Math.hypot(Math.abs(r.x) + r.halfWidth, Math.abs(r.y) + r.halfHeight))),
])) as Record<SpriteKind, number>;
export function spriteBoundingRadius(kind: SpriteKind) {
  return boundingRadii[kind];
}

export function circleHitsSprite(kind: SpriteKind, position: WorldPoint, headingDeg: number, circle: WorldPoint, radius: number) {
  const angle = headingDeg * Math.PI / 180;
  const dx = circle.x - position.x, dy = circle.y - position.y;
  if (Math.hypot(dx, dy) > spriteBoundingRadius(kind) + radius) return false;
  const localX = dx * Math.cos(angle) + dy * Math.sin(angle);
  const localY = -dx * Math.sin(angle) + dy * Math.cos(angle);
  return shapes[kind].some((r) => {
    const gapX = Math.max(0, Math.abs(localX - r.x) - r.halfWidth);
    const gapY = Math.max(0, Math.abs(localY - r.y) - r.halfHeight);
    return gapX * gapX + gapY * gapY <= radius * radius;
  });
}

// Exact overlap of opaque pixel runs, including both sprites' rotations.
export function spritesOverlap(aKind: SpriteKind, aPosition: WorldPoint, aHeading: number, bKind: SpriteKind, bPosition: WorldPoint, bHeading: number) {
  if (Math.hypot(aPosition.x - bPosition.x, aPosition.y - bPosition.y) > spriteBoundingRadius(aKind) + spriteBoundingRadius(bKind)) return false;
  function transform(kind: SpriteKind, position: WorldPoint, heading: number) {
    const angle = heading * Math.PI / 180;
    const u = { x: Math.cos(angle), y: Math.sin(angle) };
    const v = { x: -u.y, y: u.x };
    return shapes[kind].map((r) => ({ ...r, u, v,
      x: position.x + r.x * u.x + r.y * v.x,
      y: position.y + r.x * u.y + r.y * v.y,
    }));
  }
  const aRects = transform(aKind, aPosition, aHeading);
  const bRects = transform(bKind, bPosition, bHeading);
  for (const a of aRects) for (const b of bRects) {
    const overlap = [a.u, a.v, b.u, b.v].every((axis) => {
      const extent = (r: typeof a) => r.halfWidth * Math.abs(r.u.x * axis.x + r.u.y * axis.y) + r.halfHeight * Math.abs(r.v.x * axis.x + r.v.y * axis.y);
      return Math.abs((a.x - b.x) * axis.x + (a.y - b.y) * axis.y) <= extent(a) + extent(b) + 1e-9;
    });
    if (overlap) return true;
  }
  return false;
}
