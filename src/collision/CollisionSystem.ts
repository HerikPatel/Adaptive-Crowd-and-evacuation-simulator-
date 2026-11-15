import { CONFIG } from "../config/simulationConfig";
import { Agent } from "../simulation/Agent";
import { Grid } from "../simulation/Grid";
import { SpatialHash } from "../simulation/SpatialHash";
import { clamp } from "../utils/math";
import { normalize, type Vector2 } from "../utils/Vector2";
import { closestDistanceSquared, motionsClear } from "./PredictiveMotion";
export class CollisionSystem {
  private predictions = new WeakMap<Agent, { interval: number; desired: Vector2; speed: number; velocity: Vector2 }>();
  /** Resolve a newly closed door on any side, rather than assuming an east exit. */
  resolveDoorClosure(position: Vector2, radius: number, grid: Grid, fits = (_p: Vector2) => true): Vector2 {
    const s = grid.cellSize,
      gap = radius + 0.01;
    const cell = grid.cell(position);
    const candidates: Vector2[] = [];
    for (let y = cell.y - 1; y <= cell.y + 1; y++) {
      for (let x = cell.x - 1; x <= cell.x + 1; x++) {
        if (grid.walkable(x, y)) candidates.push(grid.center({ x, y }));
        else
          candidates.push(
            { x: x * s - gap, y: position.y },
            { x: (x + 1) * s + gap, y: position.y },
            { x: position.x, y: y * s - gap },
            { x: position.x, y: (y + 1) * s + gap },
          );
      }
    }
    candidates.sort(
      (a, b) =>
        Math.hypot(a.x - position.x, a.y - position.y) -
        Math.hypot(b.x - position.x, b.y - position.y),
    );
    return (
      candidates.find((p) => !this.intersectsWall(p, radius, grid) && fits(p)) ?? position
    );
  }
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
    tick?: number,
  ): Vector2 {
    // Stagger the expensive forecast at 10 Hz. Contacts and walls are still solved
    // on every 60 Hz step; a changed heading invalidates the forecast immediately.
    if (tick === undefined) return this.predictVelocity(a, desired, hash, grid);
    const interval = Math.floor((tick + a.id % 6) / 6), cached = this.predictions.get(a);
    if (cached && cached.interval === interval && cached.speed === a.speed &&
        (cached.desired.x - desired.x) ** 2 + (cached.desired.y - desired.y) ** 2 < 0.04) return cached.velocity;
    const velocity = this.predictVelocity(a, desired, hash, grid);
    this.predictions.set(a, { interval, desired, speed: a.speed, velocity });
    return velocity;
  }
  private predictVelocity(a: Agent, desired: Vector2, hash: SpatialHash<Agent>, grid: Grid): Vector2 {
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
    const preferred = { x: v.x * scale, y: v.y * scale };
    const neighbors = hash.query(a.position, a.speed * 0.9 + a.radius * 4).filter(p => p !== a && !p.evacuated)
      .sort((p, q) => (p.position.x - a.position.x) ** 2 + (p.position.y - a.position.y) ** 2 - (q.position.x - a.position.x) ** 2 - (q.position.y - a.position.y) ** 2).slice(0, 8);
    if (!neighbors.length) return preferred;
    if (this.canTravel(a.position, { x: a.position.x + preferred.x * 0.18, y: a.position.y + preferred.y * 0.18 }, a.radius, grid) && neighbors.every(other =>
      closestDistanceSquared({ x: a.position.x - other.position.x, y: a.position.y - other.position.y }, { x: preferred.x - other.velocity.x, y: preferred.y - other.velocity.y }, 0.65) >= (a.radius + other.radius + 1) ** 2)) return preferred;
    // Sample a small deterministic velocity set. Predict relative motion, rather than
    // waiting for overlap before reacting. Right-hand preference breaks head-on symmetry.
    const angles = [0, 0.3, -0.3, 0.65, -0.65, 1.05, -1.05, 1.55, -1.55, ...(a.stalledSeconds > 1 ? [2.2, -2.2] : [])];
    let best = preferred, bestCost = Infinity;
    for (const factor of [1, 0.5, 0]) for (const angle of factor ? angles : [0]) {
      const candidate = { x: factor * (preferred.x * Math.cos(angle) - preferred.y * Math.sin(angle)),
        y: factor * (preferred.x * Math.sin(angle) + preferred.y * Math.cos(angle)) };
      const aim = { x: a.position.x + candidate.x * 0.18, y: a.position.y + candidate.y * 0.18 };
      if (!this.canTravel(a.position, aim, a.radius, grid)) continue;
      let cost = ((candidate.x - preferred.x) ** 2 + (candidate.y - preferred.y) ** 2) / (a.speed ** 2) + (angle < 0 ? 0.025 : 0) +
        (1 - factor) * Math.min(64, a.stalledSeconds * 32);
      for (const other of neighbors) {
        const rel = { x: a.position.x - other.position.x, y: a.position.y - other.position.y };
        const relativeVelocity = { x: candidate.x - other.velocity.x, y: candidate.y - other.velocity.y };
        const space = a.radius + other.radius + 1;
        const distance2 = closestDistanceSquared(rel, relativeVelocity, 0.65);
        if (distance2 < space * space) cost += 8 * (1 - Math.sqrt(distance2) / space);
      }
      if (cost < bestCost) { bestCost = cost; best = candidate; }
    }
    return best;
  }

  /** Solve contact constraints jointly so a touching queue can advance together.
   * Final simultaneous sweeps are checked independently of solver convergence.
   * Starting positions must already be separated (spawn/edit/closure enforce this).
   */
  reserveMovements(movements: { agent: Agent; position: Vector2 }[], agents: Agent[], hash: SpatialHash<Agent>, grid: Grid, dt: number, tick: number) {
    const targets = new Map(movements.map(m => [m.agent.id, m.position]));
    const active = agents.filter(a => !a.evacuated);
    const maxTravel = Math.max(0, ...active.map(a => a.speed * dt)), maxRadius = Math.max(0, ...active.map(a => a.radius));
    const displacement = new Map(active.map(a => {
      const p = targets.get(a.id) ?? a.position;
      return [a.id, { x: p.x - a.position.x, y: p.y - a.position.y }];
    }));
    const pairs: { a: Agent; b: Agent; nx: number; ny: number; minimum: number }[] = [];
    for (const a of active) for (const b of hash.query(a.position, 2 * maxTravel + a.radius + maxRadius + 1)) {
      if (b.id <= a.id || b.evacuated) continue;
      const x = a.position.x - b.position.x, y = a.position.y - b.position.y, d = Math.hypot(x, y);
      if (!d) continue; // Spawn, edits and closures must supply separated starting bodies.
      // A half-pixel buffer leaves room for finite-iteration residuals in dense
      // contact chains; the independent sweep check uses the actual body radii.
      pairs.push({ a, b, nx: x / d, ny: y / d, minimum: a.radius + b.radius + 0.5 - d });
    }
    const walls = new Map<number, { nx: number; ny: number; minimum: number }[]>();
    for (const a of active) {
      const constraints: { nx: number; ny: number; minimum: number }[] = [], range = a.radius + a.speed * dt + 0.1, size = grid.cellSize;
      for (let y = Math.floor((a.position.y - range) / size); y <= Math.floor((a.position.y + range) / size); y++)
        for (let x = Math.floor((a.position.x - range) / size); x <= Math.floor((a.position.x + range) / size); x++) {
          if (grid.walkable(x, y)) continue;
          const dx = a.position.x - clamp(a.position.x, x * size, (x + 1) * size), dy = a.position.y - clamp(a.position.y, y * size, (y + 1) * size), distance = Math.hypot(dx, dy);
          if (distance > 0 && distance <= range) constraints.push({ nx: dx / distance, ny: dy / distance, minimum: a.radius - distance });
        }
      walls.set(a.id, constraints);
    }
    const offset = tick % Math.max(1, pairs.length);
    for (let pass = 0; pass < 48; pass++) {
      let correction = 0;
      for (let i = 0; i < pairs.length; i++) {
        const { a, b, nx, ny, minimum } = pairs[(i + offset) % pairs.length];
        const av = displacement.get(a.id)!, bv = displacement.get(b.id)!;
        const deficit = minimum - ((av.x - bv.x) * nx + (av.y - bv.y) * ny);
        if (deficit <= 0) continue;
        correction = Math.max(correction, deficit);
        av.x += nx * deficit / 2; av.y += ny * deficit / 2;
        bv.x -= nx * deficit / 2; bv.y -= ny * deficit / 2;
      }
      for (const a of active) {
        const v = displacement.get(a.id)!;
        // Project along the actual rounded wall normal. Axis-only clipping can pin
        // someone against a doorway corner when a neighbor needs them to yield.
        for (const { nx, ny, minimum } of walls.get(a.id)!) {
          const deficit = minimum - v.x * nx - v.y * ny;
          if (deficit > 0) { v.x += deficit * nx; v.y += deficit * ny; correction = Math.max(correction, deficit); }
        }
        const scale = Math.min(1, a.speed * dt / (Math.hypot(v.x, v.y) || 1));
        const p = this.move(a, { x: v.x * scale / dt, y: v.y * scale / dt }, dt, grid);
        correction = Math.max(correction, Math.hypot(p.x - a.position.x - v.x, p.y - a.position.y - v.y));
        v.x = p.x - a.position.x; v.y = p.y - a.position.y;
      }
      if (correction < 1e-5) break;
    }
    const ends = new Map(active.map(a => { const v = displacement.get(a.id)!; return [a.id, { x: a.position.x + v.x, y: a.position.y + v.y }]; }));
    // A bounded iterative solver is not a safety proof. Shorten a whole contact
    // component by one common fraction, preserving its coordinated motion. Stopping
    // individual bodies would invalidate their neighbors' proposals and jam a queue.
    const parent = new Map(active.map(a => [a.id, a.id]));
    const root = (id: number): number => {
      const next = parent.get(id)!;
      if (next === id) return id;
      const top = root(next); parent.set(id, top); return top;
    };
    for (const { a, b } of pairs) parent.set(root(a.id), root(b.id));
    const fractions = new Map<number, number>();
    const at = (a: Agent, fraction: number) => {
      const end = ends.get(a.id)!;
      return { x: a.position.x + (end.x - a.position.x) * fraction, y: a.position.y + (end.y - a.position.y) * fraction };
    };
    for (const a of active) if (!this.canTravel(a.position, ends.get(a.id)!, a.radius, grid)) fractions.set(root(a.id), 0);
    for (const { a, b } of pairs) {
      const component = root(a.id), limit = fractions.get(component) ?? 1;
      const safe = (fraction: number) => motionsClear(a.position, at(a, fraction), b.position, at(b, fraction), a.radius + b.radius);
      if (safe(limit)) continue;
      let low = 0, high = limit;
      for (let i = 0; i < 20; i++) { const middle = (low + high) / 2; if (safe(middle)) low = middle; else high = middle; }
      fractions.set(component, low);
    }
    // Every possible pair is in one component. Taking a prefix of all its motions
    // preserves every previously checked sweep and never increases walking speed.
    for (const a of active) ends.set(a.id, at(a, fractions.get(root(a.id)) ?? 1));
    return active.map(agent => ({ agent, position: ends.get(agent.id)! }));
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
