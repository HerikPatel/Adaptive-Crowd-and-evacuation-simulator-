import { CONFIG, type RoutingMode } from "../config/simulationConfig";
import type { Agent } from "../simulation/Agent";
import { Grid } from "../simulation/Grid";
import { findPath, type PathResult } from "./AStar";
export function shouldSwitch(
  newCost: number,
  currentCost: number,
  ratio: number = CONFIG.switchRatio,
): boolean {
  return newCost < currentCost * ratio;
}
export class CongestionRouter {
  plan(agent: Agent, grid: Grid, mode: RoutingMode): PathResult | null {
    const start = grid.cell(agent.position),
      a = findPath(grid, start, "A", mode),
      b = findPath(grid, start, "B", mode);
    const best = !a ? b : !b ? a : a.totalCost <= b.totalCost ? a : b;
    if (!best) return null;
    const incumbent =
      agent.targetExit === "A" ? a : agent.targetExit === "B" ? b : null;
    const remaining = agent.path.slice(agent.pathIndex);
    const valid =
      remaining.length > 0 && remaining.every((p) => grid.walkable(p.x, p.y));
    if (!incumbent || !valid) return best;
    // Compare both exits from the CURRENT position against the SAME density snapshot.
    // Comparing to lastPathCost would compare a whole old trip with a shorter new trip.
    // Commitment is broken only by closure/unreachability or a >=15% improvement.
    if (
      best.targetExit !== agent.targetExit &&
      shouldSwitch(best.totalCost, incumbent.totalCost)
    )
      return best;
    // Within the committed route, also avoid constantly dragging agents back to centers.
    const remainingCost = remaining.reduce(
      (cost, p) =>
        cost +
        1 +
        (mode === "congestion"
          ? CONFIG.congestionWeight * grid.density[grid.index(p.x, p.y)]
          : 0),
      0,
    );
    if (
      shouldSwitch(incumbent.totalCost, remainingCost) &&
      remaining.length > 2
    )
      return incumbent;
    return null;
  }
}
