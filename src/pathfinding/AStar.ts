import {
  CONFIG,
  type ExitId,
  type RoutingMode,
} from "../config/simulationConfig";
import { Grid } from "../simulation/Grid";
import type { GridPosition } from "../utils/Vector2";
import { PriorityQueue } from "./PriorityQueue";
export interface PathResult {
  path: GridPosition[];
  totalCost: number;
  targetExit: ExitId;
}
export function findPath(
  grid: Grid,
  start: GridPosition,
  targetExit: ExitId,
  mode: RoutingMode = "shortest",
  weight: number = CONFIG.congestionWeight,
): PathResult | null {
  const goals = grid.exits(targetExit);
  if (!goals.length || !grid.walkable(start.x, start.y)) return null;
  const heuristic = (p: GridPosition) =>
    Math.min(...goals.map((g) => Math.abs(g.x - p.x) + Math.abs(g.y - p.y)));
  const goalIds = new Set(goals.map((g) => grid.index(g.x, g.y)));
  const costs = new Float64Array(grid.cells.length).fill(Infinity),
    parent = new Int32Array(grid.cells.length).fill(-1),
    closed = new Uint8Array(grid.cells.length);
  const open = new PriorityQueue<number>(),
    startId = grid.index(start.x, start.y);
  costs[startId] = 0;
  open.push(startId, heuristic(start));
  while (open.size) {
    const id = open.pop()!;
    if (closed[id]) continue;
    closed[id] = 1;
    if (goalIds.has(id)) {
      const path: GridPosition[] = [];
      let n = id;
      while (n !== -1) {
        path.push({ x: n % grid.width, y: Math.floor(n / grid.width) });
        n = parent[n];
      }
      return { path: path.reverse(), totalCost: costs[id], targetExit };
    }
    const p = { x: id % grid.width, y: Math.floor(id / grid.width) };
    for (const q of grid.neighbors(p)) {
      const next = grid.index(q.x, q.y);
      if (closed[next]) continue;
      const cost =
        costs[id] +
        1 +
        (mode === "congestion" ? weight * grid.density[next] : 0);
      if (cost < costs[next]) {
        costs[next] = cost;
        parent[next] = id;
        open.push(next, cost + heuristic(q));
      }
    }
  }
  return null;
}
export function findBestPath(
  grid: Grid,
  start: GridPosition,
  mode: RoutingMode = "shortest",
): PathResult | null {
  const a = findPath(grid, start, "A", mode),
    b = findPath(grid, start, "B", mode);
  return !a ? b : !b ? a : a.totalCost <= b.totalCost ? a : b;
}
