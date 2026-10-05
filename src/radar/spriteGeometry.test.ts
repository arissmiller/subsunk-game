import { describe, expect, it } from "vitest";
import { circleHitsSprite, spritesOverlap, SPRITE_BOUNDS, SPRITE_WORLD_UNITS_PER_PIXEL, spriteBoundingRadius } from "./spriteGeometry";

const origin = { x: 0, y: 0 };
describe("sprite-sized hitboxes", () => {
  it("preserves native proportions with the same world size per source pixel", () => {
    expect(SPRITE_BOUNDS.boat.height * SPRITE_WORLD_UNITS_PER_PIXEL).toBe(160);
    expect(SPRITE_BOUNDS.player.height * SPRITE_WORLD_UNITS_PER_PIXEL).toBe(80);
    expect(SPRITE_BOUNDS.mine.width * SPRITE_WORLD_UNITS_PER_PIXEL).toBe(40);
  });

  it("excludes transparent padding on the narrow ship and includes its bow", () => {
    expect(circleHitsSprite("boat", origin, 0, { x: 15, y: 0 }, 0)).toBe(true);
    expect(circleHitsSprite("boat", origin, 0, { x: 16, y: 0 }, 0)).toBe(false);
    expect(circleHitsSprite("boat", origin, 0, { x: 0, y: -80 }, 0)).toBe(true);
    expect(circleHitsSprite("boat", origin, 0, { x: 0, y: -81 }, 0)).toBe(false);
  });

  it("rotates the hitbox with the vessel heading", () => {
    expect(circleHitsSprite("boat", origin, 90, { x: 79, y: 0 }, 0)).toBe(true);
    expect(circleHitsSprite("boat", origin, 90, { x: 0, y: 16 }, 0)).toBe(false);
    expect(circleHitsSprite("enemy-sub", origin, 90, { x: 39, y: 0 }, 0)).toBe(true);
    expect(circleHitsSprite("enemy-sub", origin, 0, { x: 39, y: 0 }, 0)).toBe(false);
  });

  it("accounts for projectile and blast radius without square corner inflation", () => {
    expect(circleHitsSprite("boat", origin, 0, { x: 23, y: 0 }, 8)).toBe(true);
    expect(circleHitsSprite("boat", origin, 0, { x: 24, y: 0 }, 8)).toBe(false);
    expect(circleHitsSprite("boat", origin, 0, { x: 23, y: 88 }, 8)).toBe(false);
    expect(spriteBoundingRadius("boat")).toBeLessThan(Math.hypot(15, 80));
    expect(spriteBoundingRadius("boat")).toBeGreaterThanOrEqual(80);
  });
});


describe("opaque pixel collision masks", () => {
  it("ignores transparent pixels inside the vessel bounding rectangle", () => {
    expect(circleHitsSprite("boat", origin, 0, { x: 10, y: -78 }, 0)).toBe(false);
    expect(circleHitsSprite("boat", origin, 0, { x: 1, y: -78 }, 0)).toBe(true);
    expect(circleHitsSprite("player", origin, 0, { x: 10, y: -39 }, 0)).toBe(false);
    expect(circleHitsSprite("player", origin, 0, { x: 1, y: -39 }, 0)).toBe(true);
    expect(circleHitsSprite("boat", origin, 90, { x: 78, y: 10 }, 0)).toBe(false);
    expect(circleHitsSprite("boat", origin, 90, { x: 78, y: 1 }, 0)).toBe(true);
  });

  it("preserves the mine's transparent gaps between its spikes", () => {
    expect(circleHitsSprite("mine", origin, 0, { x: 0, y: -19 }, 0)).toBe(false);
    expect(circleHitsSprite("mine", origin, 0, { x: -19, y: -19 }, 0)).toBe(true);
  });

  it("checks actual pixel boundaries against a projectile radius", () => {
    expect(circleHitsSprite("boat", origin, 0, { x: 5, y: -79 }, 2.49)).toBe(false);
    expect(circleHitsSprite("boat", origin, 0, { x: 5, y: -79 }, 2.5)).toBe(true);
  });

  it("checks both silhouettes for mine contact at any vessel heading", () => {
    expect(spritesOverlap("player", origin, 0, "mine", { x: 0, y: 0 }, 0)).toBe(true);
    expect(spritesOverlap("player", origin, 90, "mine", { x: 0, y: 0 }, 0)).toBe(true);
    expect(spritesOverlap("player", origin, 0, "mine", { x: 100, y: 100 }, 0)).toBe(false);
    // Their enclosing rectangles overlap here, but the bow and mine corner do not.
    expect(spritesOverlap("player", origin, 0, "mine", { x: 34, y: -57 }, 0)).toBe(false);
  });
});
