import { STADIUM, STADIUM_SURFACES, type Point, type SurfaceId } from "../maps/stadium";
import { STADIUM_ASSUMPTIONS } from "../maps/stadiumNavigation";
import { StadiumRouter, type StadiumRoute, type StadiumRouteStep, type StadiumRoutingMode } from "../pathfinding/StadiumRouter";
import { StadiumTrafficRouter } from "../pathfinding/StadiumTrafficRouter";
import { seededRandom } from "../utils/math";
import { bodyRadius, createProfile, validateProfile, walkingSpeed, type CrowdProfile, type PersonProfile } from "./PersonProfile";
import { DiscReservations } from "../collision/DiscReservations";
import { StadiumCorridor } from "../collision/StadiumCorridor";
import { corridorsConflict } from "../collision/StadiumJunctions";
import { PHYSICAL_STADIUM_ASSUMPTIONS, STADIUM_PHYSICAL_SEATS, samplePhysicalPath, surfaceElevation,
  transferDuration, physicalToSvg, type PhysicalDirection, type PhysicalPoint, type PhysicalSeat } from "./StadiumPhysicalGeometry";
import { sourceToPhysical } from "./StadiumPhysicalGeometry";

export const STADIUM_STEP = 1 / 30;
const SCALE = 1;
const HEADWAY = 1.1; // Clearance through turns; never compress a body to fit a short edge.
const EPS = 1e-8;

type Stationary = { kind: "seated"; nodeId: string } | { kind: "node"; nodeId: string };
type Approach = { kind: "approaching"; nodeId: string; distance: number; length: number };
export type StadiumTravel = ({ kind: "walking" } | { kind: "transfer" }) & { step: StadiumRouteStep;
  distance: number; duration: number; enteredAt: number; lateral?: number };
export type SpectatorState = Stationary | Approach | StadiumTravel |
  { kind: "evacuated"; gateId: string; at: number };
export interface StadiumSpectator {
  id: number;
  sectionId: string;
  seat: Point;
  seatAssignment?: PhysicalSeat;
  profile: PersonProfile;
  state: SpectatorState;
  committedRoute?: StadiumRoute | null;
  routeProgress?: number;
  replacementReason?: string | null;
  pendingReplacementReason?: string | null;
  routeReplacedAt?: number | null;
  stranded: boolean;
  waiting: boolean;
  distanceTraveled?: number;
}
export interface StadiumRenderPerson {
  readonly id: number;
  readonly sectionId: string;
  readonly position: Readonly<PhysicalPoint>;
  readonly orientation: Readonly<PhysicalDirection>;
  readonly pathProgress: number;
  readonly bodyRadius: number;
  readonly height: number;
  readonly distanceTraveled: number;
  readonly surfaceId: SurfaceId | null;
  readonly movementState: SpectatorState["kind"];
  readonly waiting: boolean;
  readonly stranded: boolean;
  readonly rerouting: boolean;
  readonly targetGateId: string | null;
  readonly remainingRoute: readonly StadiumRouteStep[];
  readonly transferProgress: number | null;
  readonly transferEdgeId: string | null;
  readonly evacuatedAt: number | null;
}
export interface StadiumRenderFrame {
  readonly time: number;
  readonly running: boolean;
  readonly hasStarted: boolean;
  readonly population: number;
  readonly evacuated: number;
  readonly waiting: number;
  readonly stranded: number;
  readonly people: readonly StadiumRenderPerson[];
}
export type StadiumMovement = "queue" | "passing";
export interface StadiumRunOptions { count: number; sections?: string[]; seed?: number; profileMode?: CrowdProfile; routingMode?: StadiumRoutingMode; movementMode?: StadiumMovement }
export interface StadiumEvent { personId: number; edgeId: string; kind: "enter" | "leave" | "evacuate"; time: number }

/** A deterministic lane/queue model on explicit surfaces, independent of the selected display layer.
 * Node reservations serialize merges. Transfers retain their admitted duration and obey entry rates;
 * occupied landings cause backpressure. Closing an edge prohibits NEW entries; in-flight people finish.
 * Swept body reservations prevent same-surface penetration while preserving the corridor paths.
 * Seat access is still schematic; this is not an unconstrained 2D crowd or measured stadium model.
 */
