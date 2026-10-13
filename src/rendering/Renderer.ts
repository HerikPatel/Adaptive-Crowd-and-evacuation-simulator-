import { Grid, CellType } from "../simulation/Grid";
import type { Agent } from "../simulation/Agent";
import { HeatmapRenderer } from "./HeatmapRenderer";
import { MAPS, type MapLabel } from "../maps/maps";
export interface RenderOptions {
  paths: boolean;
  spatialHash: boolean;
  densityValues: boolean;
}
export class Renderer {
  private heatmap = new HeatmapRenderer();
  options: RenderOptions = {
    paths: false,
    spatialHash: false,
    densityValues: false,
  };
  constructor(private ctx: CanvasRenderingContext2D) {}
  render(
    grid: Grid,
    agents: Agent[] = [],
    revision = 0,
    time = 0,
    labels: MapLabel[] = MAPS.mvp.labels,
  ) {
    const c = this.ctx,
      s = grid.cellSize;
    if (
      c.canvas.width !== grid.width * s ||
      c.canvas.height !== grid.height * s
    ) {
      c.canvas.width = grid.width * s;
      c.canvas.height = grid.height * s;
    }
    c.fillStyle = "#101c2b";
    c.fillRect(0, 0, grid.width * s, grid.height * s);
    for (let y = 0; y < grid.height; y++)
      for (let x = 0; x < grid.width; x++) {
        const type = grid.type(x, y);
        if (type === CellType.Wall) continue;
        c.fillStyle = "#263748";
        c.fillRect(x * s, y * s, s, s);
        c.strokeStyle = "#304152";
        c.lineWidth = 0.4;
        c.strokeRect(x * s, y * s, s, s);
      }
    this.heatmap.draw(c, grid, revision);
    // Wall outlines sit above the heatmap; blocked doors are drawn as solid barriers.
    for (let y = 0; y < grid.height; y++)
      for (let x = 0; x < grid.width; x++) {
        const type = grid.type(x, y);
        if (type === CellType.Wall) continue;
        c.strokeStyle = "#4b6276";
        c.lineWidth = 1.5;
        for (const [dx, dy] of [
          [0, -1],
          [0, 1],
          [-1, 0],
          [1, 0],
        ])
          if (grid.type(x + dx, y + dy) === CellType.Wall) {
            c.beginPath();
            if (dx === 0) {
              c.moveTo(x * s, (y + (dy > 0 ? 1 : 0)) * s);
              c.lineTo((x + 1) * s, (y + (dy > 0 ? 1 : 0)) * s);
            } else {
              c.moveTo((x + (dx > 0 ? 1 : 0)) * s, y * s);
              c.lineTo((x + (dx > 0 ? 1 : 0)) * s, (y + 1) * s);
            }
            c.stroke();
          }
        if (type === CellType.ExitA || type === CellType.ExitB) {
          c.fillStyle =
            type === CellType.ExitA && grid.exitABlocked
              ? "#ef735c"
              : "#67dec1";
          c.fillRect(x * s, y * s, s, s);
          c.fillStyle = "#0d2b29";
          c.font = "bold 14px Segoe UI";
          c.fillText(
            type === CellType.ExitA ? (grid.exitABlocked ? "×" : "A") : "B",
            x * s + 5,
            y * s + 15,
          );
        }
      }
    if (this.options.paths) {
      for (const a of agents) {
        if (a.evacuated || !a.path.length) continue;
        c.strokeStyle = a.targetExit === "A" ? "#77d9cb30" : "#b49eff30";
        c.lineWidth = 1;
        c.beginPath();
        c.moveTo(a.position.x, a.position.y);
        for (let i = a.pathIndex; i < a.path.length; i++) {
          const p = grid.center(a.path[i]);
          c.lineTo(p.x, p.y);
        }
        c.stroke();
      }
    }
    c.fillStyle = "#91a9be";
    c.font = "11px Segoe UI";
    for (const label of labels) {
      const blocked = label.exit === "A" && grid.exitABlocked;
      c.fillStyle = label.exit ? (blocked ? "#ef735c" : "#67dec1") : "#91a9be";
      c.font = label.exit ? "bold 12px Segoe UI" : "11px Segoe UI";
      c.fillText(blocked ? "EXIT A / BLOCKED" : label.text, label.x, label.y);
    }
    for (const a of agents) {
      if (a.evacuated) continue;
      c.fillStyle = a.reroutingUntil > time ? "#ffc477" : "#c6e4ff";
      c.beginPath();
      c.arc(a.position.x, a.position.y, a.radius, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = "#101c2b";
      c.lineWidth = 0.6;
      c.stroke();
    }
    if (this.options.spatialHash) {
      c.strokeStyle = "#a5c8dc35";
      c.lineWidth = 0.5;
      for (let x = 0; x <= grid.width * s; x += 32) {
        c.beginPath();
        c.moveTo(x, 0);
        c.lineTo(x, grid.height * s);
        c.stroke();
      }
      for (let y = 0; y <= grid.height * s; y += 32) {
        c.beginPath();
        c.moveTo(0, y);
        c.lineTo(grid.width * s, y);
        c.stroke();
      }
    }
    if (this.options.densityValues) {
      c.fillStyle = "#fff";
      c.font = "8px monospace";
      for (let y = 0; y < grid.height; y++)
        for (let x = 0; x < grid.width; x++) {
          const d = grid.rawDensity[grid.index(x, y)];
          if (d > 0.1 && grid.walkable(x, y))
            c.fillText(d.toFixed(1), x * s + 1, y * s + 12);
        }
    }
  }
}
