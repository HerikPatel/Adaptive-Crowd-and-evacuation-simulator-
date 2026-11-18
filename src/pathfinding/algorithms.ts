import {
  CONFIG,
  FIRE,
  type ExitId,
  type PathAlgorithm,
  type RoutingMode,
} from "../config/simulationConfig";

/** Per-agent searches; Shared Flow Field routing builds its own fields instead. */
type SearchMode = Exclude<RoutingMode, "flow-field">;
import { Grid } from "../simulation/Grid";
import type { GridPosition } from "../utils/Vector2";
import { PriorityQueue } from "./PriorityQueue";
import { findPath, type PathResult } from "./AStar";

/**
 * Grid route planners selectable in the building simulation.
 *
 * - astar:     4-connected A* with a Manhattan heuristic (the original planner).
 * - thetastar: Theta* (any-angle A*). 8-connected search whose parent pointers
 *              skip ahead whenever an agent-sized body has clear line of sight,
 *              so routes become straight diagonal lines instead of staircases.
 * - dijkstra:  Uniform-cost search (A* with h = 0). Optimal, explores the most.
 * - greedy:    Greedy best-first search (f = h). Fast, not optimal.
 * - bfs:       Breadth-first search. Fewest steps, ignores congestion weights
 *              while searching; the found route is still costed with them.
 */

const SQRT2 = Math.SQRT2;
/** Clearance used for any-angle line of sight: agent radius plus a 1 px margin. */
const LOS_RADIUS = CONFIG.agentRadius + 1;

export function stepCost(grid: Grid, next: number, mode: SearchMode, weight: number) {
  return 1 + (mode === "congestion" ? weight * grid.density[next] : 0) + FIRE.smokeRouteCost * grid.hazard[next];
}

/** Cost of a straight segment between two cell centers, in cell units. */
export function segmentCost(
  grid: Grid,
  a: GridPosition,
  b: GridPosition,
  mode: SearchMode,
  weight: number = CONFIG.congestionWeight,
): number {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  if (length === 0) return 0;
  const samples = Math.max(1, Math.ceil(length * 2));
  let density = 0, smoke = 0;
  for (let i = 1; i <= samples; i++) {
    const t = i / samples;
    const x = Math.floor(a.x + 0.5 + (b.x - a.x) * t);
    const y = Math.floor(a.y + 0.5 + (b.y - a.y) * t);
    if (!grid.inside(x, y)) continue;
    density += grid.density[grid.index(x, y)];
    smoke += grid.hazard[grid.index(x, y)];
  }
  return length * (1 + (mode === "congestion" ? weight * (density / samples) : 0) + FIRE.smokeRouteCost * (smoke / samples));
}

/** Squared distance from point (px, py) to segment (ax, ay)-(bx, by). */
function pointSegment2(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  const ex = ax + t * dx - px, ey = ay + t * dy - py;
  return ex * ex + ey * ey;
}

/** Exact squared distance between a segment and an axis-aligned box. */
function segmentBox2(ax: number, ay: number, bx: number, by: number, x0: number, y0: number, x1: number, y1: number) {
  // Liang-Barsky clip: any overlap means distance 0.
  let t0 = 0, t1 = 1;
  const dx = bx - ax, dy = by - ay;
  const clip = (p: number, q: number) => {
    if (p === 0) return q >= 0;
    const r = q / p;
    if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
    else { if (r < t0) return false; if (r < t1) t1 = r; }
    return true;
  };
  if (clip(-dx, ax - x0) && clip(dx, x1 - ax) && clip(-dy, ay - y0) && clip(dy, y1 - ay) && t0 <= t1) return 0;
  const clampX = (x: number) => Math.max(x0, Math.min(x, x1)), clampY = (y: number) => Math.max(y0, Math.min(y, y1));
  let best = Math.min(
    (ax - clampX(ax)) ** 2 + (ay - clampY(ay)) ** 2,
    (bx - clampX(bx)) ** 2 + (by - clampY(by)) ** 2,
  );
  for (const [cx, cy] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]])
    best = Math.min(best, pointSegment2(cx, cy, ax, ay, bx, by));
  return best;
}

const maskCache = new WeakMap<Grid, { revision: number; mask: Uint8Array }>();
/** Walkability as a flat array, rebuilt only when the layout or an exit changes. */
function walkMask(grid: Grid): Uint8Array {
  let cache = maskCache.get(grid);
  if (!cache || cache.revision !== grid.layoutRevision) {
    const mask = new Uint8Array(grid.cells.length);
    for (let y = 0; y < grid.height; y++)
      for (let x = 0; x < grid.width; x++) mask[grid.index(x, y)] = grid.walkable(x, y) ? 1 : 0;
    cache = { revision: grid.layoutRevision, mask };
    maskCache.set(grid, cache);
  }
  return cache.mask;
}
const isOpen = (grid: Grid, mask: Uint8Array, x: number, y: number) =>
  grid.inside(x, y) && mask[grid.index(x, y)] === 1;