export class StadiumSimulation {
  spectators: StadiumSpectator[] = [];
  events: StadiumEvent[] = [];
  time = 0;
  running = false;
  hasStarted = false;
  private options: StadiumRunOptions = { count: 100 };
  private slots: Map<string, readonly PhysicalSeat[]>;
  private bodies = new DiscReservations();
  private regions = new Map<string, string>();
  private regionPoints = new Map<string, Point[]>();
  private releaseOrder: StadiumSpectator[] = [];
  collisionWaits = 0;
  waitingPersonSeconds = 0;
  peakWaiting = 0;
  navigation!: StadiumTrafficRouter;
  completedPasses = 0;
  passAttempts = 0;
  get movementMode() { return this.options.movementMode ?? "passing"; }
  private owners = new Map<string, number>();
  private lastAdmission = new Map<string, number>();
  private routeCache = new Map<string, StadiumRoute | null>();
  private revision = -1;
  private lengths: Map<string, number>;
  private corridors: Map<string, StadiumCorridor>;
  private crossingConflicts = new Map<string, Set<string>>();
  private passes = new Map<number, { otherId: number; returning: boolean; passed: boolean }>();
  private passOwners = new Map<string, number>();

  constructor(readonly router = new StadiumRouter(), options: StadiumRunOptions = { count: 100 }) {
    this.lengths = new Map(router.network.edges.map(e => [e.id, e.physicalPath.length]));
    this.corridors = new Map(router.network.edges.filter(e => !e.transfer && e.direction === "both").map(e => [e.id, new StadiumCorridor(e)]));
    const walks = router.network.edges.filter(e => !e.transfer && e.kind !== "gate");
    for (let i = 0; i < walks.length; i++) for (let j = i + 1; j < walks.length; j++) {
      if (router.nodes.get(walks[i].from)!.surfaceId !== router.nodes.get(walks[j].from)!.surfaceId || !corridorsConflict(walks[i], walks[j])) continue;
      for (const [a, b] of [[walks[i].id, walks[j].id], [walks[j].id, walks[i].id]]) {
        const conflicts = this.crossingConflicts.get(a) ?? new Set<string>(); conflicts.add(b); this.crossingConflicts.set(a, conflicts);
      }
    }
    // A short edge is part of one junction reservation, not a place to squeeze two bodies.
    for (const n of router.network.nodes) this.regions.set(n.id, n.id);
    const find = (id: string): string => {
      const parent = this.regions.get(id)!;
      if (parent === id) return id;
      const root = find(parent); this.regions.set(id, root); return root;
    };
    for (const edge of router.network.edges)
      if (!edge.transfer && edge.kind !== "gate" && this.lengths.get(edge.id)! < 2 * HEADWAY)
        this.regions.set(find(edge.to), find(edge.from));
    for (const n of router.network.nodes) this.regions.set(n.id, find(n.id));
    for (const n of router.network.nodes) {
      const id = this.regions.get(n.id)!, points = this.regionPoints.get(id) ?? [];
      points.push(n.point); this.regionPoints.set(id, points);
    }
    this.slots = STADIUM_PHYSICAL_SEATS;
    this.reset(options);
  }

  capacity(sectionIds = STADIUM.sections.map(s => s.id)): number {
    return Math.min(1000, [...new Set(sectionIds)].reduce((n, id) => n + (this.slots.get(id)?.length ?? 0), 0));
  }

