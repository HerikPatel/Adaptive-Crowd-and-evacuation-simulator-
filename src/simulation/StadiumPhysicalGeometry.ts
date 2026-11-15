import { STADIUM, type Point, type StadiumSection, type SurfaceId } from "../maps/stadium";

export interface PhysicalPoint { x: number; y: number; z: number }
export interface PhysicalDirection { x: number; y: number; z: number }
export interface PhysicalPath {
  readonly id: string;
  readonly points: readonly PhysicalPoint[];
  readonly cumulative: readonly number[];
  readonly length: number;
  readonly width: number;
}
export interface PhysicalPathSample {
  readonly position: PhysicalPoint;
  readonly direction: PhysicalDirection;
  readonly distance: number;
  readonly progress: number;
  readonly segmentIndex: number;
}
export interface PhysicalSeat {
  readonly id: string;
  readonly sectionId: string;
  readonly position: PhysicalPoint;
  readonly accessPath: PhysicalPath;
  readonly row: number;
  readonly side: "left" | "right";
}

export const PHYSICAL_STADIUM_ASSUMPTIONS = Object.freeze({
  sourceMetersPerUnit: 0.2,
  referenceWalkingSpeed: 1.2,
  seatPitch: 0.55,
  rowDepth: 0.85,
  seatOffsetFromRow: 0.28,
  aisleWidth: 1.2,
  sectionOpeningWidth: 2,
  walkwayWidth: 2.4,
  concourseWidth: 4.8,
  stairWidth: 1.8,
  rampWidth: 2.4,
  gateApproachWidth: 4.8,
  fieldElevation: 0,
  exteriorElevation: 0,
  concourseElevation: 3.2,
  lowerBowlMinElevation: 1.2,
  lowerBowlMaxElevation: 9.2,
  upperDeckMinElevation: 11.5,
  upperDeckMaxElevation: 18,
  stairRiser: 0.17,
  stairTread: 0.3,
});

/** Source drawing: east is up and north is left. Physical coordinates: east +x, up +y, south +z. */
export function sourceToPhysical(point: Point, elevation = 0): PhysicalPoint {
  const scale = PHYSICAL_STADIUM_ASSUMPTIONS.sourceMetersPerUnit;
  return { x: (STADIUM.height - point.y) * scale, y: elevation, z: point.x * scale };
}

/** North-up SVG projection derived from physical meters. */
export function physicalToSvg(point: { x: number; z: number }): Point {
  const scale = PHYSICAL_STADIUM_ASSUMPTIONS.sourceMetersPerUnit;
  return { x: point.x / scale, y: point.z / scale };
}

export const PHYSICAL_STADIUM_BOUNDS = Object.freeze({
  width: STADIUM.height * PHYSICAL_STADIUM_ASSUMPTIONS.sourceMetersPerUnit,
  depth: STADIUM.width * PHYSICAL_STADIUM_ASSUMPTIONS.sourceMetersPerUnit,
  centerX: STADIUM.height * PHYSICAL_STADIUM_ASSUMPTIONS.sourceMetersPerUnit / 2,
  centerZ: STADIUM.width * PHYSICAL_STADIUM_ASSUMPTIONS.sourceMetersPerUnit / 2,
});

export function surfaceElevation(surface: SurfaceId, point: { x: number; z: number }): number {
  const assumptions = PHYSICAL_STADIUM_ASSUMPTIONS;
  if (surface === "concourse") return assumptions.concourseElevation;
  if (surface === "exterior") return assumptions.exteriorElevation;
  const dx = Math.abs(point.x - PHYSICAL_STADIUM_BOUNDS.centerX);
  const dz = Math.abs(point.z - PHYSICAL_STADIUM_BOUNDS.centerZ);
  if (surface === "lower-bowl") {
    const outsideFieldX = Math.max(0, dx - 24);
    const outsideFieldZ = Math.max(0, dz - 50);
    const radial = Math.hypot(outsideFieldX, outsideFieldZ);
    const progress = Math.max(0, Math.min(1, (radial - 2) / 38));
    return assumptions.lowerBowlMinElevation + progress * (assumptions.lowerBowlMaxElevation - assumptions.lowerBowlMinElevation);
  }
  const sidelineDistance = Math.max(0, dx - 46);
  const progress = Math.max(0, Math.min(1, sidelineDistance / 28));
  return assumptions.upperDeckMinElevation + progress * (assumptions.upperDeckMaxElevation - assumptions.upperDeckMinElevation);
}

function distance(a: PhysicalPoint, b: PhysicalPoint) {
  return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
}

export function createPhysicalPath(id: string, points: readonly PhysicalPoint[], width: number): PhysicalPath {
  if (points.length < 2) throw new Error(`${id}: a physical path needs at least two points`);
  if (!Number.isFinite(width) || width <= 0) throw new Error(`${id}: physical width must be positive`);
  const copied = points.map(point => Object.freeze({ ...point }));
  const cumulative = [0];
  for (let i = 1; i < copied.length; i++) cumulative.push(cumulative[i - 1] + distance(copied[i - 1], copied[i]));
  if (cumulative.at(-1)! <= 0) throw new Error(`${id}: physical path must have positive length`);
  return Object.freeze({ id, points: Object.freeze(copied), cumulative: Object.freeze(cumulative),
    length: cumulative.at(-1)!, width });
}

