import type { Point } from "../maps/stadium";
import { PHYSICAL_STADIUM_ASSUMPTIONS, PHYSICAL_STADIUM_BOUNDS, sourceToPhysical } from "../simulation/StadiumPhysicalGeometry";

/** Architectural dimensions wrap the simulation-owned physical model. */
export const STADIUM_3D_MODEL = Object.freeze({
  fieldLength: 100,
  fieldWidth: 48,
  lowerInnerRadius: 27,
  lowerOuterRadius: 50,
  concourseElevation: PHYSICAL_STADIUM_ASSUMPTIONS.concourseElevation,
  upperDeckElevation: PHYSICAL_STADIUM_ASSUMPTIONS.upperDeckMinElevation,
  exteriorElevation: 0.12,
  plazaSize: 22,
});

/** Source-map features are centered into the shared physical coordinate system. */
export function mapToGround(point: Point): { x: number; z: number } {
  const physical = sourceToPhysical(point);
  return { x: physical.x - PHYSICAL_STADIUM_BOUNDS.centerX, z: physical.z - PHYSICAL_STADIUM_BOUNDS.centerZ };
}

/** Capsule aligned north/south with the physical football field. */
export function capsulePoint(t: number, radius: number): { x: number; z: number } {
  const halfStraight = STADIUM_3D_MODEL.fieldLength / 2 - STADIUM_3D_MODEL.fieldWidth / 2;
  const straightLength = halfStraight * 2;
  const perimeter = straightLength * 2 + Math.PI * radius * 2;
  let distance = ((t % 1) + 1) % 1 * perimeter;
  if (distance <= straightLength) return { x: -radius, z: -halfStraight + distance };
  distance -= straightLength;
  if (distance <= Math.PI * radius) {
    const angle = Math.PI + distance / radius;
    return { x: radius * Math.sin(angle), z: halfStraight - radius * Math.cos(angle) };
  }
  distance -= Math.PI * radius;
  if (distance <= straightLength) return { x: radius, z: halfStraight - distance };
  distance -= straightLength;
  const angle = distance / radius;
  return { x: -radius * Math.cos(angle), z: -halfStraight - radius * Math.sin(angle) };
}
