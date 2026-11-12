import { STADIUM, STADIUM_SURFACES, type Point, type SurfaceId } from "../maps/stadium";
import { drawingLength, STADIUM_ASSUMPTIONS } from "../maps/stadiumNavigation";
import { StadiumRouter, type StadiumRoute, type StadiumRouteStep } from "../pathfinding/StadiumRouter";
import { seededRandom } from "../utils/math";
import { bodyRadius, createProfile, validateProfile, walkingSpeed, type CrowdProfile, type PersonProfile } from "./PersonProfile";
import { DiscReservations } from "../collision/DiscReservations";

export const STADIUM_STEP = 1 / 30;
const SCALE = STADIUM_ASSUMPTIONS.metersPerUnit;
const HEADWAY = 1.1; // Clearance through turns; never compress a body to fit a short edge.
const EPS = 1e-8;

type Stationary = { kind: "seated"; nodeId: string } | { kind: "node"; nodeId: string };
type Approach = { kind: "approaching"; nodeId: string; distance: number; length: number };
export type StadiumTravel = ({ kind: "walking" } | { kind: "transfer" }) & { step: StadiumRouteStep;
  distance: number; duration: number; enteredAt: number };
export type SpectatorState = Stationary | Approach | StadiumTravel |
  { kind: "evacuated"; gateId: string; at: number };
export interface StadiumSpectator {
  id: number;
  sectionId: string;
  seat: Point;
  profile: PersonProfile;
  state: SpectatorState;
  stranded: boolean;
  waiting: boolean;
}
export interface StadiumRunOptions { count: number; sections?: string[]; seed?: number; profileMode?: CrowdProfile }
export interface StadiumEvent { personId: number; edgeId: string; kind: "enter" | "leave" | "evacuate"; time: number }

function inside(p: Point, polygon: Point[]): boolean {
  let result = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) result = !result;
  }
  return result;
}