  reset(options: StadiumRunOptions = this.options) {
    const sections = options.sections ? [...new Set(options.sections)] : STADIUM.sections.map(s => s.id);
    if (!sections.length || sections.some(id => !this.slots.has(id))) throw new Error("Choose valid seating sections.");
    if (!Number.isInteger(options.count) || options.count < 1 || options.count > this.capacity(sections))
      throw new Error(`Choose a whole-number crowd size from 1 to ${this.capacity(sections)} for these sections.`);
    if (!Number.isInteger(options.seed ?? 549)) throw new Error("Seed must be an integer.");
    const profileMode = options.profileMode ?? "mixed";
    if (profileMode !== "mixed" && profileMode !== "uniform") throw new Error("Choose a valid crowd profile.");
    const routingMode = options.routingMode ?? "free-flow";
    if (routingMode !== "free-flow" && routingMode !== "adaptive") throw new Error("Choose a valid routing strategy.");
    const movementMode = options.movementMode ?? "passing";
    if (movementMode !== "passing" && movementMode !== "queue") throw new Error("Choose a valid local movement mode.");
    const random = seededRandom(options.seed ?? 549);
    const available = new Map(sections.map(id => {
      const points = [...this.slots.get(id)!];
      for (let i = points.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [points[i], points[j]] = [points[j], points[i]];
      }
      return [id, points] as const;
    }));
    const people: StadiumSpectator[] = [];
    for (let i = 0; people.length < options.count; i++) {
      const sectionId = sections[i % sections.length], seatAssignment = available.get(sectionId)!.pop();
      if (!seatAssignment) continue;
      const seat = { x: seatAssignment.position.x, y: seatAssignment.position.z };
      people.push({ id: people.length, sectionId, seat, seatAssignment,
        profile: createProfile(options.seed ?? 549, people.length, profileMode),
        state: { kind: "seated", nodeId: this.router.network.sectionNodes[sectionId] },
        committedRoute: null, routeProgress: 0, replacementReason: null, pendingReplacementReason: null, routeReplacedAt: null,
        stranded: false, waiting: true, distanceTraveled: 0 });
    }
    // Validation and preparation happen before changing a live run.
    this.options = { count: options.count, sections, seed: options.seed ?? 549, profileMode, routingMode, movementMode };
    this.spectators = people; this.time = 0; this.running = false; this.hasStarted = false; this.events = [];
    this.owners.clear(); this.lastAdmission.clear(); this.routeCache.clear(); this.revision = -1;
    this.collisionWaits = 0; this.waitingPersonSeconds = 0; this.peakWaiting = 0;
    this.completedPasses = 0; this.passAttempts = 0;
    this.passes.clear(); this.passOwners.clear();
    this.navigation = new StadiumTrafficRouter(this.router, routingMode);
    this.releaseOrder = [...people].sort((a, b) => {
      const distance = (p: StadiumSpectator) => {
        const node = this.router.nodes.get(this.router.network.sectionNodes[p.sectionId])!.point;
        return p.seatAssignment?.accessPath.length ?? 0;
      };
      return distance(a) - distance(b) || a.id - b.id;
    });
    this.rebuildBodies();
    this.refreshRoutes();
  }

  get complete() { return this.spectators.every(p => p.state.kind === "evacuated"); }
  get blocked() { return !this.complete && this.spectators.every(p => p.state.kind === "evacuated" || p.stranded); }
  start() { this.refreshRoutes(); this.hasStarted = true; this.running = !this.complete && !this.blocked; }
  pause() { this.running = false; }

  setProfile(id: number, profile: PersonProfile) {
    if (this.running || this.time > 0) throw new Error("Reset the crowd before editing a person's profile.");
    validateProfile(profile);
    const p = this.spectators.find(person => person.id === id);
    if (!p) throw new Error("Unknown spectator.");
    if (p.state.kind !== "seated" && p.state.kind !== "node" && p.state.kind !== "approaching")
      throw new Error("Reset the crowd before editing a person's profile.");
    p.profile = { ...profile };
    p.committedRoute = null; p.routeProgress = 0; p.replacementReason = null; p.pendingReplacementReason = null; p.routeReplacedAt = null;
    p.stranded = false;
    this.navigation.invalidatePerson(id);
    this.rebuildBodies();
  }

  private zone(p: StadiumSpectator) {
    if (p.state.kind === "seated") return `seats:${this.surfaceOf(p)!}`;
    if (p.state.kind === "approaching") return `approach:${p.sectionId}`;
    return p.state.kind === "transfer" ? `transfer:${p.state.step.edgeId}` : this.surfaceOf(p)!;
  }
  private meters(p: Point): Point { return { x: p.x * SCALE, y: p.y * SCALE }; }
  private reserveBody(p: StadiumSpectator) {
    if (p.state.kind === "evacuated") this.bodies.remove(p.id);
    else this.bodies.set(p.id, this.zone(p), this.meters(this.physicalPosition(p)), bodyRadius(p.profile));
  }
  private rebuildBodies() { this.bodies.clear(); for (const p of this.spectators) this.reserveBody(p); }
  private moveWithClearance(p: StadiumSpectator, target: number, budget = Infinity): number {
    const s = p.state;
    if (s.kind !== "walking" && s.kind !== "transfer" && s.kind !== "approaching") return 0;
    const original = s.distance;
    // Split at fine arc-distance intervals so curved polylines cannot tunnel past a body.
    let allowed = original;
    while (allowed < target - EPS) {
      s.distance = allowed; const from = this.meters(this.physicalPosition(p));
      const next = Math.min(target, allowed + 0.08);
      s.distance = next; const to = this.meters(this.physicalPosition(p));
      const travel = Math.hypot(to.x - from.x, to.y - from.y);
      const fraction = Math.min(travel ? budget / travel : 1,
        this.bodies.fraction(p.id, this.zone(p), from, to, bodyRadius(p.profile)), 1);
      allowed += (next - allowed) * fraction;
      budget = Math.max(0, budget - travel * fraction);
      if (fraction < 1 || budget < EPS) { if (budget >= EPS) this.collisionWaits++; break; }
    }
    s.distance = original; return allowed;
  }

