import { Container } from "pixi.js";
import type { Entity, System } from "./types";

export class World {
  readonly root = new Container();

  #entities = new Map<string, Entity>();
  #systems: System<World>[] = [];
  #viewportSize = 0;

  get viewportSize() {
    return this.#viewportSize;
  }

  addEntity<TComponents extends object>(entity: Entity<TComponents>) {
    this.#entities.set(entity.id, entity as Entity);
    return entity;
  }

  removeEntity(entityId: string) {
    this.#entities.delete(entityId);
  }

  getEntity<TComponents extends object>(entityId: string) {
    return this.#entities.get(entityId) as Entity<TComponents> | undefined;
  }

  getEntities<TComponents extends object>() {
    return [...this.#entities.values()] as Entity<TComponents>[];
  }

  addSystem(system: System<World>) {
    this.#systems.push(system);
  }

  async attach() {
    for (const system of this.#systems) {
      await system.attach?.(this);
    }
  }

  resize(viewportSize: number) {
    this.#viewportSize = viewportSize;

    for (const system of this.#systems) {
      system.resize?.(this, viewportSize);
    }
  }

  update(deltaMs: number) {
    for (const system of this.#systems) {
      system.update?.(this, deltaMs);
    }
  }

  destroy() {
    for (let index = this.#systems.length - 1; index >= 0; index -= 1) {
      this.#systems[index].destroy?.(this);
    }

    this.#entities.clear();
    this.root.destroy({ children: true });
  }
}
