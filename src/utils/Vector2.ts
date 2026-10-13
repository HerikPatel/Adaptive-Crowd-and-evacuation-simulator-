export interface Vector2 {
  x: number;
  y: number;
}
export interface GridPosition {
  x: number;
  y: number;
}
export const distance = (a: Vector2, b: Vector2) =>
  Math.hypot(a.x - b.x, a.y - b.y);
export function normalize(v: Vector2): Vector2 {
  const d = Math.hypot(v.x, v.y);
  return d > 1e-8 ? { x: v.x / d, y: v.y / d } : { x: 0, y: 0 };
}
