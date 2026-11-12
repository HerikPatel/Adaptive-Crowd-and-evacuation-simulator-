import { STADIUM, STADIUM_SURFACES, type Point, type SurfaceId } from "./stadium";

/** Experimental inputs, not measurements of SHI Stadium. */
export const STADIUM_ASSUMPTIONS = {
  metersPerUnit: 0.2,
  walkingSpeedMetersPerSecond: 1.2,
  aisleWidthMeters: 1.2,
  walkwayWidthMeters: 2.4,
  concourseWidthMeters: 4.8,
  ramp: { travelSeconds: 30, capacityPerSecond: 2 },
  stairs: { travelSeconds: 12, capacityPerSecond: 1 },
  passage: { travelSeconds: 3, capacityPerSecond: 2 },
} as const;

export type EdgeKind = "aisle" | "walkway" | "concourse" | "approach" | "passage" | "ramp" | "stairs" | "gate";
export interface NavigationNode {
  id: string;
  surfaceId: SurfaceId;
  point: Point;
}
export interface TransferParameters { travelSeconds: number; capacityPerSecond: number }
export interface NavigationEdge {
  id: string;
  name: string;
  from: string;
  to: string;
  kind: EdgeKind;
  direction: "both" | "forward";
  points: Point[];
  widthMeters: number | null;
  /** Only explicit transfers and gates can change surface. */
  transfer: TransferParameters | null;
  /** The published marker or section associated with this assumed edge. */
  featureId?: string;
  evidence: "assumed";
}
export interface StadiumNetwork {
  nodes: NavigationNode[];
  edges: NavigationEdge[];
  sectionNodes: Record<string, string>;
  gateNodes: Record<string, string>;
}

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
export function drawingLength(points: readonly Point[]): number {
  return points.slice(1).reduce((sum, point, i) => sum + distance(points[i], point), 0);
}

// A stadium-shaped ring: two straight sidelines and semicircular ends.
function ringPoint(t: number, radius: number): Point {
  const length = 1000 + 2 * Math.PI * radius;
  t = ((t % length) + length) % length;
  if (t <= 500) return { x: 350 + t, y: 440 - radius };
  t -= 500;
  if (t <= Math.PI * radius) {
    const angle = -Math.PI / 2 + t / radius;
    return { x: 850 + radius * Math.cos(angle), y: 440 + radius * Math.sin(angle) };
  }
  t -= Math.PI * radius;
  if (t <= 500) return { x: 850 - t, y: 440 + radius };
  const angle = Math.PI / 2 + (t - 500) / radius;
  return { x: 350 + radius * Math.cos(angle), y: 440 + radius * Math.sin(angle) };
}

function projectToRing(p: Point, radius: number): number {
  const x = Math.max(350, Math.min(850, p.x));
  const right = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, Math.atan2(p.y - 440, p.x - 850)));
  let left = Math.atan2(p.y - 440, p.x - 350);
  if (left < 0) left += 2 * Math.PI;
  left = Math.max(Math.PI / 2, Math.min(3 * Math.PI / 2, left));
  const candidates = [x - 350, 500 + (right + Math.PI / 2) * radius,
    500 + Math.PI * radius + 850 - x, 1000 + Math.PI * radius + (left - Math.PI / 2) * radius];
  return candidates.sort((a, b) => distance(p, ringPoint(a, radius)) - distance(p, ringPoint(b, radius)))[0];
}

