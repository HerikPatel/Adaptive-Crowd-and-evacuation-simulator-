import { CONFIG } from "../config/simulationConfig";
import { Agent } from "../simulation/Agent";
import { Grid } from "../simulation/Grid";
import { SpatialHash } from "../simulation/SpatialHash";
import { clamp } from "../utils/math";
import { normalize, type Vector2 } from "../utils/Vector2";
export class CollisionSystem {
  canTravel(from: Vector2, to: Vector2, radius: number, grid: Grid): boolean {
    const length = Math.hypot(to.x - from.x, to.y - from.y),
      steps = Math.max(1, Math.ceil(length / (radius * 0.5)));
    for (let i = 1; i <= steps; i++)
      if (
        this.intersectsWall(
          {
            x: from.x + ((to.x - from.x) * i) / steps,
            y: from.y + ((to.y - from.y) * i) / steps,
          },
          radius,
          grid,
        )
      )
        return false;
    return true;
  }
  intersectsWall(p: Vector2, radius: number, grid: Grid): boolean {
    const s = grid.cellSize;
    for (
      let y = Math.floor((p.y - radius) / s);
      y <= Math.floor((p.y + radius) / s);
      y++
    )
      for (
        let x = Math.floor((p.x - radius) / s);
        x <= Math.floor((p.x + radius) / s);
        x++
      ) {
        if (grid.walkable(x, y)) continue;
        const dx = p.x - clamp(p.x, x * s, (x + 1) * s),
          dy = p.y - clamp(p.y, y * s, (y + 1) * s);
        if (dx * dx + dy * dy < radius * radius - 1e-7) return true;
      }
    return false;
  }
  wallAvoidance(a: Agent, grid: Grid): Vector2 {
    const s = grid.cellSize,
      range = a.radius + 3,
      force = { x: 0, y: 0 };
    for (
      let y = Math.floor((a.position.y - range) / s);
      y <= Math.floor((a.position.y + range) / s);
      y++
    )
      for (
        let x = Math.floor((a.position.x - range) / s);
        x <= Math.floor((a.position.x + range) / s);
        x++
      ) {
        if (grid.walkable(x, y)) continue;
        const dx = a.position.x - clamp(a.position.x, x * s, (x + 1) * s),
          dy = a.position.y - clamp(a.position.y, y * s, (y + 1) * s),
          d = Math.hypot(dx, dy);
        if (d > 0 && d < range) {
          force.x += ((dx / d) * (range - d)) / range;
          force.y += ((dy / d) * (range - d)) / range;
        }
      }
    return force;
  }
  velocity(
    a: Agent,
    desired: Vector2,
    hash: SpatialHash<Agent>,
    grid: Grid,
  ): Vector2 {
    const separation = { x: 0, y: 0 };
    for (const other of hash.query(a.position, a.radius * 3)) {
      if (other === a || other.evacuated) continue;
      let dx = a.position.x - other.position.x,
        dy = a.position.y - other.position.y,
        d = Math.hypot(dx, dy);
      if (d < 1e-7) {
        const angle = Math.min(a.id, other.id) * 2.39996,
          sign = a.id < other.id ? 1 : -1;
        dx = Math.cos(angle) * sign;
        dy = Math.sin(angle) * sign;
        d = 1;
      }
      const personalSpace = a.radius + other.radius + 2;
      if (d < personalSpace) {
        const strength = (personalSpace - d) / personalSpace;
        separation.x += (dx / d) * strength;
        separation.y += (dy / d) * strength;
      }
    }
    const wall = this.wallAvoidance(a, grid);
    const v = {
      x:
        desired.x +
        CONFIG.separationWeight * separation.x +
        CONFIG.wallWeight * wall.x,
      y:
        desired.y +
        CONFIG.separationWeight * separation.y +
        CONFIG.wallWeight * wall.y,
    };
    // Cap rather than always normalize: compression must be able to slow a crowd.
    const scale = a.speed / Math.max(1, Math.hypot(v.x, v.y));
    return { x: v.x * scale, y: v.y * scale };
  }
  move(a: Agent, velocity: Vector2, dt: number, grid: Grid): Vector2 {
    // Substeps keep circle-wall checks safe even if a caller supplies a large dt.
    const steps = Math.max(
      1,
      Math.ceil((Math.hypot(velocity.x, velocity.y) * dt) / (a.radius * 0.5)),
    );
    let p = { ...a.position };
    for (let i = 0; i < steps; i++) {
      const next = {
        x: p.x + (velocity.x * dt) / steps,
        y: p.y + (velocity.y * dt) / steps,
      };
      if (!this.intersectsWall(next, a.radius, grid)) {
        p = next;
        continue;
      }
      const xOnly = { x: next.x, y: p.y };
      if (!this.intersectsWall(xOnly, a.radius, grid)) p = xOnly;
      const yOnly = { x: p.x, y: next.y };
      if (!this.intersectsWall(yOnly, a.radius, grid)) p = yOnly;
    }
    return p;
  }
  direction(a: Agent, goal: Vector2) {
    return normalize({ x: goal.x - a.position.x, y: goal.y - a.position.y });
  }
}
