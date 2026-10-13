import { CONFIG } from "../config/simulationConfig";
import type { Agent } from "./Agent";
import { Grid } from "./Grid";
import { SpatialHash } from "./SpatialHash";
/** Each 20px cell represents 1m². Density uses accessible cells in a 3×3 neighborhood. */
export class Density {
  private accumulator = 0;
  revision = 0;
  peak = 0;
  update(grid: Grid, hash: SpatialHash<Agent>, dt: number) {
    const s = grid.cellSize;
    // Raw density is evaluated each fixed step through local spatial queries.
    for (let y = 0; y < grid.height; y++)
      for (let x = 0; x < grid.width; x++) {
        const id = grid.index(x, y);
        if (!grid.walkable(x, y)) {
          grid.rawDensity[id] = 0;
          continue;
        }
        let area = 0;
        for (let oy = -1; oy <= 1; oy++)
          for (let ox = -1; ox <= 1; ox++)
            if (grid.walkable(x + ox, y + oy)) area++;
        let count = 0;
        for (const a of hash.query(grid.center({ x, y }), s * 2.13)) {
          const cell = grid.cell(a.position);
          if (
            !a.evacuated &&
            Math.abs(cell.x - x) <= 1 &&
            Math.abs(cell.y - y) <= 1
          )
            count++;
        }
        const raw = count / area;
        grid.rawDensity[id] = raw;
        this.peak = Math.max(this.peak, raw);
      }
    this.accumulator += dt;
    if (this.accumulator + 1e-9 < CONFIG.densityInterval) return;
    this.accumulator -= CONFIG.densityInterval;
    // Routing and display share the same smoothed snapshot, updated at 10 Hz.
    for (let i = 0; i < grid.density.length; i++)
      grid.density[i] =
        grid.density[i] * (1 - CONFIG.densitySmoothing) +
        Math.min(1, grid.rawDensity[i] / CONFIG.densitySaturation) *
          CONFIG.densitySmoothing;
    this.revision++;
  }
}
