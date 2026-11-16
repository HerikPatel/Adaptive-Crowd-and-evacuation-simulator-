import { CONFIG, type ExitId } from "../config/simulationConfig";
import { Grid } from "../simulation/Grid";
import type { GridPosition } from "../utils/Vector2";
import type { PathResult } from "./AStar";
import { PriorityQueue } from "./PriorityQueue";

export interface FlowField {
  width: number;
  height: number;
  targetExit: ExitId;
  /** Cost to an exit; blocked and unreachable cells remain Infinity. */
  integration: Float64Array;
  /** Cardinal successor toward the exit; -1 at goals and unreachable cells. */
  next: Int32Array;
}

/** Multi-source reverse Dijkstra, seeded from every cell of one exit opening.
 * Forward u -> v pays entryCosts[v], so reverse relaxation also pays v, not u.
 * Positive costs make each successor strictly downhill, even with weighted cells.
 */
export function buildFlowField(grid: Grid, targetExit: ExitId, entryCosts: Float64Array): FlowField {
  const integration = new Float64Array(grid.cells.length).fill(Infinity);
  const next = new Int32Array(grid.cells.length).fill(-1);
  const queue = new PriorityQueue<{ id: number; cost: number }>();
  for (const goal of grid.exits(targetExit)) {
    const id = grid.index(goal.x, goal.y);
    integration[id] = 0;
    queue.push({ id, cost: 0 }, 0);
  }
  while (queue.size) {
    const current = queue.pop()!;
    if (current.cost !== integration[current.id]) continue;
    const p = { x: current.id % grid.width, y: Math.floor(current.id / grid.width) };
    const cost = current.cost + entryCosts[current.id];
    for (const neighbor of grid.neighbors(p)) {
      const id = grid.index(neighbor.x, neighbor.y);
      if (cost >= integration[id]) continue;
      integration[id] = cost;
      next[id] = current.id;
      queue.push({ id, cost }, cost);
    }
  }
  return { width: grid.width, height: grid.height, targetExit, integration, next };
}

/** Trace only an accepted route; this performs no graph search. Existing waypoint
 * lookahead and local avoidance can then follow it without changing their contracts.
 */
export function traceFlowField(field: FlowField, start: GridPosition): PathResult | null {
  if (!Number.isInteger(start.x) || !Number.isInteger(start.y) ||
      start.x < 0 || start.y < 0 || start.x >= field.width || start.y >= field.height) return null;
  let id = start.y * field.width + start.x;
  const totalCost = field.integration[id];
  if (!Number.isFinite(totalCost)) return null;
  const path: GridPosition[] = [];
  for (let count = 0; count < field.next.length; count++) {
    path.push({ x: id % field.width, y: Math.floor(id / field.width) });
    if (field.integration[id] === 0) return { path, totalCost, targetExit: field.targetExit };
    const successor = field.next[id];
    if (successor < 0 || field.integration[successor] >= field.integration[id]) return null;
    id = successor;
  }
  return null;
}

/** All agents share one cost snapshot and at most one field per open exit.
 * Density refreshes are bounded by simulation time; topology changes bypass that delay.
 */
export class SharedFlowFields {
  builds = 0;
  snapshots = 0;
  private grid: Grid | null = null;
  private layoutRevision = -1;
  private sampledAt = -Infinity;
  private entryCosts = new Float64Array();
  private fields = new Map<ExitId, FlowField>();
  private exits: ExitId[] = [];

  prepare(grid: Grid, time: number) {
    if (grid === this.grid && grid.layoutRevision === this.layoutRevision &&
        time >= this.sampledAt && time < this.sampledAt + CONFIG.flowFieldInterval - 1e-9) return;
    this.grid = grid;
    this.layoutRevision = grid.layoutRevision;
    this.sampledAt = time;
    this.entryCosts = Float64Array.from(grid.density, density => 1 + CONFIG.congestionWeight * density);
    this.exits = grid.exitIds.filter(id => !grid.blockedExits.has(id));
    this.fields.clear();
    this.snapshots++;
  }

  field(exit: ExitId): FlowField | null {
    if (!this.grid || !this.exits.includes(exit)) return null;
    if (!this.fields.has(exit)) {
      this.fields.set(exit, buildFlowField(this.grid, exit, this.entryCosts));
      this.builds++;
    }
    return this.fields.get(exit)!;
  }

  stepCost(p: GridPosition): number {
    return this.grid && this.grid.inside(p.x, p.y) ? this.entryCosts[this.grid.index(p.x, p.y)] : Infinity;
  }
}
