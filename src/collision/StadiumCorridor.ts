import type { Point } from "../maps/stadium";
import type { NavigationEdge } from "../maps/stadiumNavigation";
import { STADIUM_ASSUMPTIONS } from "../maps/stadiumNavigation";

/** A tube around a walking polyline, in meters. Smoothed normals keep lane changes
 * continuous at polyline vertices. The whole body must fit inside the assumed width.
 */
export class StadiumCorridor {
  readonly points: Point[];
  readonly lengths: number[];
  readonly normals: Point[];
  readonly length: number;
  constructor(readonly edge: NavigationEdge) {
    this.points = edge.points.map(p => ({ x: p.x * STADIUM_ASSUMPTIONS.metersPerUnit, y: p.y * STADIUM_ASSUMPTIONS.metersPerUnit }));
    const unit = (x: number, y: number) => { const length = Math.hypot(x, y); return length ? { x: x / length, y: y / length } : { x: 0, y: 0 }; };
    const segments = this.points.slice(1).map((b, i) => unit(-(b.y - this.points[i].y), b.x - this.points[i].x));
    this.lengths = this.points.slice(1).map((b, i) => Math.hypot(b.x - this.points[i].x, b.y - this.points[i].y));
    this.length = this.lengths.reduce((a, b) => a + b, 0);
    this.normals = this.points.map((_, i) => {
      const before = segments[Math.max(0, i - 1)], after = segments[Math.min(segments.length - 1, i)];
      return unit(before.x + after.x, before.y + after.y);
    });
  }
  supportsPassing(radius: number) { return !this.edge.transfer && this.edge.direction === "both" && this.length >= 8 && (this.edge.widthMeters ?? 0) / 2 >= 1.2 + radius + 0.05; }
  point(distance: number, reverse: boolean, offset: number): Point {
    let d = reverse ? this.length - distance : distance;
    d = Math.max(0, Math.min(this.length, d));
    for (let i = 0; i < this.lengths.length; i++) {
      const length = this.lengths[i];
      if (d <= length || i === this.lengths.length - 1) {
        const t = length ? Math.min(1, d / length) : 0, a = this.points[i], b = this.points[i + 1];
        const nx = this.normals[i].x * (1 - t) + this.normals[i + 1].x * t, ny = this.normals[i].y * (1 - t) + this.normals[i + 1].y * t;
        const n = Math.hypot(nx, ny) || 1, side = reverse ? -1 : 1;
        return { x: a.x + (b.x - a.x) * t + side * offset * nx / n, y: a.y + (b.y - a.y) * t + side * offset * ny / n };
      }
      d -= length;
    }
    return this.points[0];
  }
}