const losCache = new WeakMap<Grid, { revision: number; radius: number; results: Map<number, boolean> }>();

/**
 * True when a circle of `radius` px can slide between two cell centers without
 * touching a wall. Exact capsule test against nearby wall cells; results are
 * cached per layout revision because many agents query the same pairs.
 */
export function lineOfSight(grid: Grid, a: GridPosition, b: GridPosition, radius = LOS_RADIUS): boolean {
  let cache = losCache.get(grid);
  if (!cache || cache.revision !== grid.layoutRevision || cache.radius !== radius) {
    cache = { revision: grid.layoutRevision, radius, results: new Map() };
    losCache.set(grid, cache);
  }
  const ia = grid.index(a.x, a.y), ib = grid.index(b.x, b.y), n = grid.cells.length;
  const key = ia < ib ? ia * n + ib : ib * n + ia;
  const known = cache.results.get(key);
  if (known !== undefined) return known;
  const s = grid.cellSize;
  const ax = (a.x + 0.5) * s, ay = (a.y + 0.5) * s, bx = (b.x + 0.5) * s, by = (b.y + 0.5) * s;
  const pad = Math.ceil(radius / s), mask = walkMask(grid);
  let clear = true;
  outer: for (let y = Math.min(a.y, b.y) - pad; y <= Math.max(a.y, b.y) + pad; y++)
    for (let x = Math.min(a.x, b.x) - pad; x <= Math.max(a.x, b.x) + pad; x++) {
      if (isOpen(grid, mask, x, y)) continue;
      // Skip wall cells far from the segment's supporting line before the exact test.
      if (segmentBox2(ax, ay, bx, by, x * s, y * s, (x + 1) * s, (y + 1) * s) < radius * radius - 1e-7) {
        clear = false;
        break outer;
      }
    }
  if (cache.results.size > 2_000_000) cache.results.clear();
  cache.results.set(key, clear);
  return clear;
}

/** Remaining cost of a committed route, measured with the same rules the planner used. */
export function routeCost(
  grid: Grid,
  from: GridPosition,
  waypoints: GridPosition[],
  mode: SearchMode,
  algorithm: PathAlgorithm,
  weight: number = CONFIG.congestionWeight,
): number {
  if (algorithm === "thetastar") {
    let cost = 0, prev = from;
    for (const p of waypoints) {
      cost += segmentCost(grid, prev, p, mode, weight);
      prev = p;
    }
    return cost;
  }
  return waypoints.reduce((cost, p) => cost + stepCost(grid, grid.index(p.x, p.y), mode, weight), 0);
}

function rebuild(grid: Grid, parent: Int32Array, id: number): GridPosition[] {
  const path: GridPosition[] = [];
  for (let n = id; n !== -1; n = parent[n]) path.push({ x: n % grid.width, y: Math.floor(n / grid.width) });
  return path.reverse();
}

function goalsFor(grid: Grid, start: GridPosition, targetExit: ExitId) {
  const goals = grid.exits(targetExit);
  if (!goals.length || !grid.walkable(start.x, start.y)) return null;
  return { goals, ids: new Set(goals.map((g) => grid.index(g.x, g.y))) };
}

/** Dijkstra and greedy best-first share A*'s 4-connected expansion with different priorities. */
function bestFirst(
  grid: Grid,
  start: GridPosition,
  targetExit: ExitId,
  mode: SearchMode,
  weight: number,
  priority: (g: number, h: number) => number,
): PathResult | null {
  const target = goalsFor(grid, start, targetExit);
  if (!target) return null;
  const h = (p: GridPosition) =>
    Math.min(...target.goals.map((g) => Math.abs(g.x - p.x) + Math.abs(g.y - p.y)));
  const n = grid.cells.length;
  const costs = new Float64Array(n).fill(Infinity), parent = new Int32Array(n).fill(-1), closed = new Uint8Array(n);
  const open = new PriorityQueue<number>(), startId = grid.index(start.x, start.y);
  costs[startId] = 0;
  open.push(startId, priority(0, h(start)));
  while (open.size) {
    const id = open.pop()!;
    if (closed[id]) continue;
    closed[id] = 1;
    if (target.ids.has(id)) return { path: rebuild(grid, parent, id), totalCost: costs[id], targetExit };
    const p = { x: id % grid.width, y: Math.floor(id / grid.width) };
    for (const q of grid.neighbors(p)) {
      const next = grid.index(q.x, q.y);
      if (closed[next]) continue;
      const cost = costs[id] + stepCost(grid, next, mode, weight);
      if (cost < costs[next]) {
        costs[next] = cost;
        parent[next] = id;
        open.push(next, priority(cost, h(q)));
      }
    }
  }
  return null;
}