  refreshRoutes() {
    this.navigation.sample(this.spectators, this.time);
    if (this.revision === this.router.costRevision) return;
    const initial = this.revision < 0;
    this.revision = this.router.costRevision; this.routeCache.clear();
    for (const p of this.spectators) {
      if (p.state.kind === "evacuated") continue;
      if (!p.committedRoute) {
        if (this.navigation.mode === "adaptive" && (p.state.kind === "node" || p.state.kind === "seated" || p.state.kind === "approaching"))
          p.stranded = !this.navigation.choose(p, p.state.nodeId, this.time);
        if (!initial && this.hasStarted && p.stranded &&
            (p.state.kind === "node" || p.state.kind === "seated" || p.state.kind === "approaching"))
          this.planFromNode(p, p.state.nodeId, "Connectivity restored");
        continue;
      }
      const closed = p.committedRoute.steps.slice(p.routeProgress).find(step => this.router.isClosed(step.edgeId));
      if (!closed) { p.stranded = false; continue; }
      const edge = this.router.edges.get(closed.edgeId)!;
      const reason = `${edge.kind === "gate" ? "Gate" : "Connection"} closed: ${edge.name}`;
      if (p.state.kind === "walking" || p.state.kind === "transfer") {
        // An occupied exterior gate still completes the evacuation; other closures replan at arrival.
        if (!(p.state.kind === "walking" && p.state.step.edgeId === closed.edgeId && edge.kind === "gate"))
          p.pendingReplacementReason = reason;
        p.stranded = false;
      } else this.planFromNode(p, p.state.nodeId, reason);
    }
  }

  private route(nodeId: string, speed: number) {
    const key = `${nodeId}|${speed}|${this.router.revision}|${this.router.parameterRevision}`;
    if (!this.routeCache.has(key)) this.routeCache.set(key,
      this.router.routeFromNode(nodeId, "any", { walkingSpeedMetersPerSecond: speed }));
    return this.routeCache.get(key)!;
  }
  private planFromNode(p: StadiumSpectator, nodeId: string, reason: string | null) {
    const route = this.navigation.mode === "adaptive"
      ? this.navigation.choose(p, nodeId, this.time)
      : this.route(nodeId, walkingSpeed(p.profile));
    p.committedRoute = route; p.routeProgress = 0; p.pendingReplacementReason = null;
    p.stranded = !route;
    p.replacementReason = route ? reason : "Route disconnected";
    if (route && reason) p.routeReplacedAt = this.time;
    return route;
  }
  private nextStep(p: StadiumSpectator) {
    return p.committedRoute?.steps[p.routeProgress ?? 0];
  }
  private arriveAtNode(p: StadiumSpectator, nodeId: string) {
    p.state = { kind: "node", nodeId };
    if (p.pendingReplacementReason) this.planFromNode(p, nodeId, p.pendingReplacementReason);
    else if (!p.committedRoute) this.planFromNode(p, nodeId, null);
    else if (this.navigation.mode === "adaptive") this.planFromNode(p, nodeId, null);
    else p.routeProgress = (p.routeProgress ?? 0) + 1;
  }
  private claim(nodeId: string, personId: number): boolean {
    nodeId = this.regions.get(nodeId)!;
    const owner = this.owners.get(nodeId);
    if (owner !== undefined && owner !== personId) return false;
    this.owners.set(nodeId, personId); return true;
  }
  private release(nodeId: string, personId: number) {
    nodeId = this.regions.get(nodeId)!;
    if (this.owners.get(nodeId) === personId) this.owners.delete(nodeId);
  }
  private sameRegion(from: string, to: string) { return this.regions.get(from) === this.regions.get(to); }
  private clearedRegion(nodeId: string, p: StadiumSpectator) {
    const at = this.physicalPosition(p);
    return this.regionPoints.get(this.regions.get(nodeId)!)!.every(point =>
      Math.hypot(point.x - at.x, point.y - at.y) * SCALE >= HEADWAY - EPS);
  }
  private gap(edgeId: string) { return this.router.edges.get(edgeId)!.transfer ? 1.6 : HEADWAY; }

  private passingCorridor(p: StadiumSpectator): StadiumCorridor | undefined {
    const s = p.state;
    if (this.movementMode !== "passing" || s.kind !== "walking" || this.sameRegion(s.step.from, s.step.to)) return;
    const corridor = this.corridors.get(s.step.edgeId);
    return corridor?.supportsPassing(bodyRadius(p.profile)) ? corridor : undefined;
  }

