import { CONFIG, EXIT_IDS, type ExitId } from "../config/simulationConfig";
import type { GridPosition, Vector2 } from "../utils/Vector2";
export enum CellType {
  Walkable,
  Wall,
  ExitA,
  ExitB,
}
export class Grid {
  readonly cells: Uint8Array;
  readonly density: Float32Array;
  readonly rawDensity: Float32Array;
  readonly blockedExits = new Set<ExitId>();
  layoutRevision = 0;
  // Preserve the preset/scenario API while all routing uses the exit collection.
  get exitABlocked() { return this.blockedExits.has("A"); }
  set exitABlocked(value: boolean) { this.setExitBlocked("A", value); }
  setExitBlocked(id: ExitId, blocked: boolean) {
    if (blocked) this.blockedExits.add(id);
    else this.blockedExits.delete(id);
    this.layoutRevision++;
  }
  exitAt(x: number, y: number): ExitId | null {
    return EXIT_IDS[this.type(x, y) - CellType.ExitA] ?? null;
  }
  get exitIds(): ExitId[] {
    const types = new Set(this.cells);
    return EXIT_IDS.filter((_, i) => types.has(CellType.ExitA + i));
  }
  placeExit(id: ExitId, p: GridPosition) {
    this.cells[this.index(p.x, p.y)] = CellType.ExitA + EXIT_IDS.indexOf(id);
    this.layoutRevision++;
  }
  cloneLayout(includeBlocked = true): Grid {
    const grid = new Grid(this.width, this.height, this.cellSize);
    grid.cells.set(this.cells);
    if (includeBlocked)
      for (const id of this.blockedExits) grid.blockedExits.add(id);
    return grid;
  }
  constructor(
    public width = CONFIG.gridWidth as number,
    public height = CONFIG.gridHeight as number,
    public cellSize = CONFIG.cellSize as number,
  ) {
    this.cells = new Uint8Array(width * height).fill(CellType.Wall);
    this.density = new Float32Array(width * height);
    this.rawDensity = new Float32Array(width * height);
  }
  index(x: number, y: number) {
    return y * this.width + x;
  }
  inside(x: number, y: number) {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }
  type(x: number, y: number): CellType {
    return this.inside(x, y) ? this.cells[this.index(x, y)] : CellType.Wall;
  }
  walkable(x: number, y: number) {
    const t = this.type(x, y);
    const exit = this.exitAt(x, y);
    return t !== CellType.Wall && !(exit && this.blockedExits.has(exit));
  }
  center(p: GridPosition): Vector2 {
    return { x: (p.x + 0.5) * this.cellSize, y: (p.y + 0.5) * this.cellSize };
  }
  cell(p: Vector2): GridPosition {
    return {
      x: Math.floor(p.x / this.cellSize),
      y: Math.floor(p.y / this.cellSize),
    };
  }
  exits(id: ExitId, includeBlocked = false): GridPosition[] {
    const result: GridPosition[] = [];
    const type = CellType.ExitA + EXIT_IDS.indexOf(id);
    for (let y = 0; y < this.height; y++)
      for (let x = 0; x < this.width; x++)
        if (this.type(x, y) === type && (includeBlocked || this.walkable(x, y)))
          result.push({ x, y });
    return result;
  }
  /** Flood from open exits: also checks that edited spawn areas remain connected. */
  reachableFromExits(): Uint8Array {
    const seen = new Uint8Array(this.cells.length);
    const queue = this.exitIds.flatMap((id) => this.exits(id));
    for (const p of queue) seen[this.index(p.x, p.y)] = 1;
    for (let i = 0; i < queue.length; i++)
      for (const p of this.neighbors(queue[i])) {
        const index = this.index(p.x, p.y);
        if (!seen[index]) { seen[index] = 1; queue.push(p); }
      }
    return seen;
  }
  neighbors(p: GridPosition) {
    return [
      { x: p.x + 1, y: p.y },
      { x: p.x - 1, y: p.y },
      { x: p.x, y: p.y + 1 },
      { x: p.x, y: p.y - 1 },
    ].filter((q) => this.walkable(q.x, q.y));
  }
}
