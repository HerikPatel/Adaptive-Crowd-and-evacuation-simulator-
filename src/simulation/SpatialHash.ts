import type { Vector2 } from "../utils/Vector2";
export interface SpatialItem {
  id: number;
  position: Vector2;
}
export class SpatialHash<T extends SpatialItem> {
  private buckets = new Map<number, T[]>();
  constructor(public cellSize: number) {}
  private key(x: number, y: number) {
    return (x + 32768) * 65536 + y + 32768;
  }
  clear() {
    this.buckets.clear();
  }
  insert(item: T) {
    const key = this.key(
      Math.floor(item.position.x / this.cellSize),
      Math.floor(item.position.y / this.cellSize),
    );
    const bucket = this.buckets.get(key);
    if (bucket) bucket.push(item);
    else this.buckets.set(key, [item]);
  }
  query(position: Vector2, radius: number): T[] {
    const found: T[] = [],
      s = this.cellSize,
      r2 = radius * radius;
    for (
      let y = Math.floor((position.y - radius) / s);
      y <= Math.floor((position.y + radius) / s);
      y++
    )
      for (
        let x = Math.floor((position.x - radius) / s);
        x <= Math.floor((position.x + radius) / s);
        x++
      ) {
        const bucket = this.buckets.get(this.key(x, y));
        if (!bucket) continue;
        for (const item of bucket) {
          const dx = item.position.x - position.x,
            dy = item.position.y - position.y;
          if (dx * dx + dy * dy <= r2) found.push(item);
        }
      }
    return found;
  }
}
