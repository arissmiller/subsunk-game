import { worldDistance, type WorldPoint } from "../engine/navigation";
import type { SonarState } from "../radarTypes";
import {
  GRID_CELL_SIZE, GRID_UNSCANNED_ALPHA, GRID_SCANNED_ALPHA, GRID_PING_ALPHA,
  GRID_HIGHLIGHT_MS, CONTACT_VISIBLE_RADIUS, SONAR_WAVE_SPEED,
  CHUNK_SIZE, CHUNK_LOAD_RADIUS,
} from "./config";

export function gridCellAt(position: WorldPoint): WorldPoint {
  return { x: Math.floor(position.x / GRID_CELL_SIZE), y: Math.floor(position.y / GRID_CELL_SIZE) };
}

export function gridKey(x: number, y: number) { return `${x},${y}`; }

export function gridCellCenter(x: number, y: number): WorldPoint {
  return { x: (x + 0.5) * GRID_CELL_SIZE, y: (y + 0.5) * GRID_CELL_SIZE };
}

export function updateGridCoverage(sonar: SonarState, frameMs: number, playerPosition: WorldPoint) {
  for (const pulse of sonar.pulses) {
    if (pulse.owner !== "player" || frameMs < pulse.emittedAtMs) continue;
    // Match sonar echo timing: outward travel plus return to the emission origin.
    const radius = Math.min(CONTACT_VISIBLE_RADIUS, (frameMs - pulse.emittedAtMs) * SONAR_WAVE_SPEED / 2000);
    const min = gridCellAt({ x: pulse.origin.x - radius, y: pulse.origin.y - radius });
    const max = gridCellAt({ x: pulse.origin.x + radius, y: pulse.origin.y + radius });
    for (let y = min.y; y <= max.y; y += 1) {
      for (let x = min.x; x <= max.x; x += 1) {
        const center = gridCellCenter(x, y);
        // A delayed sweep must not restore coverage in an unloaded chunk.
        if (Math.abs(Math.floor(center.x / CHUNK_SIZE) - Math.floor(playerPosition.x / CHUNK_SIZE)) > CHUNK_LOAD_RADIUS ||
            Math.abs(Math.floor(center.y / CHUNK_SIZE) - Math.floor(playerPosition.y / CHUNK_SIZE)) > CHUNK_LOAD_RADIUS) continue;
        const distance = worldDistance(pulse.origin, center);
        if (distance > radius) continue;
        const arrivedAt = pulse.emittedAtMs + distance / SONAR_WAVE_SPEED * 2000;
        const key = gridKey(x, y);
        if (arrivedAt > (sonar.coverage.get(key) ?? -Infinity)) sonar.coverage.set(key, arrivedAt);
      }
    }
  }
}

export function gridCellAlpha(coverage: Map<string, number>, x: number, y: number, frameMs: number) {
  const scannedAt = coverage.get(gridKey(x, y));
  if (scannedAt === undefined) return GRID_UNSCANNED_ALPHA;
  const remaining = Math.max(0, Math.min(1, 1 - (frameMs - scannedAt) / GRID_HIGHLIGHT_MS));
  return GRID_SCANNED_ALPHA + (GRID_PING_ALPHA - GRID_SCANNED_ALPHA) * remaining;
}

export interface GridEdge { from: WorldPoint; to: WorldPoint; alpha: number }

export function visibleGridEdges(origin: WorldPoint, radius: number, coverage: Map<string, number>, frameMs: number): GridEdge[] {
  const min = gridCellAt({ x: origin.x - radius, y: origin.y - radius });
  const max = gridCellAt({ x: origin.x + radius, y: origin.y + radius });
  const edges: GridEdge[] = [];
  const alpha = (x: number, y: number) => gridCellAlpha(coverage, x, y, frameMs);
  // Each shared edge is drawn once, using the brighter neighboring cell.
  for (let y = min.y; y <= max.y; y += 1) {
    for (let x = min.x; x <= max.x + 1; x += 1) {
      edges.push({ from: { x: x * GRID_CELL_SIZE, y: y * GRID_CELL_SIZE }, to: { x: x * GRID_CELL_SIZE, y: (y + 1) * GRID_CELL_SIZE }, alpha: Math.max(alpha(x - 1, y), alpha(x, y)) });
    }
  }
  for (let y = min.y; y <= max.y + 1; y += 1) {
    for (let x = min.x; x <= max.x; x += 1) {
      edges.push({ from: { x: x * GRID_CELL_SIZE, y: y * GRID_CELL_SIZE }, to: { x: (x + 1) * GRID_CELL_SIZE, y: y * GRID_CELL_SIZE }, alpha: Math.max(alpha(x, y - 1), alpha(x, y)) });
    }
  }
  return edges.filter((edge) => edge.alpha > 0);
}
