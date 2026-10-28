import { Grid } from "../simulation/Grid";
export class HeatmapRenderer {
  private canvas = document.createElement("canvas");
  private ctx = this.canvas.getContext("2d")!;
  private lastRevision = -1;
  private lastLayoutRevision = -1;
  private lastGrid: Grid | null = null;
  draw(ctx: CanvasRenderingContext2D, grid: Grid, revision: number) {
    if (this.lastGrid !== grid || this.lastRevision !== revision || this.lastLayoutRevision !== grid.layoutRevision) {
      this.lastGrid = grid;
      this.lastRevision = revision;
      this.lastLayoutRevision = grid.layoutRevision;
      this.canvas.width = grid.width * grid.cellSize;
      this.canvas.height = grid.height * grid.cellSize;
      const c = this.ctx,
        s = grid.cellSize;
      for (let y = 0; y < grid.height; y++)
        for (let x = 0; x < grid.width; x++) {
          if (!grid.walkable(x, y)) continue;
          const density = grid.density[grid.index(x, y)];
          if (density < 0.015) continue;
          c.fillStyle = `hsla(${140 * (1 - density)},85%,55%,${0.08 + 0.5 * density})`;
          c.fillRect(x * s, y * s, s, s);
        }
    }
    ctx.drawImage(this.canvas, 0, 0);
  }
}
