import { Container, Graphics, Text, TextStyle } from "pixi.js";
import type { System } from "../engine/types";
import type { World } from "../engine/world";
import type { RadarEntity, ThrottleLevel } from "../radarTypes";
import { COURSE_TURN_STEP, TORPEDO_BAY_CAPACITY, TORPEDO_RELOAD_MS } from "./config";
import { isEnemyVessel, requirePlayer } from "./entities/shared";
import type { RadarCommands } from "./world";

export interface RadarControls {
  root: Container;
  system: System<World>;
  readonly killCount: number;
  handleKeyDown(event: KeyboardEvent): boolean;
}

interface Button {
  box: Graphics;
  label: Text;
}

export function createRadarControls(commands: RadarCommands): RadarControls {
  const root = new Container();
  const panel = new Graphics();
  const throttleTitle = makeText("THROTTLE", 11, 2, 0xefe0ba);
  root.addChild(panel, throttleTitle);
  const throttleButtons = ([0, 1, 2] as ThrottleLevel[]).map((level) =>
    makeButton(root, ["STOP", "SLOW", "FAST"][level], () => {
      if (!currentWorld) return;
      commands.changeThrottle(level - requirePlayer(currentWorld).components.navigation.throttleLevel);
    }),
  );
  const port = makeButton(root, "PORT", () => commands.changeCourse(-COURSE_TURN_STEP));
  const starboard = makeButton(root, "STARBOARD", () => commands.changeCourse(COURSE_TURN_STEP));
  const reload = makeButton(root, "RELOAD [R]", commands.reloadPlayerTorpedoes);
  const fire = makeButton(root, "FIRE [SPACE]", commands.firePlayerTorpedo);
  const status = makeText("", 12, 1, 0xf6fffa);
  const tubes = makeText("", 12, 1, 0xf6fffa);
  root.addChild(status, tubes);
  let currentWorld: World | null = null;
  let killCount = 0;
  const countedKills = new Set<string>();

  const system: System<World> = {
    resize(_world, viewportSize) {
      layout(viewportSize);
    },
    update(world) {
      currentWorld = world;
      const player = requirePlayer(world);
      const navigation = player.components.navigation;
      const bay = player.components.torpedoBay;
      status.text = `HDG ${Math.round(navigation.headingDeg).toString().padStart(3, "0")}°  TURN ${navigation.courseTurn.toFixed(1)}`;
      const reloadRemaining = bay.reloadStartMs === null
        ? ""
        : `  RELOADING ${Math.max(0, (TORPEDO_RELOAD_MS - (performance.now() - bay.reloadStartMs)) / 1000).toFixed(1)}s`;
      tubes.text = `TUBES ${bay.count}/${TORPEDO_BAY_CAPACITY}${reloadRemaining}`;
      for (const entity of world.getEntities() as RadarEntity[]) {
        if (
          isEnemyVessel(entity) &&
          entity.components.status.state === "destroyed" &&
          !countedKills.has(entity.id)
        ) {
          countedKills.add(entity.id);
          killCount += 1;
        }
      }
      throttleButtons.forEach((button, level) => paintButton(button, navigation.throttleLevel === level));
      paintButton(reload, bay.reloadStartMs !== null);
    },
    destroy() {
      currentWorld = null;
      root.destroy({ children: true });
    },
  };

  function layout(viewportSize: number) {
    const width = Math.min(460, viewportSize - 24);
    const left = (viewportSize - width) / 2;
    const top = viewportSize - 88;
    panel.clear().roundRect(left, top, width, 76, 8).fill({ color: 0x06151b, alpha: 0.88 }).stroke({ width: 1, color: 0x79b5a7, alpha: 0.55 });
    throttleTitle.position.set(left + 12, top + 13);
    throttleButtons.forEach((button, index) => positionButton(button, left + 12 + index * 58, top + 27, 52, 23));
    positionButton(port, left + 192, top + 27, 52, 23);
    positionButton(starboard, left + 250, top + 27, 78, 23);
    positionButton(reload, left + 334, top + 27, 104, 23);
    positionButton(fire, left + 334, top + 2, 104, 21);
    status.position.set(left + 12, top + 58);
    tubes.position.set(left + 190, top + 58);
  }

  return {
    root,
    system,
    get killCount() { return killCount; },
    handleKeyDown(event) {
      const key = event.key.toLowerCase();
      if (key === "w" || key === "arrowup") commands.changeThrottle(1);
      else if (key === "s" || key === "arrowdown") commands.changeThrottle(-1);
      else if (key === "a" || key === "arrowleft") commands.changeCourse(-COURSE_TURN_STEP);
      else if (key === "d" || key === "arrowright") commands.changeCourse(COURSE_TURN_STEP);
      else if (key === "r") commands.reloadPlayerTorpedoes();
      else if (event.code === "Space") commands.firePlayerTorpedo();
      else return false;
      return true;
    },
  };
}

function makeText(text: string, fontSize: number, letterSpacing: number, fill: number) {
  return new Text({ text, style: new TextStyle({ fill, fontFamily: "Georgia", fontSize, letterSpacing }) });
}

function makeButton(parent: Container, text: string, onPress: () => void): Button {
  const box = new Graphics();
  box.eventMode = "static";
  box.cursor = "pointer";
  box.on("pointertap", onPress);
  const label = makeText(text, 10, 0, 0xd3dde3);
  label.anchor.set(0.5);
  parent.addChild(box, label);
  return { box, label };
}

function positionButton(button: Button, x: number, y: number, width: number, height: number) {
  button.box.position.set(x, y);
  button.box.clear().roundRect(0, 0, width, height, 4).fill({ color: 0x12313a, alpha: 0.95 }).stroke({ width: 1, color: 0x79b5a7, alpha: 0.7 });
  button.label.position.set(x + width / 2, y + height / 2);
}

function paintButton(button: Button, active: boolean) {
  button.box.alpha = active ? 1 : 0.7;
  button.label.alpha = active ? 1 : 0.78;
}
