import type { Vector2 } from "../utils/Vector2";

/** Minimum separation of two linear motions over a common time interval. */
export function closestDistanceSquared(relative: Vector2, velocity: Vector2, horizon: number): number {
  const speed2 = velocity.x ** 2 + velocity.y ** 2;
  const t = speed2 > 1e-12 ? Math.max(0, Math.min(horizon, -(relative.x * velocity.x + relative.y * velocity.y) / speed2)) : 0;
  return (relative.x + velocity.x * t) ** 2 + (relative.y + velocity.y * t) ** 2;
}

/** True only when the complete simultaneous sweeps retain the requested clearance. */
export function motionsClear(a: Vector2, aEnd: Vector2, b: Vector2, bEnd: Vector2, clearance: number): boolean {
  return closestDistanceSquared({ x: a.x - b.x, y: a.y - b.y },
    { x: aEnd.x - a.x - bEnd.x + b.x, y: aEnd.y - a.y - bEnd.y + b.y }, 1) >= clearance ** 2 - 1e-7;
}
