import { CONFIG, type ExitId } from "../config/simulationConfig";
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
  exitABlocked = false;
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
    return t !== CellType.Wall && !(t === CellType.ExitA && this.exitABlocked);
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
  exits(id: ExitId): GridPosition[] {
    const result: GridPosition[] = [];
    const type = id === "A" ? CellType.ExitA : CellType.ExitB;
    for (let y = 0; y < this.height; y++)
      for (let x = 0; x < this.width; x++)
        if (this.type(x, y) === type && this.walkable(x, y))
          result.push({ x, y });
    return result;
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