  private changeLane(p: StadiumSpectator, neighbors: StadiumSpectator[], dt: number): number {
    const corridor = this.passingCorridor(p);
    if (!corridor) return 0;
    const s = p.state as StadiumTravel, speed = walkingSpeed(p.profile), key = `${s.step.edgeId}:${s.step.from}`;
    let pass = this.passes.get(p.id);
    if (!pass && !this.passOwners.has(key) && s.distance >= 2 * HEADWAY) {
      const leader = neighbors.filter(other => other !== p && other.state.kind === "walking" && other.state.step.from === s.step.from &&
        other.state.distance > s.distance && (other.state.lateral ?? 0) < 0.1).sort((a, b) => (a.state as StadiumTravel).distance - (b.state as StadiumTravel).distance)[0];
      if (leader) {
        const gap = (leader.state as StadiumTravel).distance - s.distance, advantage = speed - walkingSpeed(leader.profile);
        const maneuverSeconds = (gap + HEADWAY) / Math.max(0.01, advantage) + 2 * 0.8 / Math.min(0.65, speed / 2);
        if (advantage >= 0.15 && gap <= 3.5 && this.lengths.get(s.step.edgeId)! - s.distance > speed * maneuverSeconds + 2 * HEADWAY) {
          pass = { otherId: leader.id, returning: false, passed: false };
          this.passes.set(p.id, pass); this.passOwners.set(key, p.id); this.passAttempts++;
        }
      }
    }
    if (!pass) return 0;
    const other = this.spectators[pass.otherId];
    const otherHere = other.state.kind === "walking" && other.state.step.edgeId === s.step.edgeId && other.state.step.from === s.step.from;
    if (otherHere && s.distance >= (other.state as StadiumTravel).distance + HEADWAY) { pass.passed = true; pass.returning = true; }
    if (!otherHere || this.lengths.get(s.step.edgeId)! - s.distance < 4 * HEADWAY) pass.returning = true;
    const before = this.physicalPosition(p), old = s.lateral ?? 0, goal = pass.returning ? 0 : 0.8;
    const step = Math.sign(goal - old) * Math.min(Math.abs(goal - old), Math.min(0.65, speed / 2) * dt);
    s.lateral = old + step;
    const after = this.physicalPosition(p);
    s.lateral = old + step * this.bodies.fraction(p.id, this.zone(p), before, after, bodyRadius(p.profile));
    const at = this.physicalPosition(p); this.reserveBody(p);
    if (pass.returning && s.lateral < EPS) {
      s.lateral = 0; this.passes.delete(p.id); this.passOwners.delete(key);
      if (pass.passed) this.completedPasses++;
    }
    return Math.hypot(at.x - before.x, at.y - before.y);
  }