/** Spaced schematic seats. These are model spawn slots, not SHI seating counts. */
function seats(polygon: Point[]): Point[] {
  const result: Point[] = [];
  const minX = Math.min(...polygon.map(p => p.x)), maxX = Math.max(...polygon.map(p => p.x));
  const minY = Math.min(...polygon.map(p => p.y)), maxY = Math.max(...polygon.map(p => p.y));
  for (let y = minY + 4; y < maxY - 3; y += 4)
    for (let x = minX + 4; x < maxX - 3; x += 4)
      if ([{ x, y }, { x: x - 3, y }, { x: x + 3, y }, { x, y: y - 3 }, { x, y: y + 3 }].every(p => inside(p, polygon)))
        result.push({ x, y });
  return result;
}

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
  private options: StadiumRunOptions = { count: 100 };
  private slots: Map<string, Point[]>;
  private bodies = new DiscReservations();
  private regions = new Map<string, string>();
  private regionPoints = new Map<string, Point[]>();
  private releaseOrder: StadiumSpectator[] = [];
  collisionWaits = 0;
  private owners = new Map<string, number>();
  private lastAdmission = new Map<string, number>();
  private routeCache = new Map<string, StadiumRoute | null>();
  private revision = -1;
  private lengths: Map<string, number>;

  constructor(readonly router = new StadiumRouter(), options: StadiumRunOptions = { count: 100 }) {
    this.lengths = new Map(router.network.edges.map(e => [e.id, drawingLength(e.points) * SCALE]));
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
    this.slots = new Map(STADIUM.sections.map(section => {
      const aisle = router.edges.get(`${section.id}-aisle`)!;
      const a = aisle.points[0], b = aisle.points.at(-1)!;
      const dx = b.x - a.x, dy = b.y - a.y, length2 = dx * dx + dy * dy;
      const circulation = router.network.edges.filter(edge => !edge.transfer && edge.kind !== "aisle" &&
        router.nodes.get(edge.from)!.surfaceId === section.surfaceId).flatMap(edge => edge.points.slice(1).map((end, i) => ({ start: edge.points[i], end })));
      return [section.id, seats(section.polygon).filter(p => {
        const t = length2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2)) : 0;
        // Leave room for people entering and leaving the section aisle.
        return Math.hypot(p.x - a.x, p.y - a.y) * SCALE >= 1 &&
          Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t) * SCALE >= 0.75 &&
          circulation.every(({ start, end }) => {
            const vx = end.x - start.x, vy = end.y - start.y, d2 = vx * vx + vy * vy;
            const u = d2 ? Math.max(0, Math.min(1, ((p.x - start.x) * vx + (p.y - start.y) * vy) / d2)) : 0;
            return Math.hypot(p.x - start.x - vx * u, p.y - start.y - vy * u) * SCALE >= 1.2;
          });
      })];
    }));
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
      const sectionId = sections[i % sections.length], seat = available.get(sectionId)!.pop();
      if (!seat) continue;
      people.push({ id: people.length, sectionId, seat: { ...seat },
        profile: createProfile(options.seed ?? 549, people.length, profileMode),
        state: { kind: "seated", nodeId: this.router.network.sectionNodes[sectionId] }, stranded: false, waiting: true });
    }
    // Validation and preparation happen before changing a live run.
    this.options = { count: options.count, sections, seed: options.seed ?? 549, profileMode };
    this.spectators = people; this.time = 0; this.running = false; this.events = [];
    this.owners.clear(); this.lastAdmission.clear(); this.routeCache.clear(); this.revision = -1;
    this.collisionWaits = 0;
    this.releaseOrder = [...people].sort((a, b) => {
      const distance = (p: StadiumSpectator) => {
        const node = this.router.nodes.get(this.router.network.sectionNodes[p.sectionId])!.point;
        return Math.hypot(p.seat.x - node.x, p.seat.y - node.y);
      };
      return distance(a) - distance(b) || a.id - b.id;
    });
    this.rebuildBodies();
    this.refreshRoutes();
  }

  get complete() { return this.spectators.every(p => p.state.kind === "evacuated"); }
  get blocked() { return !this.complete && this.spectators.every(p => p.state.kind === "evacuated" || p.stranded); }
  start() { this.refreshRoutes(); this.running = !this.complete && !this.blocked; }
  pause() { this.running = false; }

  setProfile(id: number, profile: PersonProfile) {
    if (this.running || this.time > 0) throw new Error("Reset the crowd before editing a person's profile.");
    validateProfile(profile);
    const p = this.spectators.find(person => person.id === id);
    if (!p) throw new Error("Unknown spectator.");
    p.profile = { ...profile }; this.rebuildBodies();
  }

  private zone(p: StadiumSpectator) {
    return p.state.kind === "transfer" ? `transfer:${p.state.step.edgeId}` : this.surfaceOf(p)!;
  }
  private meters(p: Point): Point { return { x: p.x * SCALE, y: p.y * SCALE }; }
  private reserveBody(p: StadiumSpectator) {
    if (p.state.kind === "evacuated") this.bodies.remove(p.id);
    else this.bodies.set(p.id, this.zone(p), this.meters(this.position(p)), bodyRadius(p.profile));
  }
  private rebuildBodies() { this.bodies.clear(); for (const p of this.spectators) this.reserveBody(p); }
  private moveWithClearance(p: StadiumSpectator, target: number): number {
    const s = p.state;
    if (s.kind !== "walking" && s.kind !== "transfer" && s.kind !== "approaching") return 0;
    const original = s.distance;
    // Split at fine arc-distance intervals so curved polylines cannot tunnel past a body.
    let allowed = original;
    while (allowed < target - EPS) {
      s.distance = allowed; const from = this.meters(this.position(p));
      const next = Math.min(target, allowed + 0.08);
      s.distance = next; const to = this.meters(this.position(p));
      const fraction = this.bodies.fraction(p.id, this.zone(p), from, to, bodyRadius(p.profile));
      allowed += (next - allowed) * fraction;
      if (fraction < 1) { this.collisionWaits++; break; }
    }
    s.distance = original; return allowed;
  }

  refreshRoutes() {
    if (this.revision === this.router.revision) return;
    this.revision = this.router.revision; this.routeCache.clear();
    for (const p of this.spectators) {
      p.stranded = (p.state.kind === "node" || p.state.kind === "seated") && !this.route(p.state.nodeId);
    }
  }

  private route(nodeId: string) {
    if (!this.routeCache.has(nodeId)) this.routeCache.set(nodeId, this.router.routeFromNode(nodeId));
    return this.routeCache.get(nodeId)!;
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
    const at = this.position(p);
    return this.regionPoints.get(this.regions.get(nodeId)!)!.every(point =>
      Math.hypot(point.x - at.x, point.y - at.y) * SCALE >= HEADWAY - EPS);
  }
  private gap(edgeId: string) { return this.router.edges.get(edgeId)!.transfer ? 1.6 : HEADWAY; }

  /** Called with a fixed timestep by the UI, including during accelerated playback. */
  update(dt: number) {
    if (!Number.isFinite(dt) || dt <= 0 || dt > 0.1) throw new Error("Use a positive timestep of at most 0.1 seconds.");
    if (!this.running) return;
    this.refreshRoutes(); this.time += dt; this.rebuildBodies();
    for (const p of this.spectators) p.waiting = p.state.kind === "seated" || p.state.kind === "node";

    // Move leaders before followers, with separate directed lanes on wide walking edges.
    const travelers = this.spectators.filter(p => p.state.kind === "walking" || p.state.kind === "transfer");
    travelers.sort((a, b) => (b.state as StadiumTravel).distance - (a.state as StadiumTravel).distance || a.id - b.id);
    const fronts = new Map<string, number>();
    for (const p of travelers) {
      const s = p.state as StadiumTravel, edge = this.router.edges.get(s.step.edgeId)!;
      const length = this.lengths.get(edge.id)!, gap = this.gap(edge.id);
      const key = `${edge.id}:${s.step.from}`;
      const speed = s.kind === "transfer" ? length / s.duration : walkingSpeed(p.profile);
      let target = Math.min(length, s.distance + speed * dt, (fronts.get(key) ?? Infinity) - gap);
      // Only the leading arrival enters the node's clearance area. Other lanes wait upstream.
      if (target >= length - gap - EPS && !this.claim(s.step.to, p.id)) target = Math.min(target, Math.max(0, length - gap));
      target = Math.max(s.distance, target);
      target = this.moveWithClearance(p, target);
      p.waiting = target <= s.distance + EPS;
      s.distance = target;
      if (!this.sameRegion(s.step.from, s.step.to) && this.clearedRegion(s.step.from, p)) this.release(s.step.from, p.id);
      if (s.distance >= length - EPS && this.claim(s.step.to, p.id) &&
          (s.kind !== "transfer" || this.bodies.fits(p.id, this.router.nodes.get(s.step.to)!.surfaceId,
            this.meters(this.router.nodes.get(s.step.to)!.point), bodyRadius(p.profile))) &&
          (s.kind !== "transfer" || this.time - s.enteredAt + EPS >= s.duration)) {
        if (!this.sameRegion(s.step.from, s.step.to)) this.release(s.step.from, p.id);
        if (s.kind === "transfer") this.events.push({ personId: p.id, edgeId: edge.id, kind: "leave", time: this.time });
        if (edge.kind === "gate") {
          const gateId = Object.keys(this.router.network.gateNodes).find(id => this.router.network.gateNodes[id] === s.step.to)!;
          p.state = { kind: "evacuated", gateId, at: this.time };
          this.release(s.step.to, p.id);
          this.events.push({ personId: p.id, edgeId: edge.id, kind: "evacuate", time: this.time });
        } else p.state = { kind: "node", nodeId: s.step.to };
      } else fronts.set(key, s.distance);
      this.reserveBody(p);
    }
    for (const p of this.spectators) if (p.state.kind === "approaching") {
      const s = p.state;
      const before = s.distance;
      s.distance = this.moveWithClearance(p, Math.min(s.length, s.distance + walkingSpeed(p.profile) * dt));
      p.waiting = s.distance <= before + EPS;
      if (s.distance >= s.length - EPS) p.state = { kind: "node", nodeId: s.nodeId };
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
      const route = this.route(s.nodeId);
      p.stranded = !route;
      if (!route) continue;
      if (s.kind === "seated") {
        if (this.time < p.profile.reactionSeconds) continue;
        const owner = this.owners.get(this.regions.get(s.nodeId)!);
        if (owner !== undefined && owner !== p.id) continue;
        const at = this.router.nodes.get(s.nodeId)!.point;
        if (this.bodies.fraction(p.id, this.zone(p), this.meters(p.seat), this.meters(at), bodyRadius(p.profile)) < 1 ||
            !this.bodies.fits(p.id, this.zone(p), this.meters(at), bodyRadius(p.profile))) continue;
        if (!this.claim(s.nodeId, p.id)) continue;
        p.state = { kind: "approaching", nodeId: s.nodeId, distance: 0,
          length: Math.hypot(at.x - p.seat.x, at.y - p.seat.y) * SCALE };
        p.waiting = false; continue;
      }
      const step = route.steps[0];
      if (!step) continue;
      const edge = this.router.edges.get(step.edgeId)!, occupants = occupancy.get(edge.id) ?? [];
      const sameLane = occupants.filter(other => other.step.from === step.from);
      if (sameLane.some(other => other.distance < this.gap(edge.id) - EPS)) continue;
      if ((edge.widthMeters ?? 0) < 1.4 && occupants.some(other => other.step.from !== step.from)) continue;
      const transfer = this.router.parameters(edge.id);
      if (transfer && !this.bodies.fits(p.id, `transfer:${edge.id}`, this.meters(this.router.nodes.get(step.from)!.point), bodyRadius(p.profile))) continue;
      if (transfer && (this.time - (this.lastAdmission.get(edge.id) ?? -Infinity) + EPS < 1 / transfer.capacityPerSecond ||
          occupants.length >= Math.max(1, Math.ceil(transfer.capacityPerSecond * transfer.travelSeconds)))) continue;
      const travel: StadiumTravel = { kind: transfer ? "transfer" : "walking", step,
        distance: 0, duration: transfer ? transfer.travelSeconds * Math.max(1, 1.2 / walkingSpeed(p.profile)) : 0, enteredAt: this.time };
      p.state = travel; p.waiting = false;
      occupants.push(travel); occupancy.set(edge.id, occupants);
      this.reserveBody(p);
      if (transfer) {
        this.lastAdmission.set(edge.id, this.time);
        this.events.push({ personId: p.id, edgeId: edge.id, kind: "enter", time: this.time });
      }
    }
    if (this.complete || this.blocked) this.pause();
  }

  surfaceOf(p: StadiumSpectator): SurfaceId | null {
    const s = p.state;
    if (s.kind === "evacuated") return "exterior";
    if (s.kind === "transfer") return null;
    return this.router.nodes.get(s.kind === "walking" ? s.step.from : s.nodeId)!.surfaceId;
  }

  position(p: StadiumSpectator): Point {
    const s = p.state;
    if (s.kind === "seated") return p.seat;
    if (s.kind === "node") return this.router.nodes.get(s.nodeId)!.point;
    if (s.kind === "evacuated") return this.router.nodes.get(this.router.network.gateNodes[s.gateId])!.point;
    if (s.kind === "approaching") {
      const to = this.router.nodes.get(s.nodeId)!.point, t = s.length ? s.distance / s.length : 1;
      return { x: p.seat.x + (to.x - p.seat.x) * t, y: p.seat.y + (to.y - p.seat.y) * t };
    }
    const edge = this.router.edges.get(s.step.edgeId)!, length = this.lengths.get(edge.id)!;
    const points = s.step.from === edge.from ? edge.points : [...edge.points].reverse();
    let remaining = s.distance / SCALE;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i], segment = Math.hypot(b.x - a.x, b.y - a.y);
      if (remaining <= segment || i === points.length - 1) {
        const t = segment ? Math.min(1, remaining / segment) : 1;
        // Opposite directions use different sides, tapering into each reserved junction.
        const offset = edge.direction === "both" && !this.sameRegion(edge.from, edge.to) && (edge.widthMeters ?? 0) >= 1.4
          ? Math.min(1, s.distance / HEADWAY, (length - s.distance) / HEADWAY) * 0.4 / SCALE : 0;
        return { x: a.x + (b.x - a.x) * t - (segment ? (b.y - a.y) / segment * offset : 0),
          y: a.y + (b.y - a.y) * t + (segment ? (b.x - a.x) / segment * offset : 0) };
      }
      remaining -= segment;
    }
    return points[points.length - 1];
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
          const next = this.route(s.nodeId)?.steps[0];
          if (next && transfers[next.edgeId]) transfers[next.edgeId].waiting++;
        }
      }
    }
    const speeds = this.spectators.map(p => walkingSpeed(p.profile));
    return { population: this.spectators.length, time: this.time, evacuated, inTransfer, waiting, stranded,
      collisionWaits: this.collisionWaits, minSpeed: Math.min(...speeds), maxSpeed: Math.max(...speeds), meanSpeed: speeds.reduce((a, b) => a + b, 0) / speeds.length,
      onSurface: this.spectators.length - evacuated - inTransfer, surfaces, exits, transfers,
      averageEvacuationSeconds: evacuated ? totalEvacuationSeconds / evacuated : null };
  }
}
