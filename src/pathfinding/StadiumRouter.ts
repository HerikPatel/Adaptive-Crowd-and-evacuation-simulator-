import { PriorityQueue } from "./PriorityQueue";
import { STADIUM_ASSUMPTIONS, createStadiumNetwork, validateStadiumNetwork,
  type NavigationEdge, type StadiumNetwork, type TransferParameters } from "../maps/stadiumNavigation";
import { transferDuration } from "../simulation/StadiumPhysicalGeometry";

export interface StadiumRouteStep { edgeId: string; from: string; to: string }
export interface StadiumRoutingContext { walkingSpeedMetersPerSecond: number }
export type StadiumRoutingMode = "free-flow" | "adaptive";
export interface StadiumRouteCosts { speed?: number; delays?: ReadonlyMap<string, number> }
export const routeStepKey = (step: StadiumRouteStep) => `${step.edgeId}:${step.from}`;
export interface StadiumRoute {
  sectionId: string;
  gateId: string;
  steps: StadiumRouteStep[];
  assumedWalkMeters: number;
  transferSeconds: number;
  freeFlowSeconds: number;
  estimatedSeconds: number;
}

/** Surface-aware routes shared by inspection and the crowd simulation. */
export class StadiumRouter {
  /** Connectivity revision: changes only when an edge opens or closes. */
  revision = 0;
  /** Cost revision: changes when transfer timing assumptions change. */
  parameterRevision = 0;
  /** All changes that can alter path costs, while preserving connectivity-only revision semantics. */
  get costRevision() { return this.revision + this.parameterRevision * 1_000_000; }
  readonly nodes;
  readonly edges;
  readonly controls: NavigationEdge[];
  private closed = new Set<string>();
  private overrides = new Map<string, TransferParameters>();
  private outgoing = new Map<string, StadiumRouteStep[]>();
  private incoming = new Map<string, StadiumRouteStep[]>();

  constructor(readonly network: StadiumNetwork = createStadiumNetwork()) {
    const errors = validateStadiumNetwork(network);
    if (errors.length) throw new Error(`Invalid stadium network: ${errors.join("; ")}`);
    this.nodes = new Map(network.nodes.map(n => [n.id, n]));
    this.edges = new Map(network.edges.map(e => [e.id, e]));
    this.controls = network.edges.filter(e => e.transfer || e.kind === "gate");
    const add = (step: StadiumRouteStep) => {
      const outgoing = this.outgoing.get(step.from) ?? [];
      outgoing.push(step); this.outgoing.set(step.from, outgoing);
      const incoming = this.incoming.get(step.to) ?? [];
      incoming.push(step); this.incoming.set(step.to, incoming);
    };
    for (const e of network.edges) {
      add({ edgeId: e.id, from: e.from, to: e.to });
      if (e.direction === "both") add({ edgeId: e.id, from: e.to, to: e.from });
    }
  }

  isClosed(id: string): boolean { return this.closed.has(id); }
  setClosed(id: string, closed: boolean) {
    if (!this.controls.some(e => e.id === id)) throw new Error("Unknown gate or connector");
    if (this.closed.has(id) === closed) return;
    if (closed) this.closed.add(id); else this.closed.delete(id);
    this.revision++;
  }
  parameters(id: string): TransferParameters | null {
    const value = this.overrides.get(id) ?? this.edges.get(id)?.transfer;
    return value ? { ...value } : null;
  }
  setParameters(id: string, value: TransferParameters) {
    if (!this.edges.get(id)?.transfer) throw new Error("Unknown transfer connection");
    if (!Number.isFinite(value.travelSeconds) || value.travelSeconds < 0.1 || value.travelSeconds > 3600)
      throw new Error("Travel time must be between 0.1 and 3600 seconds.");
    if (!Number.isFinite(value.capacityPerSecond) || value.capacityPerSecond < 0.1 || value.capacityPerSecond > 100)
      throw new Error("Capacity must be between 0.1 and 100 people per second.");
    const previous = this.parameters(id)!;
    if (previous.travelSeconds === value.travelSeconds && previous.capacityPerSecond === value.capacityPerSecond) return;
    this.overrides.set(id, { ...value });
    this.parameterRevision++;
  }
  reset() {
    if (!this.closed.size && !this.overrides.size) return;
    if (this.closed.size) { this.closed.clear(); this.revision++; }
    if (this.overrides.size) { this.overrides.clear(); this.parameterRevision++; }
  }

  private speed(context?: StadiumRoutingContext | number): number {
    const speed = typeof context === "number" ? context : context?.walkingSpeedMetersPerSecond ?? STADIUM_ASSUMPTIONS.walkingSpeedMetersPerSecond;
    if (!Number.isFinite(speed) || speed <= 0) throw new Error("Walking speed must be a positive finite number.");
    return speed;
  }

  edgeSeconds(edge: NavigationEdge, context?: StadiumRoutingContext | number): number {
    const speed = this.speed(context);
    const transfer = this.parameters(edge.id);
    return transfer
      ? transferDuration(edge.physicalPath.length, speed, transfer.travelSeconds)
      : edge.physicalPath.length / speed;
  }

  stepSeconds(step: StadiumRouteStep, costs: StadiumRouteCosts = {}): number {
    return this.isClosed(step.edgeId) ? Infinity :
      this.edgeSeconds(this.edges.get(step.edgeId)!, costs.speed) + Math.max(0, costs.delays?.get(routeStepKey(step)) ?? 0);
  }

