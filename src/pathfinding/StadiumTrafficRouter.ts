import { walkingSpeed } from "../simulation/PersonProfile";
import type { StadiumSpectator } from "../simulation/StadiumSimulation";
import { StadiumRouter, routeStepKey, type StadiumRoute, type StadiumRouteCosts, type StadiumRouteStep, type StadiumRoutingMode } from "./StadiumRouter";

export const TRAFFIC_SETTINGS = { sampleSeconds: 2, smoothing: 0.35, cooldownSeconds: 8, improvementFraction: 0.15, improvementSeconds: 3 } as const;
interface Plan { route: StadiumRoute | null; checkedAt: number; revision: number; visited: Set<string> }

/** Dynamic graph travel-time potentials, with committed itineraries and conservative switching. */
export class StadiumTrafficRouter {
  readonly delays = new Map<string, number>();
  readonly queues = new Map<string, number>();
  switches = 0;
  forcedReroutes = 0;
  searches = 0;
  snapshots = 0;
  private sampledAt = -Infinity;
  private revision = -1;
  private plans = new Map<number, Plan>();
  private potentials = new Map<number, Map<string, StadiumRouteStep>>();
  private routes = new Map<string, StadiumRoute | null>();
  private lengths: Map<string, number>;

  constructor(readonly router: StadiumRouter, readonly mode: StadiumRoutingMode) {
    this.lengths = new Map(router.network.edges.map(e => [e.id, e.physicalPath.length]));
  }

  invalidatePerson(id: number) { this.plans.delete(id); }
  peek(id: number) { return this.plans.get(id)?.route ?? null; }

  sample(people: StadiumSpectator[], time: number) {
    const changed = this.revision !== this.router.costRevision;
    if (!changed && time < this.sampledAt + TRAFFIC_SETTINGS.sampleSeconds - 1e-8) return;
    this.revision = this.router.costRevision; this.sampledAt = time;
    this.queues.clear();
    const occupancy = new Map<string, number>();
    const increment = (map: Map<string, number>, key: string) => map.set(key, (map.get(key) ?? 0) + 1);
    for (const p of people) {
      const state = p.state, plan = this.peek(p.id);
      if (state.kind === "walking" || state.kind === "transfer") increment(occupancy, routeStepKey(state.step));
      if (p.stranded || !p.waiting || state.kind === "seated" || state.kind === "evacuated") continue;
      if (state.kind === "node" && plan?.steps[0]) increment(this.queues, routeStepKey(plan.steps[0]));
      // Include stopped upstream followers near a transfer, not only the person at its entrance.
      if (state.kind === "walking" && plan) {
        let distance = this.lengths.get(state.step.edgeId)! - state.distance;
        for (const step of plan.steps) {
          if (distance > 15) break;
          if (this.router.edges.get(step.edgeId)!.transfer) { increment(this.queues, routeStepKey(step)); break; }
          distance += this.lengths.get(step.edgeId)!;
        }
      }
    }
    if (this.mode === "adaptive") {
      for (const edge of this.router.network.edges) for (const from of edge.direction === "both" ? [edge.from, edge.to] : [edge.from]) {
        const key = routeStepKey({ edgeId: edge.id, from, to: from === edge.from ? edge.to : edge.from });
        const n = occupancy.get(key) ?? 0, q = this.queues.get(key) ?? 0, length = this.lengths.get(edge.id)!;
        const transfer = this.router.parameters(edge.id);
        const service = transfer ? Math.max(1 / transfer.capacityPerSecond, 1.6 * transfer.travelSeconds / Math.max(length, 1.6)) : 1.1 / 1.2;
        const load = n * (transfer ? 1.6 : 1.1) / Math.max(length, 1.1);
        const raw = q * service + this.router.edgeSeconds(edge) * Math.min(3, 2 * load * load);
        this.delays.set(key, (this.delays.get(key) ?? 0) * (1 - TRAFFIC_SETTINGS.smoothing) + raw * TRAFFIC_SETTINGS.smoothing);
      }
      this.snapshots++;
    }
    if (changed || this.mode === "adaptive") { this.potentials.clear(); this.routes.clear(); }
  }

  private costs(p: StadiumSpectator): StadiumRouteCosts {
    // Shared fields use 0.1 m/s speed bands; physical movement retains the exact individual speed.
    const speed = Math.max(0.5, Math.round(walkingSpeed(p.profile) * 10) / 10);
    return this.mode === "adaptive" ? { speed, delays: this.delays } : { speed };
  }

  private candidate(node: string, costs: StadiumRouteCosts): StadiumRoute | null {
    const speed = costs.speed ?? 1.2, key = `${node}:${speed}`;
    if (!this.potentials.has(speed)) { this.potentials.set(speed, this.router.potential(costs)); this.searches++; }
    if (!this.routes.has(key)) this.routes.set(key, this.router.routeFromPotential(node, this.potentials.get(speed)!, costs));
    return this.routes.get(key)!;
  }

  choose(p: StadiumSpectator, node: string, time: number): StadiumRoute | null {
    let plan = this.plans.get(p.id);
    const changed = plan?.revision !== this.router.costRevision;
    if (plan && !changed && (this.mode === "free-flow" || time < plan.checkedAt + TRAFFIC_SETTINGS.cooldownSeconds)) return plan.route;
    const costs = this.costs(p);
    const invalid = !plan?.route || !Number.isFinite(this.router.routeSeconds(plan.route.steps));
    const candidate = this.candidate(node, costs);
    if (!plan) {
      plan = { route: candidate, checkedAt: time + (p.id % 8) * 0.25, revision: this.router.costRevision, visited: new Set() };
      this.plans.set(p.id, plan); return candidate;
    }
    const old = plan.route;
    plan.checkedAt = time + (p.id % 8) * 0.25; plan.revision = this.router.costRevision;
    if (invalid || (changed && this.mode === "free-flow")) {
      if (old && candidate && !this.same(old, candidate)) this.forcedReroutes++;
      plan.route = candidate;
      // Closures may require retracing a former corridor; voluntary changes never do.
      if (invalid) plan.visited.clear();
    } else if (candidate && old && !this.same(old, candidate) &&
        !candidate.steps.some(step => plan!.visited.has(step.to)) &&
        shouldSwitchRoute(this.router.routeSeconds(old.steps, costs), candidate.estimatedSeconds)) {
      plan.route = candidate; this.switches++;
    }
    return plan.route;
  }

  depart(id: number, step: StadiumRouteStep) {
    const plan = this.plans.get(id);
    if (!plan?.route) return;
    plan.visited.add(step.from);
    plan.route = { ...plan.route, steps: plan.route.steps.slice(1) };
  }
  private same(a: StadiumRoute, b: StadiumRoute) { return a.steps.length === b.steps.length && a.steps.every((s, i) => routeStepKey(s) === routeStepKey(b.steps[i])); }
}

export function shouldSwitchRoute(current: number, alternative: number): boolean {
  return Number.isFinite(alternative) && current - alternative >= TRAFFIC_SETTINGS.improvementSeconds && alternative < current * (1 - TRAFFIC_SETTINGS.improvementFraction);
}
