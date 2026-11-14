import { STADIUM, type Point, type SurfaceId } from "../maps/stadium";

/**
 * Visual-only dimensions used by the SHI Stadium-inspired scene. The simulation
 * keeps using the original schematic map and distances; these values only bend
 * that map into a more recognizable stadium.
 */
export const STADIUM_3D_MODEL = Object.freeze({
  mapScale: 0.05,
  fieldLength: 30,
  fieldWidth: 13.35,
  lowerInnerRadius: 7.1,
  lowerOuterRadius: 13.2,
  concourseElevation: 3.2,
  upperDeckElevation: 13.5,
  exteriorElevation: 0.12,
  plazaSize: 7.5,
});

export interface StadiumWorldPoint { x: number; y: number; z: number }

export function mapToGround(point: Point): { x: number; z: number } {
  return {
    x: (point.x - STADIUM.width / 2) * STADIUM_3D_MODEL.mapScale,
    z: (point.y - STADIUM.height / 2) * STADIUM_3D_MODEL.mapScale,
  };
}

/** Distance from the football field's capsule-like footprint. */
export function bowlRadius(point: Point): number {
  const { x, z } = mapToGround(point);
  const halfStraight = STADIUM_3D_MODEL.fieldLength / 2 - STADIUM_3D_MODEL.fieldWidth / 2;
  const endX = Math.max(0, Math.abs(x) - halfStraight);
  return Math.hypot(endX, z);
}

export function lowerBowlElevation(point: Point): number {
  const range = STADIUM_3D_MODEL.lowerOuterRadius - STADIUM_3D_MODEL.lowerInnerRadius;
  const progress = Math.max(0, Math.min(1, (bowlRadius(point) - STADIUM_3D_MODEL.lowerInnerRadius) / range));
  return 1.15 + progress * 7.2;
}

export function stadiumSurfacePoint(point: Point, surface: SurfaceId): StadiumWorldPoint {
  const ground = mapToGround(point);
  let y: number = STADIUM_3D_MODEL.exteriorElevation;
  if (surface === "lower-bowl") y = lowerBowlElevation(point);
  else if (surface === "upper-east" || surface === "upper-west") y = STADIUM_3D_MODEL.upperDeckElevation;
  else if (surface === "concourse") y = STADIUM_3D_MODEL.concourseElevation;
  return { ...ground, y };
}

/** A capsule loop aligned with the field's long axis. */
export function capsulePoint(t: number, radius: number): { x: number; z: number } {
  const halfStraight = STADIUM_3D_MODEL.fieldLength / 2 - STADIUM_3D_MODEL.fieldWidth / 2;
  const straightLength = halfStraight * 2;
  const perimeter = straightLength * 2 + Math.PI * radius * 2;
  let distance = ((t % 1) + 1) % 1 * perimeter;
  if (distance <= straightLength) return { x: -halfStraight + distance, z: -radius };
  distance -= straightLength;
  if (distance <= Math.PI * radius) {
    const angle = -Math.PI / 2 + distance / radius;
    return { x: halfStraight + radius * Math.cos(angle), z: radius * Math.sin(angle) };
  }
  distance -= Math.PI * radius;
  if (distance <= straightLength) return { x: halfStraight - distance, z: radius };
  distance -= straightLength;
  const angle = Math.PI / 2 + distance / radius;
  return { x: -halfStraight + radius * Math.cos(angle), z: radius * Math.sin(angle) };
}

export function surfaceElevation(surface: SurfaceId, point?: Point): number {
  if (surface === "lower-bowl") return point ? lowerBowlElevation(point) : 6;
  if (surface === "upper-east" || surface === "upper-west") return STADIUM_3D_MODEL.upperDeckElevation;
  if (surface === "concourse") return STADIUM_3D_MODEL.concourseElevation;
  return STADIUM_3D_MODEL.exteriorElevation;
}
