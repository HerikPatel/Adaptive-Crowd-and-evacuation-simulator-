import { PriorityQueue } from "./PriorityQueue";
import { STADIUM_ASSUMPTIONS, createStadiumNetwork, drawingLength, validateStadiumNetwork,
  type NavigationEdge, type StadiumNetwork, type TransferParameters } from "../maps/stadiumNavigation";

export interface StadiumRouteStep { edgeId: string; from: string; to: string }
export interface StadiumRoute {
  sectionId: string;
  gateId: string;
  steps: StadiumRouteStep[];
  assumedWalkMeters: number;
  transferSeconds: number;
  freeFlowSeconds: number;
}

/** Surface-aware routes shared by inspection and the crowd simulation. */
export class StadiumRouter {
  revision = 0;
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
    this.revision++;
  }
  reset() {
    if (!this.closed.size && !this.overrides.size) return;
    this.closed.clear(); this.overrides.clear(); this.revision++;
  }

  edgeSeconds(edge: NavigationEdge): number {
    const transfer = this.parameters(edge.id);
    return transfer ? transfer.travelSeconds : drawingLength(edge.points) * STADIUM_ASSUMPTIONS.metersPerUnit / STADIUM_ASSUMPTIONS.walkingSpeedMetersPerSecond;
  }

  /** Dijkstra: explicit positive transfer costs; drawing intersections never create neighbors. */
  route(sectionId: string, gateId = "any"): StadiumRoute | null {
    const start = this.network.sectionNodes[sectionId];
    if (!start) throw new Error("Unknown stadium section");
    const route = this.routeFromNode(start, gateId);
    return route ? { ...route, sectionId } : null;
  }

  /** Replan at a real node after a closure; never relocate an in-flight spectator. */
  routeFromNode(start: string, gateId = "any"): StadiumRoute | null {
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
        const cost = current.cost + this.edgeSeconds(this.edges.get(step.edgeId)!);
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
      if (edge.transfer) transferSeconds += this.edgeSeconds(edge);
      else assumedWalkMeters += drawingLength(edge.points) * STADIUM_ASSUMPTIONS.metersPerUnit;
    }
    return { sectionId: start, gateId: Object.keys(this.network.gateNodes).find(id => this.network.gateNodes[id] === end)!,
      steps, assumedWalkMeters, transferSeconds, freeFlowSeconds: costs.get(end)! };
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