export function createSurfacePath(id: string, points: readonly { x: number; z: number }[], width: number,
  fromSurface: SurfaceId, toSurface = fromSurface): PhysicalPath {
  if (points.length < 2) throw new Error(`${id}: a surface path needs at least two points`);
  const horizontal = [0];
  for (let i = 1; i < points.length; i++) horizontal.push(horizontal[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z));
  const total = horizontal.at(-1)!;
  const physical = points.map((point, index) => {
    const progress = total ? horizontal[index] / total : index / (points.length - 1);
    const from = surfaceElevation(fromSurface, point), to = surfaceElevation(toSurface, point);
    return { ...point, y: from + (to - from) * progress };
  });
  return createPhysicalPath(id, physical, width);
}

export function samplePhysicalPath(path: PhysicalPath, requestedDistance: number): PhysicalPathSample {
  const at = Math.max(0, Math.min(path.length, requestedDistance));
  let segmentIndex = path.points.length - 2;
  for (let i = 1; i < path.cumulative.length; i++) if (at <= path.cumulative[i] + 1e-10) { segmentIndex = i - 1; break; }
  const a = path.points[segmentIndex], b = path.points[segmentIndex + 1];
  const segmentStart = path.cumulative[segmentIndex], segmentLength = path.cumulative[segmentIndex + 1] - segmentStart;
  const t = segmentLength ? Math.max(0, Math.min(1, (at - segmentStart) / segmentLength)) : 1;
  const direction = segmentLength ? { x: (b.x - a.x) / segmentLength, y: (b.y - a.y) / segmentLength, z: (b.z - a.z) / segmentLength }
    : { x: 0, y: 0, z: 1 };
  return Object.freeze({
    position: Object.freeze({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t }),
    direction: Object.freeze(direction), distance: at, progress: at / path.length, segmentIndex,
  });
}

export function transferDuration(pathLength: number, preferredSpeed: number, configuredMinimum: number) {
  if (![pathLength, preferredSpeed, configuredMinimum].every(Number.isFinite) || pathLength < 0 || preferredSpeed <= 0 || configuredMinimum < 0)
    throw new Error("Physical length, walking speed, and configured minimum must be valid.");
  const adjustedMinimum = configuredMinimum * Math.max(1, PHYSICAL_STADIUM_ASSUMPTIONS.referenceWalkingSpeed / preferredSpeed);
  return Math.max(pathLength / preferredSpeed, adjustedMinimum);
}

function inside(point: { x: number; z: number }, polygon: readonly { x: number; z: number }[]) {
  let result = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a.z > point.z) !== (b.z > point.z) && point.x < (b.x - a.x) * (point.z - a.z) / (b.z - a.z) + a.x) result = !result;
  }
  return result;
}

export function generateSectionSeats(section: StadiumSection): readonly PhysicalSeat[] {
  const polygon = section.polygon.map(point => sourceToPhysical(point));
  const opening = sourceToPhysical(section.at);
  const radialLength = Math.hypot(opening.x - PHYSICAL_STADIUM_BOUNDS.centerX, opening.z - PHYSICAL_STADIUM_BOUNDS.centerZ) || 1;
  const radial = { x: (opening.x - PHYSICAL_STADIUM_BOUNDS.centerX) / radialLength,
    z: (opening.z - PHYSICAL_STADIUM_BOUNDS.centerZ) / radialLength };
  const tangent = { x: -radial.z, z: radial.x };
  const local = polygon.map(point => ({ u: (point.x - opening.x) * tangent.x + (point.z - opening.z) * tangent.z,
    v: (point.x - opening.x) * radial.x + (point.z - opening.z) * radial.z }));
  const minU = Math.min(...local.map(point => point.u)), maxU = Math.max(...local.map(point => point.u));
  const minV = Math.min(...local.map(point => point.v)), maxV = Math.max(...local.map(point => point.v));
  const seats: PhysicalSeat[] = [];
  let row = 0;
  for (let v = minV + 0.55; v <= maxV - 0.55; v += PHYSICAL_STADIUM_ASSUMPTIONS.rowDepth, row++) {
    let column = 0;
    for (let u = minU + 0.55; u <= maxU - 0.55; u += PHYSICAL_STADIUM_ASSUMPTIONS.seatPitch, column++) {
      const horizontal = { x: opening.x + tangent.x * u + radial.x * v, z: opening.z + tangent.z * u + radial.z * v };
      if (!inside(horizontal, polygon)) continue;
      const side: "left" | "right" = Math.abs(u - minU) <= Math.abs(maxU - u) ? "left" : "right";
      const aisleU = side === "left" ? minU + PHYSICAL_STADIUM_ASSUMPTIONS.aisleWidth / 2 : maxU - PHYSICAL_STADIUM_ASSUMPTIONS.aisleWidth / 2;
      const aisle = { x: opening.x + tangent.x * aisleU + radial.x * v, z: opening.z + tangent.z * aisleU + radial.z * v };
      const seatY = surfaceElevation(section.surfaceId, horizontal);
      const aisleY = surfaceElevation(section.surfaceId, aisle);
      const openingY = surfaceElevation(section.surfaceId, opening);
      const accessPath = createPhysicalPath(`${section.id}-seat-${row}-${column}-access`, [
        { ...horizontal, y: seatY }, { ...aisle, y: aisleY }, { ...opening, y: openingY },
      ], PHYSICAL_STADIUM_ASSUMPTIONS.aisleWidth);
      seats.push(Object.freeze({ id: `${section.id}-seat-${row}-${column}`, sectionId: section.id,
        position: Object.freeze({ ...horizontal, y: seatY }), accessPath, row, side }));
    }
  }
  return Object.freeze(seats);
}

export const STADIUM_PHYSICAL_SEATS = new Map(STADIUM.sections.map(section => [section.id, generateSectionSeats(section)]));
