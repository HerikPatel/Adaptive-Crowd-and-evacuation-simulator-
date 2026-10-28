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
    const start = grid.cell(agent.position);
    const routes = grid.exitIds.map((id) => findPath(grid, start, id, mode));
    let best: PathResult | null = null;
    for (const route of routes)
      if (route && (!best || route.totalCost < best.totalCost)) best = route;
    if (!best) return null;
    const incumbent = routes.find((route) => route?.targetExit === agent.targetExit);
    const remaining = agent.path.slice(agent.pathIndex);
    const valid =
      remaining.length > 0 && remaining.every((p) => grid.walkable(p.x, p.y));
    if (!incumbent || !valid) return best;
    // Compare all exits from the CURRENT position against the SAME density snapshot.
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