  /** Called with a fixed timestep by the UI, including during accelerated playback. */
  update(dt: number) {
    if (!Number.isFinite(dt) || dt <= 0 || dt > 0.1) throw new Error("Use a positive timestep of at most 0.1 seconds.");
    if (!this.running) return;
    this.refreshRoutes(); this.time += dt; this.rebuildBodies();
    for (const p of this.spectators) p.waiting = p.state.kind === "seated" || p.state.kind === "node";

    // Move leaders before followers, with separate directed lanes on wide walking edges.
    const travelers = this.spectators.filter(p => p.state.kind === "walking" || p.state.kind === "transfer");
    const byEdge = new Map<string, StadiumSpectator[]>();
    for (const p of travelers) { const id = (p.state as StadiumTravel).step.edgeId, group = byEdge.get(id) ?? []; group.push(p); byEdge.set(id, group); }
    travelers.sort((a, b) => (b.state as StadiumTravel).distance - (a.state as StadiumTravel).distance || a.id - b.id);
    const fronts = new Map<string, number>();
    for (const p of travelers) {
      const s = p.state as StadiumTravel, edge = this.router.edges.get(s.step.edgeId)!;
      const length = this.lengths.get(edge.id)!, gap = this.gap(edge.id);
      const lateralTravel = s.kind === "walking" ? this.changeLane(p, byEdge.get(edge.id)!, dt) : 0;
      const key = `${edge.id}:${s.step.from}:${(s.lateral ?? 0) >= 0.7 ? 1 : 0}`;
      const speed = s.kind === "transfer" ? length / s.duration : walkingSpeed(p.profile);
      const budget = Math.max(0, speed * dt - lateralTravel);
      let target = Math.min(length, s.distance + budget, (fronts.get(key) ?? Infinity) - gap);
      if ((s.lateral ?? 0) > EPS) target = Math.min(target, length - 2 * HEADWAY);
      // Only the leading arrival enters the node's clearance area. Other lanes wait upstream.
      if (target >= length - gap - EPS && !this.claim(s.step.to, p.id)) target = Math.min(target, Math.max(0, length - gap));
      target = Math.max(s.distance, target);
      target = this.moveWithClearance(p, target, this.movementMode === "passing" && s.kind === "walking" ? budget : Infinity);
      p.waiting = target <= s.distance + EPS && lateralTravel < EPS;
      p.distanceTraveled = (p.distanceTraveled ?? 0) + Math.max(0, target - s.distance);
      s.distance = target;
      if (!this.sameRegion(s.step.from, s.step.to) && this.clearedRegion(s.step.from, p)) this.release(s.step.from, p.id);
      if (s.distance >= length - EPS && this.claim(s.step.to, p.id) &&
          (s.kind !== "transfer" || this.time - s.enteredAt + EPS >= s.duration)) {
        if (!this.sameRegion(s.step.from, s.step.to)) this.release(s.step.from, p.id);
        if (s.kind === "transfer") this.events.push({ personId: p.id, edgeId: edge.id, kind: "leave", time: this.time });
        if (edge.kind === "gate") {
          const gateId = Object.keys(this.router.network.gateNodes).find(id => this.router.network.gateNodes[id] === s.step.to)!;
          p.state = { kind: "evacuated", gateId, at: this.time };
          this.release(s.step.to, p.id);
          this.events.push({ personId: p.id, edgeId: edge.id, kind: "evacuate", time: this.time });
        } else this.arriveAtNode(p, s.step.to);
      } else fronts.set(key, s.distance);
      this.reserveBody(p);
    }
    const approaching = this.spectators.filter(p => p.state.kind === "approaching")
      .sort((a, b) => (b.state as Approach).distance - (a.state as Approach).distance || a.id - b.id);
    for (const p of approaching) {
      const s = p.state as Approach;
      const before = s.distance;
      let target = Math.min(s.length, s.distance + walkingSpeed(p.profile) * dt);
      if (target >= s.length - HEADWAY - EPS && !this.claim(s.nodeId, p.id)) target = Math.min(target, Math.max(0, s.length - HEADWAY));
      s.distance = this.moveWithClearance(p, target);
      p.distanceTraveled = (p.distanceTraveled ?? 0) + Math.max(0, s.distance - before);
      p.waiting = s.distance <= before + EPS;
      const destination = this.router.nodes.get(s.nodeId)!;
      if (s.distance >= s.length - EPS && this.claim(s.nodeId, p.id))
        p.state = { kind: "node", nodeId: s.nodeId };
      this.reserveBody(p);
    }

    const occupancy = new Map<string, StadiumTravel[]>();
    for (const p of this.spectators) if (p.state.kind === "walking" || p.state.kind === "transfer") {
      const list = occupancy.get(p.state.step.edgeId) ?? [];
      list.push(p.state); occupancy.set(p.state.step.edgeId, list);
    }
    for (const p of this.releaseOrder) {
      const s = p.state;
      if (s.kind !== "node" && s.kind !== "seated") continue;
      if (s.kind === "seated") {
        if (this.time < p.profile.reactionSeconds) continue;
        if (!p.committedRoute && !p.stranded) this.planFromNode(p, s.nodeId, null);
        if (!p.committedRoute) continue;
        // One active row-to-aisle merge per section side prevents crossing row paths
        // from interpenetrating while allowing the two side aisles to operate together.
        if (this.spectators.some(other => other.id !== p.id && other.sectionId === p.sectionId &&
            other.state.kind === "approaching" && other.seatAssignment?.side === p.seatAssignment?.side)) continue;
        p.state = { kind: "approaching", nodeId: s.nodeId, distance: 0,
          length: p.seatAssignment!.accessPath.length };
        p.waiting = false; continue;
      }
      if (!p.committedRoute) { p.stranded = true; continue; }
      const step = this.nextStep(p);
      if (!step) continue;
      if (this.router.isClosed(step.edgeId)) continue;
      const edge = this.router.edges.get(step.edgeId)!, occupants = occupancy.get(edge.id) ?? [];
      if ([...(this.crossingConflicts.get(edge.id) ?? [])].some(id => (occupancy.get(id)?.length ?? 0) > 0)) continue;
      const sameLane = occupants.filter(other => other.step.from === step.from);
      if (sameLane.some(other => other.distance < this.gap(edge.id) - EPS)) continue;
      if ((edge.widthMeters ?? 0) < 1.4 && occupants.some(other => other.step.from !== step.from)) continue;
      const transfer = this.router.parameters(edge.id);
      if (transfer && !this.bodies.fits(p.id, `transfer:${edge.id}`, this.meters(this.router.nodes.get(step.from)!.point), bodyRadius(p.profile))) continue;
      if (transfer && (this.time - (this.lastAdmission.get(edge.id) ?? -Infinity) + EPS < 1 / transfer.capacityPerSecond ||
          occupants.length >= Math.max(1, Math.ceil(transfer.capacityPerSecond * transfer.travelSeconds)))) continue;
      const travel: StadiumTravel = { kind: transfer ? "transfer" : "walking", step,
        distance: 0, duration: transfer ? transferDuration(edge.physicalPath.length, walkingSpeed(p.profile), transfer.travelSeconds) : 0,
        enteredAt: this.time };
      p.state = travel; p.waiting = false;
      if (this.navigation.mode === "adaptive") this.navigation.depart(p.id, step);
      occupants.push(travel); occupancy.set(edge.id, occupants);
      this.reserveBody(p);
      if (transfer) {
        this.lastAdmission.set(edge.id, this.time);
        this.events.push({ personId: p.id, edgeId: edge.id, kind: "enter", time: this.time });
      }
    }
    const waiting = this.spectators.filter(p => p.state.kind !== "evacuated" && !p.stranded && p.waiting && this.time >= p.profile.reactionSeconds).length;
    this.waitingPersonSeconds += waiting * dt; this.peakWaiting = Math.max(this.peakWaiting, waiting);
    if (this.complete || this.blocked) this.pause();
  }