export function createStadiumNetwork(): StadiumNetwork {
  const nodes: NavigationNode[] = [], edges: NavigationEdge[] = [];
  const sectionNodes: Record<string, string> = {}, gateNodes: Record<string, string> = {};
  const node = (id: string, surfaceId: SurfaceId, point: Point): NavigationNode => {
    const n = { id, surfaceId, point: { ...point } };
    nodes.push(n);
    return n;
  };
  const walk = (id: string, from: NavigationNode, to: NavigationNode, kind: "aisle" | "walkway" | "concourse" | "approach", width: number, points = [from.point, to.point]) => {
    if (from.id === to.id) return;
    edges.push({ id, name: kind, from: from.id, to: to.id, kind, direction: "both", points,
      widthMeters: width, transfer: null, evidence: "assumed" });
  };
  const transfer = (id: string, name: string, from: NavigationNode, to: NavigationNode, kind: "passage" | "ramp" | "stairs", featureId: string, points = [from.point, to.point]) => {
    edges.push({ id, name, from: from.id, to: to.id, kind, direction: "forward", points,
      widthMeters: null, transfer: { ...STADIUM_ASSUMPTIONS[kind] }, featureId, evidence: "assumed" });
  };
  const ring = (surfaceId: SurfaceId, radius: number) => {
    const length = 1000 + 2 * Math.PI * radius;
    const anchors: { t: number; node: NavigationNode }[] = [];
    const at = (id: string, point: Point) => {
      let t = projectToRing(point, radius);
      if (Math.abs(t - length) < 1e-7) t = 0;
      const existing = anchors.find(a => Math.abs(a.t - t) < 1e-7);
      if (existing) return existing.node;
      const n = node(id, surfaceId, ringPoint(t, radius));
      anchors.push({ t, node: n });
      return n;
    };
    // Include the corners so a segment can never cut through the bowl.
    [0, 500, 500 + Math.PI * radius, 1000 + Math.PI * radius].forEach((t, i) => at(`${surfaceId}-corner-${i}`, ringPoint(t, radius)));
    return { at, finish: () => {
      anchors.sort((a, b) => a.t - b.t);
      anchors.forEach((a, i) => {
        const b = anchors[(i + 1) % anchors.length];
        const end = i === anchors.length - 1 ? b.t + length : b.t;
        const count = Math.max(1, Math.ceil((end - a.t) / 8));
        const points = Array.from({ length: count + 1 }, (_, j) => ringPoint(a.t + (end - a.t) * j / count, radius));
        walk(`${surfaceId}-ring-${i}`, a.node, b.node, surfaceId === "concourse" ? "concourse" : "walkway",
          surfaceId === "concourse" ? STADIUM_ASSUMPTIONS.concourseWidthMeters : STADIUM_ASSUMPTIONS.walkwayWidthMeters, points);
      });
    } };
  };
  const lower = ring("lower-bowl", 220), concourse = ring("concourse", 235);
  const upper = new Map<SurfaceId, NavigationNode[]>([["upper-east", []], ["upper-west", []]]);
  const upperY = (surface: SurfaceId) => surface === "upper-east" ? 155 : 715;

  for (const section of STADIUM.sections) {
    const start = node(section.id, section.surfaceId, section.at);
    sectionNodes[section.id] = start.id;
    if (section.surfaceId === "lower-bowl") {
      const opening = lower.at(`${section.id}-opening`, section.at);
      walk(`${section.id}-aisle`, start, opening, "aisle", STADIUM_ASSUMPTIONS.aisleWidthMeters);
      const destination = concourse.at(`${section.id}-concourse`, opening.point);
      transfer(`passage-${section.label}`, `Section ${section.label} bowl opening`, opening, destination, "passage", section.id);
    } else {
      const access = node(`${section.id}-access`, section.surfaceId, { x: section.at.x, y: upperY(section.surfaceId) });
      walk(`${section.id}-aisle`, start, access, "aisle", STADIUM_ASSUMPTIONS.aisleWidthMeters);
      upper.get(section.surfaceId)!.push(access);
    }
  }
  for (const connector of STADIUM.connectors) {
    const from = node(`${connector.id}-from`, connector.from.surfaceId, connector.from.point);
    const to = node(`${connector.id}-to`, connector.to.surfaceId, connector.to.point);
    if (from.surfaceId === "lower-bowl") {
      const access = lower.at(`${connector.id}-access`, from.point);
      walk(`${connector.id}-entry`, access, from, "approach", STADIUM_ASSUMPTIONS.walkwayWidthMeters);
    } else {
      upper.get(from.surfaceId)!.push(from);
    }
    const destination = concourse.at(`${connector.id}-concourse`, to.point);
    walk(`${connector.id}-landing`, to, destination, "approach", STADIUM_ASSUMPTIONS.walkwayWidthMeters);
    transfer(connector.id, connector.name, from, to, connector.connectorType, connector.id, [from.point, connector.at, to.point]);
  }
  for (const [surface, access] of upper) {
    access.sort((a, b) => a.point.x - b.point.x);
    for (let i = 1; i < access.length; i++) walk(`${surface}-walk-${i}`, access[i - 1], access[i], "walkway", STADIUM_ASSUMPTIONS.walkwayWidthMeters);
  }
  for (const gate of STADIUM.gates) {
    const access = concourse.at(`${gate.id}-access`, gate.approach);
    const approach = node(`${gate.id}-approach`, "concourse", gate.approach);
    walk(`${gate.id}-approach-walk`, access, approach, "approach", STADIUM_ASSUMPTIONS.walkwayWidthMeters);
    const outside = node(`${gate.id}-outside`, "exterior", gate.at);
    gateNodes[gate.id] = outside.id;
    edges.push({ id: gate.id, name: gate.name, from: approach.id, to: outside.id, kind: "gate", direction: "forward",
      points: [approach.point, outside.point], widthMeters: null, transfer: null, featureId: gate.id, evidence: "assumed" });
  }
  lower.finish();
  concourse.finish();
  return { nodes, edges, sectionNodes, gateNodes };
}

