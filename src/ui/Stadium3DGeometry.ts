import type { Point } from "../maps/stadium";
import { PHYSICAL_STADIUM_ASSUMPTIONS, PHYSICAL_STADIUM_BOUNDS, sourceToPhysical } from "../simulation/StadiumPhysicalGeometry";

/** Architectural dimensions wrap the simulation-owned physical model. */
export const STADIUM_3D_MODEL = Object.freeze({
  fieldLength: 100,
  fieldWidth: 48,
  lowerInnerRadius: 27,
  lowerOuterRadius: 46,
  bowlHalfStraight: 50,
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
  const halfStraight = STADIUM_3D_MODEL.bowlHalfStraight;
  const straightLength = halfStraight * 2;
  // The mapped lower bowl is tighter behind the end zones than a circular
  // running-track capsule, then deepens toward the exterior seating rows.
  const endRadius = 12 + (radius - STADIUM_3D_MODEL.lowerInnerRadius) /
    (STADIUM_3D_MODEL.lowerOuterRadius - STADIUM_3D_MODEL.lowerInnerRadius) * 32;
  // Parameterize every concentric ring against one reference perimeter. Using
  // each ring's own circumference puts its straight/curve transitions at
  // different values of `t`, so a mesh joining two rings twists across the
  // stadium instead of forming a seating band.
  const referenceArcLength = Math.PI * STADIUM_3D_MODEL.lowerOuterRadius;
  const perimeter = straightLength * 2 + referenceArcLength * 2;
  let distance = ((t % 1) + 1) % 1 * perimeter;
  if (distance <= straightLength) return { x: -radius, z: -halfStraight + distance };
  distance -= straightLength;
  if (distance <= referenceArcLength) {
    const angle = Math.PI - distance / referenceArcLength * Math.PI;
    return { x: radius * Math.cos(angle), z: halfStraight + endRadius * Math.sin(angle) };
  }
  distance -= referenceArcLength;
  if (distance <= straightLength) return { x: radius, z: halfStraight - distance };
  distance -= straightLength;
  const angle = -distance / referenceArcLength * Math.PI;
  return { x: radius * Math.cos(angle), z: -halfStraight + endRadius * Math.sin(angle) };
}
