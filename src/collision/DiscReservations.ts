import type { Point } from "../maps/stadium";

interface Disc { id: number; zone: string; position: Point; radius: number; key: string }

/** Continuous swept-circle checks against spatially indexed, already reserved positions.
 * Coordinates and radii are meters. Zones isolate surfaces and individual transfer channels.
 * This conservative motion filter cannot push a person through another body or off their path.
 */
export class DiscReservations {
  private discs = new Map<number, Disc>();
  private buckets = new Map<string, Set<number>>();
  private maxRadius = 0;
  private key(zone: string, x: number, y: number) { return `${zone}:${Math.floor(x)}:${Math.floor(y)}`; }
  clear() { this.discs.clear(); this.buckets.clear(); this.maxRadius = 0; }
  remove(id: number) {
    const old = this.discs.get(id);
    if (!old) return;
    const bucket = this.buckets.get(old.key)!; bucket.delete(id);
    if (!bucket.size) this.buckets.delete(old.key);
    this.discs.delete(id);
  }
  set(id: number, zone: string, position: Point, radius: number) {
    this.remove(id);
    const key = this.key(zone, position.x, position.y), bucket = this.buckets.get(key) ?? new Set<number>();
    bucket.add(id); this.buckets.set(key, bucket);
    this.discs.set(id, { id, zone, position, radius, key }); this.maxRadius = Math.max(this.maxRadius, radius);
  }
  private nearby(zone: string, from: Point, to: Point, radius: number): Disc[] {
    const result: Disc[] = [], padding = radius + this.maxRadius + 0.02;
    for (let x = Math.floor(Math.min(from.x, to.x) - padding); x <= Math.floor(Math.max(from.x, to.x) + padding); x++)
      for (let y = Math.floor(Math.min(from.y, to.y) - padding); y <= Math.floor(Math.max(from.y, to.y) + padding); y++)
        for (const id of this.buckets.get(`${zone}:${x}:${y}`) ?? []) result.push(this.discs.get(id)!);
    return result;
  }
  fits(id: number, zone: string, at: Point, radius: number): boolean {
    return this.nearby(zone, at, at, radius).every(other => other.id === id ||
      Math.hypot(at.x - other.position.x, at.y - other.position.y) >= radius + other.radius + 0.01 - 1e-7);
  }
  fraction(id: number, zone: string, from: Point, to: Point, radius: number): number {
    const dx = to.x - from.x, dy = to.y - from.y, a = dx * dx + dy * dy;
    if (a < 1e-16) return 1;
    let allowed = 1;
    for (const other of this.nearby(zone, from, to, radius)) {
      if (other.id === id) continue;
      const x = from.x - other.position.x, y = from.y - other.position.y;
      const r = radius + other.radius + 0.01, b = x * dx + y * dy, c = x * x + y * y - r * r;
      if (b >= 0) continue; // Already moving apart, including tolerance-level contact.
      if (c <= 1e-10) { allowed = 0; continue; }
      const discriminant = b * b - a * c;
      if (discriminant < 0) continue;
      const hit = (-b - Math.sqrt(discriminant)) / a;
      if (hit >= 0 && hit < allowed) allowed = Math.max(0, hit - 1e-6);
    }
    return allowed;
  }
}
