import { FIRE } from "../config/simulationConfig";
import type { GridPosition } from "../utils/Vector2";
import { CellType, type Grid } from "./Grid";
import type { Simulation } from "./Simulation";
import type { Agent } from "./Agent";

/**
 * A fire that starts in the middle of the building and spreads one ring of
 * floor cells at a time. Burning cells cannot be walked through; smoke within a
 * few cells of the fire slows people down and makes routes through it costly.
 *
 * The fire never traps anyone: it does not spread into a cell where a person is
 * standing, or into a cell whose loss would cut any person off from every open exit.
 */
export class FireSpread {
  readonly origin: GridPosition | null;
  startTime: number | null = null;
  burning = 0;
  private nextSpread: number = FIRE.startSeconds;

  constructor(grid: Grid) {
    this.origin = fireOrigin(grid);
  }

  get started() { return this.startTime !== null; }
  get finished() { return this.burning >= FIRE.maxCells; }

  /** Advances the fire to the current simulation time. Returns true if it grew. */
  update(s: Simulation): boolean {
    if (!this.origin || this.finished || s.time + 1e-9 < this.nextSpread) return false;
    this.nextSpread += FIRE.spreadIntervalSeconds;
    const grid = s.grid, added: number[] = [];
    const candidates = this.started ? frontier(grid) : nearestFree(grid, this.origin);
    for (const id of candidates) {
      if (this.burning + added.length >= FIRE.maxCells) break;
      if (occupied(s.agents, grid, id)) continue;
      grid.fire[id] = 1;
      if (traps(s.agents, grid)) { grid.fire[id] = 0; continue; }
      added.push(id);
      if (!this.started) break;
    }
    if (!added.length) return false;
    if (!this.started) this.startTime = s.time;
    this.burning += added.length;
    grid.layoutRevision++;
    updateSmoke(grid);
    s.rerouteAround(added);
    return true;
  }
}

/** Floor cell nearest the middle of the building's floor area. */
export function fireOrigin(grid: Grid): GridPosition | null {
  let sx = 0, sy = 0, n = 0;
  for (let y = 0; y < grid.height; y++)
    for (let x = 0; x < grid.width; x++)
      if (grid.type(x, y) === CellType.Walkable) { sx += x; sy += y; n++; }
  if (!n) return null;
  const cx = sx / n, cy = sy / n;
  let best: GridPosition | null = null, bestD = Infinity;
  for (let y = 1; y < grid.height - 1; y++)
    for (let x = 1; x < grid.width - 1; x++) {
      if (grid.type(x, y) !== CellType.Walkable) continue;
      const d = (x - cx) ** 2 + (y - cy) ** 2;
      if (d < bestD) { bestD = d; best = { x, y }; }
    }
  return best;
}

const isFloor = (grid: Grid, x: number, y: number) =>
  grid.type(x, y) === CellType.Walkable && !grid.fire[grid.index(x, y)];

/** Unburnt floor cells touching the fire, in a fixed order so runs are reproducible. */
function frontier(grid: Grid): number[] {
  const result = new Set<number>();
  for (let y = 0; y < grid.height; y++)
    for (let x = 0; x < grid.width; x++) {
      if (!grid.fire[grid.index(x, y)]) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]])
        if (isFloor(grid, x + dx, y + dy)) result.add(grid.index(x + dx, y + dy));
    }
  return [...result].sort((a, b) => a - b);
}

/** Floor cells ordered by distance from the origin, for ignition when the origin is occupied. */
function nearestFree(grid: Grid, origin: GridPosition): number[] {
  const cells: number[] = [];
  for (let y = 0; y < grid.height; y++)
    for (let x = 0; x < grid.width; x++) if (isFloor(grid, x, y)) cells.push(grid.index(x, y));
  const d = (id: number) => (id % grid.width - origin.x) ** 2 + (Math.floor(id / grid.width) - origin.y) ** 2;
  return cells.sort((a, b) => d(a) - d(b) || a - b).slice(0, 60);
}

/** True if any person's body overlaps the cell. */
function occupied(agents: Agent[], grid: Grid, id: number) {
  const s = grid.cellSize, x0 = (id % grid.width) * s, y0 = Math.floor(id / grid.width) * s;
  return agents.some((a) => {
    if (a.evacuated) return false;
    const dx = a.position.x - Math.max(x0, Math.min(a.position.x, x0 + s));
    const dy = a.position.y - Math.max(y0, Math.min(a.position.y, y0 + s));
    return dx * dx + dy * dy < (a.radius + 1) ** 2;
  });
}

/** True if someone could no longer reach any open exit. */
function traps(agents: Agent[], grid: Grid) {
  const reachable = grid.reachableFromExits();
  return agents.some((a) => {
    if (a.evacuated) return false;
    const c = grid.cell(a.position);
    return grid.inside(c.x, c.y) && !reachable[grid.index(c.x, c.y)];
  });
}

/** Smoke spreads through open floor (not through walls), thinning with distance from the fire. */
export function updateSmoke(grid: Grid) {
  grid.hazard.fill(0);
  const distance = new Int16Array(grid.cells.length).fill(-1), queue: number[] = [];
  for (let i = 0; i < grid.fire.length; i++) if (grid.fire[i]) { distance[i] = 0; queue.push(i); }
  for (let head = 0; head < queue.length; head++) {
    const id = queue[head], d = distance[id];
    if (d >= FIRE.smokeRangeCells) continue;
    const x = id % grid.width, y = Math.floor(id / grid.width);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (!grid.walkable(nx, ny)) continue;
      const n = grid.index(nx, ny);
      if (distance[n] !== -1) continue;
      distance[n] = d + 1;
      grid.hazard[n] = 1 - d / FIRE.smokeRangeCells;
      queue.push(n);
    }
  }
}