  surfaceOf(p: StadiumSpectator): SurfaceId | null {
    const s = p.state;
    if (s.kind === "evacuated") return "exterior";
    if (s.kind === "transfer") return null;
    return this.router.nodes.get(s.kind === "walking" ? s.step.from : s.nodeId)!.surfaceId;
  }

  position(p: StadiumSpectator): Point {
    if (p.state.kind === "walking") {
      const edge = this.router.edges.get(p.state.step.edgeId)!, corridor = this.corridors.get(edge.id);
      if (corridor) {
        const distance = Math.min(corridor.length, p.state.distance);
        const taper = Math.min(1, distance / HEADWAY, (corridor.length - distance) / HEADWAY);
        const point = corridor.point(distance, p.state.step.from !== edge.from, taper * (0.4 + (p.state.lateral ?? 0)));
        return { x: point.x / PHYSICAL_STADIUM_ASSUMPTIONS.sourceMetersPerUnit,
          y: point.y / PHYSICAL_STADIUM_ASSUMPTIONS.sourceMetersPerUnit };
      }
    }
    const point = this.physicalSample(p).position;
    return physicalToSvg(point);
  }

  private physicalPosition(p: StadiumSpectator): Point {
    const point = this.physicalSample(p).position;
    return { x: point.x, y: point.z };
  }

  physicalSample(p: StadiumSpectator): { position: PhysicalPoint; direction: PhysicalDirection; progress: number } {
    const s = p.state;
    if (s.kind === "seated") return { position: p.seatAssignment?.position ?? { x: p.seat.x, y: 0, z: p.seat.y }, direction: { x: 0, y: 0, z: 1 }, progress: 0 };
    if (s.kind === "approaching") {
      const sample = samplePhysicalPath(p.seatAssignment!.accessPath, s.distance);
      return { position: sample.position, direction: sample.direction, progress: sample.progress };
    }
    if (s.kind === "evacuated") {
      const node = this.router.nodes.get(this.router.network.gateNodes[s.gateId])!;
      const position = sourceToPhysical(node.point);
      return { position: { ...position, y: surfaceElevation("exterior", { x: position.x, z: position.z }) },
        direction: { x: 0, y: 0, z: 1 }, progress: 1 };
    }
    if (s.kind === "node") {
      const node = this.router.nodes.get(s.nodeId)!;
      const position = sourceToPhysical(node.point);
      return { position: { ...position, y: surfaceElevation(node.surfaceId, { x: position.x, z: position.z }) },
        direction: { x: 0, y: 0, z: 1 }, progress: 1 };
    }
    const edge = this.router.edges.get(s.step.edgeId)!;
    const forward = s.step.from === edge.from;
    const sample = samplePhysicalPath(edge.physicalPath, forward ? s.distance : edge.physicalPath.length - s.distance);
    const direction = forward ? sample.direction : { x: -sample.direction.x, y: -sample.direction.y, z: -sample.direction.z };
    // Wide two-way walks use a deterministic keep-right lane. Without this
    // physical offset, opposite flows share a mathematical centerline and can
    // form an artificial face-to-face deadlock even though the corridor is
    // wide enough for both bodies.
    const laneOffset = s.kind === "walking" && edge.physicalPath.width >= 1.4
      ? Math.min(0.4, edge.physicalPath.width / 4) + (s.lateral ?? 0) : 0;
    const position = laneOffset ? {
      x: sample.position.x - direction.z * laneOffset,
      y: sample.position.y,
      z: sample.position.z + direction.x * laneOffset,
    } : sample.position;
    return { position, direction, progress: s.distance / edge.physicalPath.length };
  }

