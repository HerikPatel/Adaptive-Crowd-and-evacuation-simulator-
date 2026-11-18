import type { Point } from "../maps/stadium";
import { STADIUM_ASSUMPTIONS, type NavigationEdge } from "../maps/stadiumNavigation";

function pointSegment(p: Point, a: Point, b: Point): number {
  const x = b.x - a.x, y = b.y - a.y, length2 = x * x + y * y;
  const t = length2 ? Math.max(0, Math.min(1, ((p.x - a.x) * x + (p.y - a.y) * y) / length2)) : 0;
  return (p.x - a.x - t * x) ** 2 + (p.y - a.y - t * y) ** 2;
}
function segmentDistance(a: Point, b: Point, c: Point, d: Point): number {
  const cross = (x: Point, y: Point, z: Point) => (y.x - x.x) * (z.y - x.y) - (y.y - x.y) * (z.x - x.x);
  const abC = cross(a, b, c), abD = cross(a, b, d), cdA = cross(c, d, a), cdB = cross(c, d, b);
  if (abC * abD < 0 && cdA * cdB < 0) return 0;
  return Math.min(pointSegment(a, c, d), pointSegment(b, c, d), pointSegment(c, a, b), pointSegment(d, a, b));
}

/** Nearby schematic corridors can conflict even without a common graph endpoint.
 * Serialize their bodies without inventing a walkable connection at a drawing crossing.
 * Call only for edges on the same walking surface. Explicit shared-node junctions are handled separately.
 */
export function corridorsConflict(a: NavigationEdge, b: NavigationEdge): boolean {
  // Section aisles can run underneath schematic stair/ramp approach lines on the
  // same surface. Ordinary ring merges retain the existing node reservations.
  if (!((a.kind === "aisle" && b.kind === "approach") || (b.kind === "aisle" && a.kind === "approach"))) return false;
  if ([a.from, a.to].some(id => id === b.from || id === b.to)) return false;
  const lane = (edge: NavigationEdge) => (edge.widthMeters ?? 0) >= 1.4 ? 0.4 : 0;
  const clearance = (0.65 + lane(a) + lane(b)) / STADIUM_ASSUMPTIONS.metersPerUnit;
  const bounds = (edge: NavigationEdge) => ({ minX: Math.min(...edge.points.map(p => p.x)), maxX: Math.max(...edge.points.map(p => p.x)), minY: Math.min(...edge.points.map(p => p.y)), maxY: Math.max(...edge.points.map(p => p.y)) });
  const x = bounds(a), y = bounds(b);
  if (x.minX > y.maxX + clearance || y.minX > x.maxX + clearance || x.minY > y.maxY + clearance || y.minY > x.maxY + clearance) return false;
  for (let i = 1; i < a.points.length; i++) for (let j = 1; j < b.points.length; j++)
    if (segmentDistance(a.points[i - 1], a.points[i], b.points[j - 1], b.points[j]) < clearance * clearance) return true;
  return false;
}
