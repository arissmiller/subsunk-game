import "./style.css";
import { createGameEngine } from "./gameEngine";

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("App root not found");
}

app.innerHTML = `
  <a class="projects-link" href="https://arissmiller.net" target="_self">Back to Projects</a>
  <main class="shell">
    <section class="intro">
      <p class="eyebrow">Subsunk</p>
      <h1>SUBSUNK</h1>
      <p class="lede">A suspensful submarine combat simulator inspired by early arcade games. SUBSUNK is the code used by the Undersea Rescue Command when a submarine is believed to be sunk</p>
      <p class="lede">Use WASD to set speed and plot your course. Press Space to launch a torpedo along that course. Can you survive the depths?</p>
    </section>

    <section class="viewport-panel" aria-label="Game viewport">
      <div class="viewport">
        <div class="game-surface" data-game-surface aria-hidden="true"></div>
      </div>
    </section>
    <section class="instructions-card" aria-labelledby="instructions-title">
      <p class="eyebrow">Captain’s briefing</p>
      <h2 id="instructions-title">Controls &amp; navigation</h2>
      <dl class="controls-guide">
        <div><dt><kbd>W</kbd> / <kbd>↑</kbd></dt><dd>Increase throttle</dd></div>
        <div><dt><kbd>S</kbd> / <kbd>↓</kbd></dt><dd>Decrease throttle</dd></div>
        <div><dt><kbd>A</kbd> / <kbd>D</kbd> / <kbd>←</kbd> / <kbd>→</kbd></dt><dd>Adjust course</dd></div>
        <div><dt><kbd>Space</kbd></dt><dd>Fire torpedo</dd></div>
        <div><dt><kbd>R</kbd></dt><dd>Reload torpedoes</dd></div>
        <div><dt>On-screen buttons</dt><dd>Click or tap to control</dd></div>
        <div><dt><kbd>Enter</kbd> / <kbd>Space</kbd> / <kbd>R</kbd></dt><dd>Restart after game over</dd></div>
      </dl>
      <p class="radar-guide"><strong>Reading the sonar:</strong> Sonar pings automatically. The pale dashed line shows your plotted course; red dashed lines show enemy courses captured by your last sonar return. HDG is your compass heading, TURN is your turn setting, and TUBES shows your remaining torpedoes. Enemy markers are last-known positions, so keep watching for fresh echoes.</p>
    </section>
  </main>
`;

const gameSurface = document.querySelector<HTMLElement>("[data-game-surface]");

if (!gameSurface) {
  throw new Error("Game surface not found");
}

void createGameEngine(gameSurface);
