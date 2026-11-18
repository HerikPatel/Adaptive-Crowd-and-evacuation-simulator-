import { CONFIG, type ExitId, type PathAlgorithm, type RoutingMode } from "../config/simulationConfig";
import type { Agent } from "../simulation/Agent";
import { Grid } from "../simulation/Grid";
import type { PathResult } from "./AStar";
import { findRoute, lineOfSight, routeCost } from "./algorithms";
import { SharedFlowFields, traceFlowField } from "./SharedFlowField";

interface Candidate extends Pick<PathResult, "totalCost" | "targetExit"> {
  trace(): PathResult | null;
}
export function shouldSwitch(
  newCost: number,
  currentCost: number,
  ratio: number = CONFIG.switchRatio,
): boolean {
  return newCost < currentCost * ratio;
}
export class CongestionRouter {
  readonly flowFields = new SharedFlowFields();
  requests = 0;
  private aStarSearches = 0;
  get searches() { return this.aStarSearches + this.flowFields.builds; }

  /** `onlyExit` keeps a group member on its leader's exit; if that exit is unreachable, all exits are considered. */
  plan(agent: Agent, grid: Grid, mode: RoutingMode, time = 0, algorithm: PathAlgorithm = "astar", onlyExit?: ExitId): PathResult | null {
    this.requests++;
    const start = grid.cell(agent.position);
    if (!grid.walkable(start.x, start.y)) return null;
    const routes: Candidate[] = [];
    if (mode === "flow-field") this.flowFields.prepare(grid, time);
    const allowed = (id: ExitId) => !onlyExit || id === onlyExit;
    for (let pass = 0; pass < 2 && !routes.length; pass++)
    for (const id of grid.exitIds) {
      if (grid.blockedExits.has(id) || (pass === 0 && !allowed(id)) || (pass === 1 && !onlyExit)) continue;
      if (mode === "flow-field") {
        const field = this.flowFields.field(id)!;
        const totalCost = field.integration[grid.index(start.x, start.y)];
        if (Number.isFinite(totalCost)) routes.push({ targetExit: id, totalCost, trace: () => traceFlowField(field, start) });
      } else {
        this.aStarSearches++;
        const route = findRoute(grid, start, id, mode, algorithm);
        if (route) routes.push({ ...route, trace: () => route });
      }
    }
    let best: Candidate | null = null;
    for (const route of routes)
      if (!best || route.totalCost < best.totalCost) best = route;
    if (!best) return null;
    const incumbent = routes.find((route) => route.targetExit === agent.targetExit);
    const remaining = agent.path.slice(agent.pathIndex);
    const valid =
      remaining.length > 0 && remaining.every((p) => grid.walkable(p.x, p.y)) &&
      // Any-angle waypoints are far apart: if the crowd pushed this agent off its
      // line, the straight segment to the next waypoint may now clip a corner.
      (mode === "flow-field" || algorithm !== "thetastar" || lineOfSight(grid, start, remaining[0]));
    if (!incumbent || !valid) return best.trace();
    // Compare all exits from the CURRENT position against the SAME density snapshot.
    // Comparing to lastPathCost would compare a whole old trip with a shorter new trip.
    // Commitment is broken only by closure/unreachability or a >15% improvement.
    if (
      best.targetExit !== agent.targetExit &&
      shouldSwitch(best.totalCost, incumbent.totalCost)
    )
      return best.trace();
    // Within the committed route, also avoid constantly dragging agents back to centers.
    const remainingCost = mode === "flow-field"
      ? remaining.reduce((cost, p) => cost + this.flowFields.stepCost(p), 0)
      : routeCost(grid, start, remaining, mode, algorithm);
    if (
      shouldSwitch(incumbent.totalCost, remainingCost) &&
      remaining.length > 2
    )
      return incumbent.trace();
    return null;
  }
}