  snapshot() {
    const surfaces = Object.fromEntries(STADIUM_SURFACES.filter(s => s.id !== "exterior").map(s => [s.id, 0])) as Record<Exclude<SurfaceId, "exterior">, number>;
    const exits = Object.fromEntries(Object.keys(this.router.network.gateNodes).map(id => [id, 0]));
    const transfers = Object.fromEntries(this.router.controls.filter(e => e.transfer).map(e => [e.id, { waiting: 0, traveling: 0 }]));
    let evacuated = 0, inTransfer = 0, waiting = 0, stranded = 0, totalEvacuationSeconds = 0;
    for (const p of this.spectators) {
      const s = p.state, surface = this.surfaceOf(p);
      if (s.kind === "evacuated") { evacuated++; exits[s.gateId]++; totalEvacuationSeconds += s.at; }
      else {
        if (surface && surface !== "exterior") surfaces[surface]++;
        if (s.kind === "transfer") { inTransfer++; transfers[s.step.edgeId].traveling++; }
        if (p.stranded) stranded++;
        else if (p.waiting) waiting++;
        if (s.kind === "node") {
          const next = this.nextStep(p);
          if (next && transfers[next.edgeId]) transfers[next.edgeId].waiting++;
        }
      }
    }
    const speeds = this.spectators.map(p => walkingSpeed(p.profile));
    return { population: this.spectators.length, time: this.time, evacuated, inTransfer, waiting, stranded,
      routingMode: this.navigation.mode, movementMode: this.movementMode, completedPasses: this.completedPasses, passAttempts: this.passAttempts,
      routeSwitches: this.navigation.switches, forcedReroutes: this.navigation.forcedReroutes,
      routingSearches: this.navigation.searches, trafficSnapshots: this.navigation.snapshots,
      meanWaitingSeconds: this.waitingPersonSeconds / this.spectators.length, peakWaiting: this.peakWaiting,
      collisionWaits: this.collisionWaits, minSpeed: Math.min(...speeds), maxSpeed: Math.max(...speeds), meanSpeed: speeds.reduce((a, b) => a + b, 0) / speeds.length,
      onSurface: this.spectators.length - evacuated - inTransfer, surfaces, exits, transfers,
      averageEvacuationSeconds: evacuated ? totalEvacuationSeconds / evacuated : null };
  }

  /** Immutable presentation snapshot shared by the 2D and 3D renderers. */
  renderFrame(): StadiumRenderFrame {
    const snapshot = this.snapshot();
    const people = this.spectators.map<StadiumRenderPerson>(p => {
      const state = p.state;
      const transfer = state.kind === "transfer";
      const route = p.committedRoute;
      return Object.freeze({
        id: p.id,
        sectionId: p.sectionId,
        position: Object.freeze({ ...this.physicalSample(p).position }),
        orientation: Object.freeze({ ...this.physicalSample(p).direction }),
        pathProgress: this.physicalSample(p).progress,
        bodyRadius: bodyRadius(p.profile),
        height: p.profile.heightCm / 100,
        distanceTraveled: p.distanceTraveled ?? 0,
        surfaceId: this.surfaceOf(p),
        movementState: state.kind,
        waiting: p.waiting,
        stranded: p.stranded,
        rerouting: p.routeReplacedAt != null && this.time - p.routeReplacedAt <= 3 && state.kind !== "evacuated",
        targetGateId: state.kind === "evacuated" ? state.gateId : route?.gateId ?? null,
        remainingRoute: Object.freeze(route?.steps.slice(p.routeProgress ?? 0).map(step => Object.freeze({ ...step })) ?? []),
        transferProgress: transfer ? Math.max(0, Math.min(1, state.distance / this.lengths.get(state.step.edgeId)!)) : null,
        transferEdgeId: transfer ? state.step.edgeId : null,
        evacuatedAt: state.kind === "evacuated" ? state.at : null,
      });
    });
    return Object.freeze({ time: this.time, running: this.running, hasStarted: this.hasStarted,
      population: snapshot.population, evacuated: snapshot.evacuated, waiting: snapshot.waiting,
      stranded: snapshot.stranded, people: Object.freeze(people) });
  }
}
