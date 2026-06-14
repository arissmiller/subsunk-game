import { Application } from "pixi.js";
import { createGameOverScene } from "./gameOverScene";
import { createRadarScene } from "./radarScene";
import type { PlayerDetonationCause } from "./radarTypes";
import type { GameScene } from "./sceneTypes";

export interface GameEngine {
  destroy(): void;
}

export async function createGameEngine(host: HTMLElement): Promise<GameEngine> {
  const app = new Application();
  const initialSize = measureSquare(host);

  await app.init({
    width: initialSize,
    height: initialSize,
    backgroundAlpha: 0,
    antialias: false,
    autoDensity: true,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    preference: "webgl",
  });

  host.append(app.canvas);

  let currentScene: GameScene | null = null;
  let activeSceneToken = 0;

  const transitionTo = async (nextScene: Promise<GameScene>) => {
    const token = ++activeSceneToken;
    const resolvedScene = await nextScene;

    if (token !== activeSceneToken) {
      resolvedScene.destroy();
      return;
    }

    currentScene?.destroy();
    currentScene = resolvedScene;
    currentScene.resize(app.renderer.width);
  };

  const startRadarScene = () =>
    createRadarScene(app, {
      onGameOver: (cause: PlayerDetonationCause) => {
        void transitionTo(
          createGameOverScene(app, {
            cause,
            onRestart: () => {
              void transitionTo(startRadarScene());
            },
          }),
        );
      },
    });

  await transitionTo(startRadarScene());

  const onKeyDown = (event: KeyboardEvent) => {
    if (isEditableTarget(event.target)) {
      return;
    }

    if (currentScene?.handleKeyDown?.(event)) {
      event.preventDefault();
    }
  };

  window.addEventListener("keydown", onKeyDown);

  let resizeFrame = 0;
  const resize = () => {
    const nextSize = measureSquare(host);

    app.renderer.resize(nextSize, nextSize);
    currentScene?.resize(nextSize);
  };

  const resizeObserver = new ResizeObserver(() => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(resize);
  });

  resizeObserver.observe(host);

  app.ticker.add((ticker) => {
    currentScene?.update(ticker.deltaMS);
  });

  return {
    destroy() {
      window.removeEventListener("keydown", onKeyDown);
      resizeObserver.disconnect();
      cancelAnimationFrame(resizeFrame);
      currentScene?.destroy();
      app.destroy(true, { children: true });
    },
  };
}

function measureSquare(host: HTMLElement) {
  return Math.max(1, Math.round(Math.min(host.clientWidth, host.clientHeight || host.clientWidth)));
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tagName = target.tagName;

  return (
    tagName === "INPUT" ||
    tagName === "TEXTAREA" ||
    tagName === "SELECT" ||
    target.isContentEditable
  );
}
