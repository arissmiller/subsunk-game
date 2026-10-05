import { Container, Graphics, Text, TextStyle } from "pixi.js";

export function createScoreboard() {
  const root = new Container();
  root.eventMode = "none";
  const panel = new Graphics();
  const label = new Text({ text: "TIME SURVIVED", style: new TextStyle({
    fontFamily: "Georgia", fontSize: 10, letterSpacing: 1.4, fill: 0xefe0ba,
  }) });
  const value = new Text({ text: "00:00", style: new TextStyle({
    fontFamily: "monospace", fontSize: 24, fill: 0x74f0d2,
  }) });
  const killsLabel = new Text({ text: "ENEMIES KILLED", style: label.style });
  const killsValue = new Text({ text: "0", style: value.style });
  killsLabel.anchor.set(1, 0);
  killsValue.anchor.set(1, 0);
  killsLabel.position.set(132, 66);
  killsValue.position.set(132, 82);
  label.anchor.set(1, 0);
  value.anchor.set(1, 0);
  label.position.set(132, 10);
  value.position.set(132, 26);
  panel.roundRect(0, 0, 144, 118, 8)
    .fill({ color: 0x06151b, alpha: 0.88 })
    .stroke({ width: 1, color: 0x79b5a7, alpha: 0.4 });
  root.addChild(panel, label, value, killsLabel, killsValue);
  return {
    root,
    resize(viewportSize: number) { root.position.set(Math.max(0, viewportSize - 156), 12); },
    update(elapsedMs: number, killCount: number) {
      killsValue.text = String(killCount);
      const seconds = Math.floor(Math.max(0, elapsedMs) / 1000);
      value.text = `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
    },
  };
}