/** Exact segment/rectangle test, expanded by corridor half-width for clearance. */
export function intersectsStadiumField(points: readonly Point[], padding = 0): boolean {
  return points.slice(1).some((b, i) => {
    const a = points[i];
    let enter = 0, leave = 1;
    for (const [start, delta, min, max] of [
      [a.x, b.x - a.x, 350 - padding, 850 + padding],
      [a.y, b.y - a.y, 320 - padding, 560 + padding],
    ]) {
      if (Math.abs(delta) < 1e-10) { if (start < min || start > max) return false; }
      else {
        const t1 = (min - start) / delta, t2 = (max - start) / delta;
        enter = Math.max(enter, Math.min(t1, t2));
        leave = Math.min(leave, Math.max(t1, t2));
        if (enter > leave) return false;
      }
    }
    return true;
  });
}

export function validateStadiumNetwork(network: StadiumNetwork): string[] {
  const errors: string[] = [], nodes = new Map(network.nodes.map(n => [n.id, n]));
  const surfaces = new Set(STADIUM_SURFACES.map(s => s.id));
  if (nodes.size !== network.nodes.length) errors.push("Duplicate navigation node IDs");
  if (new Set(network.edges.map(e => e.id)).size !== network.edges.length) errors.push("Duplicate navigation edge IDs");
  for (const n of network.nodes) {
    if (!surfaces.has(n.surfaceId)) errors.push(`${n.id}: unknown surface`);
    if (![n.point.x, n.point.y].every(Number.isFinite) || n.point.x < 0 || n.point.x > STADIUM.width || n.point.y < 0 || n.point.y > STADIUM.height) errors.push(`${n.id}: invalid position`);
  }
  for (const e of network.edges) {
    const from = nodes.get(e.from), to = nodes.get(e.to);
    if (!from || !to) { errors.push(`${e.id}: missing endpoint`); continue; }
    if (e.points.length < 2 || e.points.some(p => ![p.x, p.y].every(Number.isFinite))) { errors.push(`${e.id}: invalid geometry`); continue; }
    if (distance(from.point, e.points[0]) > 1e-5 || distance(to.point, e.points[e.points.length - 1]) > 1e-5) errors.push(`${e.id}: geometry does not meet endpoints`);
    const isTransfer = ["ramp", "stairs", "passage"].includes(e.kind);
    if (isTransfer) {
      if (e.direction !== "forward") errors.push(`${e.id}: transfers must lead toward the concourse`);
      if (from.surfaceId === to.surfaceId || to.surfaceId !== "concourse" || from.surfaceId === "exterior") errors.push(`${e.id}: invalid transfer surfaces`);
      if (!e.transfer || ![e.transfer.travelSeconds, e.transfer.capacityPerSecond].every(v => Number.isFinite(v) && v > 0)) errors.push(`${e.id}: transfer requires positive time and capacity`);
    } else if (e.kind === "gate") {
      if (from.surfaceId !== "concourse" || to.surfaceId !== "exterior" || e.direction !== "forward" || e.transfer) errors.push(`${e.id}: gate must lead out of the concourse`);
    } else if (from.surfaceId !== to.surfaceId || from.surfaceId === "exterior" || e.transfer) errors.push(`${e.id}: walking edges must stay on one interior surface`);
    if (!isTransfer && e.kind !== "gate" && (!Number.isFinite(e.widthMeters) || e.widthMeters! <= 0)) errors.push(`${e.id}: invalid corridor width`);
    const padding = e.widthMeters === null ? 0 : e.widthMeters / STADIUM_ASSUMPTIONS.metersPerUnit / 2;
    if (intersectsStadiumField(e.points, padding)) errors.push(`${e.id}: route intersects the field`);
  }
  for (const section of STADIUM.sections) {
    if (nodes.get(network.sectionNodes[section.id])?.surfaceId !== section.surfaceId) errors.push(`${section.id}: missing section access`);
  }
  for (const gate of STADIUM.gates) {
    if (nodes.get(network.gateNodes[gate.id])?.surfaceId !== "exterior") errors.push(`${gate.id}: missing exterior destination`);
  }
  return errors;
}
