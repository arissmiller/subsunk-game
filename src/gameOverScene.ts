import { Container, Graphics, Text, TextStyle, type Application } from "pixi.js";
import type { GameScene } from "./sceneTypes";
import type { PlayerDetonationCause } from "./radarTypes";

interface GameOverSceneOptions {
  cause: PlayerDetonationCause;
  onRestart: () => void;
}

export async function createGameOverScene(
  app: Application,
  options: GameOverSceneOptions,
): Promise<GameScene> {
  const root = new Container();
  const veil = new Graphics();
  const panel = new Graphics();
  const title = new Text({
    text: "Vessel Lost",
    style: new TextStyle({
      fill: 0xf9e8ca,
      fontFamily: "Georgia",
      fontSize: 34,
      letterSpacing: 1.5,
    }),
  });
  const subtitle = new Text({
    text: getGameOverMessage(options.cause),
    style: new TextStyle({
      fill: 0xd7dfe3,
      fontFamily: "Georgia",
      fontSize: 16,
    }),
  });
  const prompt = new Text({
    text: "Press Enter, Space, or R to restart",
    style: new TextStyle({
      fill: 0xcdb57c,
      fontFamily: "Georgia",
      fontSize: 14,
      letterSpacing: 1.2,
    }),
  });

  title.anchor.set(0.5);
  subtitle.anchor.set(0.5);
  prompt.anchor.set(0.5);

  panel.eventMode = "static";
  panel.cursor = "pointer";
  panel.on("pointertap", () => {
    options.onRestart();
  });

  root.addChild(veil, panel, title, subtitle, prompt);
  app.stage.addChild(root);

  let elapsedMs = 0;

  const layout = (viewportSize: number) => {
    const center = viewportSize / 2;
    const panelWidth = Math.min(viewportSize - 36, 360);
    const panelHeight = Math.min(viewportSize * 0.42, 220);
    const promptPulse = 0.82 + Math.sin(elapsedMs / 280) * 0.14;

    veil
      .clear()
      .rect(0, 0, viewportSize, viewportSize)
      .fill({ color: 0x02070b, alpha: 0.72 });

    panel
      .clear()
      .roundRect(center - panelWidth / 2, center - panelHeight / 2, panelWidth, panelHeight, 22)
      .fill({ color: 0x0b1b23, alpha: 0.92 })
      .roundRect(center - panelWidth / 2, center - panelHeight / 2, panelWidth, panelHeight, 22)
      .stroke({ width: 2, color: 0xcdb57c, alpha: 0.34 });

    title.position.set(center, center - 42);
    subtitle.position.set(center, center + 2);
    prompt.position.set(center, center + 56);
    prompt.alpha = promptPulse;
  };

  return {
    resize(viewportSize) {
      layout(viewportSize);
    },
    update(deltaMs) {
      elapsedMs += deltaMs;
      layout(app.renderer.width);
    },
    destroy() {
      root.destroy({ children: true });
    },
    handleKeyDown(event) {
      const key = event.key.toLowerCase();

      if (key === "enter" || key === " " || key === "spacebar" || key === "r") {
        options.onRestart();
        return true;
      }

      return false;
    },
  };
}

function getGameOverMessage(cause: PlayerDetonationCause) {
  if (cause === "enemy-sub") {
    return "Enemy torpedo impact compromised the hull.";
  }

  return "Mine detonation compromised the hull.";
}
