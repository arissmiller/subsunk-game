import "./style.css";
import { createGameEngine } from "./gameEngine";

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("App root not found");
}

app.innerHTML = `
  <main class="shell">
    <section class="intro">
      <p class="eyebrow">Subsunk</p>
      <h1>SUBSUNK</h1>
      <p class="lede">A suspensful submarine combat simulator inspired by early arcade games. SUBSUNK is the code used by the Undersea Rescue Command when a submarine is believed to be sunk</p>
      <p class="lede">Use the WASD keys to move your submarine and the mouse to aim and shoot torpedoes at your enemies. Can you survive the depths?</p>
    </section>

    <section class="viewport-panel" aria-label="Game viewport">
      <div class="viewport">
        <div class="game-surface" data-game-surface aria-hidden="true"></div>
      </div>
    </section>
  </main>
`;

const gameSurface = document.querySelector<HTMLElement>("[data-game-surface]");

if (!gameSurface) {
  throw new Error("Game surface not found");
}

void createGameEngine(gameSurface);
