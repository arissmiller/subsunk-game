import type { Container } from "pixi.js";

export interface Entity<TComponents extends object = Record<string, unknown>> {
  id: string;
  components: TComponents;
}

export interface System<TWorld = WorldLike> {
  attach?(world: TWorld): void | Promise<void>;
  resize?(world: TWorld, viewportSize: number): void;
  update?(world: TWorld, deltaMs: number): void;
  destroy?(world: TWorld): void;
}

export interface WorldLike {
  readonly root: Container;
  readonly viewportSize: number;
}