  routeSeconds(steps: StadiumRouteStep[], costs: StadiumRouteCosts = {}): number {
    return steps.reduce((sum, step) => sum + this.stepSeconds(step, costs), 0);
  }

  /** Reverse shortest-time potential shared by everyone in a speed band for one traffic snapshot. */
  potential(costs: StadiumRouteCosts = {}): Map<string, StadiumRouteStep> {
    const next = new Map<string, StadiumRouteStep>(), distance = new Map<string, number>();
    const queue = new PriorityQueue<{ id: string; cost: number }>();
    for (const id of Object.values(this.network.gateNodes)) { distance.set(id, 0); queue.push({ id, cost: 0 }, 0); }
    while (queue.size) {
      const current = queue.pop()!;
      if (current.cost !== distance.get(current.id)) continue;
      for (const step of this.incoming.get(current.id) ?? []) {
        const cost = current.cost + this.stepSeconds(step, costs);
        if (cost >= (distance.get(step.from) ?? Infinity)) continue;
        distance.set(step.from, cost); next.set(step.from, step);
        queue.push({ id: step.from, cost }, cost);
      }
    }
    return next;
  }

  routeFromPotential(start: string, next: ReadonlyMap<string, StadiumRouteStep>, costs: StadiumRouteCosts): StadiumRoute | null {
    const steps: StadiumRouteStep[] = [], seen = new Set<string>();
    let at = start;
    while (next.has(at)) {
      if (seen.has(at)) throw new Error("Cyclic route potential");
      seen.add(at); const step = next.get(at)!; steps.push(step); at = step.to;
    }
    const gateId = Object.keys(this.network.gateNodes).find(id => this.network.gateNodes[id] === at);
    if (!gateId) return null;
    return { sectionId: start, gateId, steps,
      assumedWalkMeters: steps.reduce((sum, step) => sum + (this.edges.get(step.edgeId)!.transfer ? 0 : this.edges.get(step.edgeId)!.physicalPath.length), 0),
      transferSeconds: steps.reduce((sum, step) => sum + (this.edges.get(step.edgeId)!.transfer ? this.edgeSeconds(this.edges.get(step.edgeId)!, costs.speed) : 0), 0),
      freeFlowSeconds: this.routeSeconds(steps, { speed: costs.speed }), estimatedSeconds: this.routeSeconds(steps, costs) };
  }

  /** Dijkstra: explicit positive transfer costs; drawing intersections never create neighbors. */
  route(sectionId: string, gateId = "any", context?: StadiumRoutingContext): StadiumRoute | null {
    const start = this.network.sectionNodes[sectionId];
    if (!start) throw new Error("Unknown stadium section");
    const route = this.routeFromNode(start, gateId, context);
    return route ? { ...route, sectionId } : null;
  }

  /** Replan at a real node after a closure; never relocate an in-flight spectator. */
  routeFromNode(start: string, gateId = "any", context?: StadiumRoutingContext): StadiumRoute | null {
    this.speed(context);
    if (!this.nodes.has(start)) throw new Error("Unknown stadium node");
    if (gateId !== "any" && !this.network.gateNodes[gateId]) throw new Error("Unknown stadium gate group");
    const targets = new Set(gateId === "any" ? Object.values(this.network.gateNodes) : [this.network.gateNodes[gateId]]);
    const costs = new Map([[start, 0]]), previous = new Map<string, StadiumRouteStep>();
    const queue = new PriorityQueue<{ id: string; cost: number }>();
    queue.push({ id: start, cost: 0 }, 0);
    let end: string | undefined;
    while (queue.size) {
      const current = queue.pop()!;
      if (current.cost !== costs.get(current.id)) continue;
      if (targets.has(current.id)) { end = current.id; break; }
      for (const step of this.outgoing.get(current.id) ?? []) {
        if (this.closed.has(step.edgeId)) continue;
        const cost = current.cost + this.edgeSeconds(this.edges.get(step.edgeId)!, context);
        if (cost >= (costs.get(step.to) ?? Infinity)) continue;
        costs.set(step.to, cost); previous.set(step.to, step);
        queue.push({ id: step.to, cost }, cost);
      }
    }
    if (!end) return null;
    const steps: StadiumRouteStep[] = [];
    for (let at = end; at !== start;) {
      const step = previous.get(at)!;
      steps.push(step); at = step.from;
    }
    steps.reverse();
    let assumedWalkMeters = 0, transferSeconds = 0;
    for (const step of steps) {
      const edge = this.edges.get(step.edgeId)!;
      if (edge.transfer) transferSeconds += this.edgeSeconds(edge, context);
      else assumedWalkMeters += edge.physicalPath.length;
    }
    return { sectionId: start, gateId: Object.keys(this.network.gateNodes).find(id => this.network.gateNodes[id] === end)!,
      steps, assumedWalkMeters, transferSeconds, freeFlowSeconds: costs.get(end)!, estimatedSeconds: costs.get(end)! };
  }

  /** Reverse reachability checks every section against all currently open exterior gates. */
  connectivity(): { reachable: string[]; disconnected: string[] } {
    const queue = Object.values(this.network.gateNodes), seen = new Set(queue);
    for (let i = 0; i < queue.length; i++) {
      for (const step of this.incoming.get(queue[i]) ?? []) {
        if (this.closed.has(step.edgeId) || seen.has(step.from)) continue;
        seen.add(step.from); queue.push(step.from);
      }
    }
    const reachable: string[] = [], disconnected: string[] = [];
    for (const [section, node] of Object.entries(this.network.sectionNodes)) (seen.has(node) ? reachable : disconnected).push(section);
    return { reachable, disconnected };
  }
}
