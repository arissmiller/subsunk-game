import { createScoreboard } from "./radar/scoreboard";
import { requirePlayer } from "./radar/entities/shared";
import type { Application } from "pixi.js";
import type { PlayerDetonationCause } from "./radarTypes";
import type { GameScene } from "./sceneTypes";
import { createRadarControls } from "./radar/controls";
import { createRadarDrawing } from "./radar/drawing";
import { createRadarWorld } from "./radar/world";

interface RadarSceneOptions {
  onGameOver: (cause: PlayerDetonationCause, survivedMs: number, killCount: number) => void;
}

export async function createRadarScene(
  app: Application,
  options: RadarSceneOptions,
): Promise<GameScene> {
  let startedAtMs = 0;
  const survivalTime = () => Math.max(0,
    (requirePlayer(runtime.world).components.status.detonatedAtMs ?? performance.now()) - startedAtMs,
  );
  const runtime = createRadarWorld({
    onGameOver: (cause) => options.onGameOver(cause, survivalTime(), controls.killCount),
  });
  const scoreboard = createScoreboard();
  const drawing = await createRadarDrawing(runtime.sonar);
  const controls = createRadarControls(runtime.commands);

  runtime.world.root.addChild(drawing.root);
  app.stage.addChild(runtime.world.root, controls.root, scoreboard.root);
  runtime.world.addSystem(drawing.system);
  runtime.world.addSystem(controls.system);
  await runtime.world.attach();
  startedAtMs = performance.now();

  return {
    resize(viewportSize) {
      runtime.world.resize(viewportSize);
      scoreboard.resize(viewportSize);
    },
    update(deltaMs) {
      runtime.world.update(deltaMs);
      scoreboard.update(survivalTime(), controls.killCount);
    },
    handleKeyDown(event) {
      return controls.handleKeyDown(event);
    },
    destroy() {
      runtime.world.destroy();
      scoreboard.root.destroy({ children: true });
    },
  };
}