function breadthFirst(grid: Grid, start: GridPosition, targetExit: ExitId, mode: SearchMode, weight: number): PathResult | null {
  const target = goalsFor(grid, start, targetExit);
  if (!target) return null;
  const parent = new Int32Array(grid.cells.length).fill(-1), seen = new Uint8Array(grid.cells.length);
  const startId = grid.index(start.x, start.y), queue = [startId];
  seen[startId] = 1;
  for (let head = 0; head < queue.length; head++) {
    const id = queue[head];
    if (target.ids.has(id)) {
      const path = rebuild(grid, parent, id);
      return { path, totalCost: routeCost(grid, start, path.slice(1), mode, "bfs", weight), targetExit };
    }
    for (const q of grid.neighbors({ x: id % grid.width, y: Math.floor(id / grid.width) })) {
      const next = grid.index(q.x, q.y);
      if (seen[next]) continue;
      seen[next] = 1;
      parent[next] = id;
      queue.push(next);
    }
  }
  return null;
}

/** 8-connected neighbors; diagonals may not cut a wall corner. */
const DIRECTIONS8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const;
function neighbors8(grid: Grid, mask: Uint8Array, p: GridPosition): GridPosition[] {
  const result: GridPosition[] = [];
  for (const [dx, dy] of DIRECTIONS8)
    if (isOpen(grid, mask, p.x + dx, p.y + dy) &&
        (dx === 0 || dy === 0 || (isOpen(grid, mask, p.x + dx, p.y) && isOpen(grid, mask, p.x, p.y + dy))))
      result.push({ x: p.x + dx, y: p.y + dy });
  return result;
}

/**
 * Lazy Theta*: every successor optimistically inherits its expander's parent,
 * and line of sight is verified once when the node is expanded. If the
 * shortcut is blocked, the parent falls back to the best closed neighbor.
 * Same any-angle routes as Theta*, roughly one LOS test per expansion.
 */
function thetaStar(grid: Grid, start: GridPosition, targetExit: ExitId, mode: SearchMode, weight: number): PathResult | null {
  const target = goalsFor(grid, start, targetExit);
  if (!target) return null;
  // Euclidean distance never overestimates: every segment costs at least its length.
  const h = (p: GridPosition) => Math.min(...target.goals.map((g) => Math.hypot(g.x - p.x, g.y - p.y)));
  const n = grid.cells.length;
  const costs = new Float64Array(n).fill(Infinity), parent = new Int32Array(n).fill(-1), closed = new Uint8Array(n);
  const open = new PriorityQueue<number>(), startId = grid.index(start.x, start.y);
  const at = (id: number) => ({ x: id % grid.width, y: Math.floor(id / grid.width) });
  const mask = walkMask(grid);
  costs[startId] = 0;
  parent[startId] = startId;
  open.push(startId, h(start));
  while (open.size) {
    const id = open.pop()!;
    if (closed[id]) continue;
    const p = at(id);
    if (parent[id] !== id && !lineOfSight(grid, at(parent[id]), p)) {
      // Shortcut blocked: attach to the cheapest already-expanded neighbor.
      let best = Infinity, from = -1;
      for (const q of neighbors8(grid, mask, p)) {
        const k = grid.index(q.x, q.y);
        if (!closed[k]) continue;
        const diagonal = q.x !== p.x && q.y !== p.y;
        const c = costs[k] + (diagonal ? SQRT2 : 1) * stepCost(grid, id, mode, weight);
        if (c < best) { best = c; from = k; }
      }
      if (from === -1) continue;
      costs[id] = best;
      parent[id] = from;
    }
    closed[id] = 1;
    if (target.ids.has(id)) {
      parent[startId] = -1;
      return { path: rebuild(grid, parent, id), totalCost: costs[id], targetExit };
    }
    const up = parent[id], upPos = at(up);
    for (const q of neighbors8(grid, mask, p)) {
      const next = grid.index(q.x, q.y);
      if (closed[next]) continue;
      const cost = costs[up] + segmentCost(grid, upPos, q, mode, weight);
      if (cost < costs[next] - 1e-9) {
        costs[next] = cost;
        parent[next] = up;
        open.push(next, cost + h(q));
      }
    }
  }
  return null;
}

export function findRoute(
  grid: Grid,
  start: GridPosition,
  targetExit: ExitId,
  mode: SearchMode = "shortest",
  algorithm: PathAlgorithm = "astar",
  weight: number = CONFIG.congestionWeight,
): PathResult | null {
  switch (algorithm) {
    case "astar": return findPath(grid, start, targetExit, mode, weight);
    case "thetastar": return thetaStar(grid, start, targetExit, mode, weight);
    case "dijkstra": return bestFirst(grid, start, targetExit, mode, weight, (g) => g);
    case "greedy": return bestFirst(grid, start, targetExit, mode, weight, (_g, h) => h);
    case "bfs": return breadthFirst(grid, start, targetExit, mode, weight);
  }
}

export function findBestRoute(grid: Grid, start: GridPosition, mode: SearchMode = "shortest", algorithm: PathAlgorithm = "astar") {
  let best: PathResult | null = null;
  for (const id of grid.exitIds) {
    const route = findRoute(grid, start, id, mode, algorithm);
    if (route && (!best || route.totalCost < best.totalCost)) best = route;
  }
  return best;
}
