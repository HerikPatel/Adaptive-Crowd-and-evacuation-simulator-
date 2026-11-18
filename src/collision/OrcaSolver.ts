/*!
 * ORCA pair constraints and linear programs adapted from RVO2, src/Agent.cc.
 * SPDX-FileCopyrightText: 2008 University of North Carolina at Chapel Hill
 * SPDX-License-Identifier: Apache-2.0
 * Authors: Jur van den Berg, Stephen J. Guy, Jamie Snape, Ming C. Lin, Dinesh Manocha.
 * https://github.com/snape/RVO2 — license: /third-party/rvo2/LICENSE.txt
 * Modified for this project: TypeScript vectors, deterministic degenerate-pair
 * handling, grid-wall supporting planes, spatial-hash neighbors and diagnostics.
 * Licensed under the Apache License, Version 2.0; distributed WITHOUT WARRANTIES
 * OR CONDITIONS OF ANY KIND. See the license for permissions and limitations.
 */
import type { Agent } from "../simulation/Agent";
import type { Grid } from "../simulation/Grid";
import type { SpatialHash } from "../simulation/SpatialHash";
import { clamp } from "../utils/math";
import { normalize, type Vector2 } from "../utils/Vector2";

export const ORCA_SETTINGS = { timeHorizon: 0.8, wallHorizon: 0.2, maxNeighbors: 16, passingBias: 0.03 } as const;
const EPS = 1e-8;
const add = (a: Vector2, b: Vector2): Vector2 => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a: Vector2, b: Vector2): Vector2 => ({ x: a.x - b.x, y: a.y - b.y });
const mul = (a: Vector2, s: number): Vector2 => ({ x: a.x * s, y: a.y * s });
const dot = (a: Vector2, b: Vector2) => a.x * b.x + a.y * b.y;
const det = (a: Vector2, b: Vector2) => a.x * b.y - a.y * b.x;
const length2 = (v: Vector2) => dot(v, v);

/** Feasible velocities lie to the left of the oriented line. Direction is unit length. */
export interface OrcaLine { point: Vector2; direction: Vector2 }
export interface OrcaBody { id: number; position: Vector2; velocity: Vector2; radius: number }
export const violation = (line: OrcaLine, velocity: Vector2) => det(line.direction, sub(line.point, velocity));

export function pairConstraint(a: OrcaBody, b: OrcaBody, dt: number, horizon: number): OrcaLine {
  const p = sub(b.position, a.position), v = sub(a.velocity, b.velocity);
  const distance2 = length2(p), radius = a.radius + b.radius, radius2 = radius * radius;
  let direction: Vector2, correction: Vector2;
  if (distance2 > radius2) {
    const w = sub(v, mul(p, 1 / horizon)), projection = dot(w, p), w2 = length2(w);
    if (projection < 0 && projection * projection > radius2 * w2) {
      const size = Math.sqrt(w2), normal = mul(w, 1 / size);
      direction = { x: normal.y, y: -normal.x };
      correction = mul(normal, radius / horizon - size);
    } else {
      const leg = Math.sqrt(distance2 - radius2);
      direction = det(p, w) > 0
        ? { x: (p.x * leg - p.y * radius) / distance2, y: (p.x * radius + p.y * leg) / distance2 }
        : { x: -(p.x * leg + p.y * radius) / distance2, y: -(-p.x * radius + p.y * leg) / distance2 };
      correction = sub(mul(direction, dot(v, direction)), v);
    }
  } else {
    const w = sub(v, mul(p, 1 / dt)), size = Math.sqrt(length2(w));
    // Coincident stationary centers need opposite, deterministic normals.
    const normal = size > EPS ? mul(w, 1 / size) : distance2 > EPS
      ? mul(p, -1 / Math.sqrt(distance2)) : { x: a.id < b.id ? -1 : 1, y: 0 };
    direction = { x: normal.y, y: -normal.x };
    correction = mul(normal, radius / dt - size);
  }
  return { point: add(a.velocity, mul(correction, 0.5)), direction };
}

function onLine(lines: OrcaLine[], index: number, speed: number, preferred: Vector2, optimizeDirection: boolean): Vector2 | null {
  const line = lines[index], projection = dot(line.point, line.direction);
  const discriminant = projection * projection + speed * speed - length2(line.point);
  if (discriminant < -EPS) return null;
  const root = Math.sqrt(Math.max(0, discriminant));
  let left = -projection - root, right = -projection + root;
  for (let i = 0; i < index; i++) {
    const denominator = det(line.direction, lines[i].direction);
    const numerator = det(lines[i].direction, sub(line.point, lines[i].point));
    if (Math.abs(denominator) <= EPS) { if (numerator < -EPS) return null; continue; }
    const t = numerator / denominator;
    if (denominator >= 0) right = Math.min(right, t); else left = Math.max(left, t);
    if (left > right + EPS) return null;
  }
  const t = optimizeDirection ? (dot(preferred, line.direction) > 0 ? right : left)
    : clamp(dot(line.direction, sub(preferred, line.point)), left, right);
  return add(line.point, mul(line.direction, t));
}

function linearProgram(lines: OrcaLine[], speed: number, preferred: Vector2, optimizeDirection = false) {
  let velocity = optimizeDirection || length2(preferred) > speed * speed ? mul(normalize(preferred), speed) : { ...preferred };
  for (let i = 0; i < lines.length; i++) {
    if (violation(lines[i], velocity) <= EPS) continue;
    const candidate = onLine(lines, i, speed, preferred, optimizeDirection);
    if (!candidate) return { velocity, failedAt: i };
    velocity = candidate;
  }
  return { velocity, failedAt: lines.length };
}

/** Closest feasible velocity; when crowded constraints conflict, minimize violation
 * while preserving the static constraints. The caller still checks actual motion. */
export function solveVelocity(lines: OrcaLine[], staticCount: number, speed: number, preferred: Vector2) {
  const first = linearProgram(lines, speed, preferred);
  let velocity = first.velocity, worst = 0;
  for (let i = first.failedAt; i < lines.length; i++) {
    if (violation(lines[i], velocity) <= worst + EPS) continue;
    const projected = lines.slice(0, staticCount);
    for (let j = staticCount; j < i; j++) {
      const determinant = det(lines[i].direction, lines[j].direction);
      let point: Vector2;
      if (Math.abs(determinant) <= EPS) {
        if (dot(lines[i].direction, lines[j].direction) > 0) continue;
        point = mul(add(lines[i].point, lines[j].point), 0.5);
      } else point = add(lines[i].point, mul(lines[i].direction,
        det(lines[j].direction, sub(lines[i].point, lines[j].point)) / determinant));
      projected.push({ point, direction: normalize(sub(lines[j].direction, lines[i].direction)) });
    }
    const candidate = linearProgram(projected, speed, { x: -lines[i].direction.y, y: lines[i].direction.x }, true);
    if (candidate.failedAt === projected.length) velocity = candidate.velocity;
    worst = violation(lines[i], velocity);
  }
  return { velocity, feasible: lines.every(line => violation(line, velocity) <= 1e-6) };
}

export class OrcaSolver {
  solves = 0;
  infeasible = 0;

  velocity(a: Agent, desired: Vector2, hash: SpatialHash<Agent>, grid: Grid, dt: number, maxSpeed: number): Vector2 {
    const lines: OrcaLine[] = [], horizon = Math.max(dt, ORCA_SETTINGS.wallHorizon);
    const range = a.radius + a.speed * horizon, cell = grid.cellSize;
    // A supporting plane of each nearby expanded wall rectangle prevents crossing
    // that wall over the horizon. This is conservative at corners, not RVO2's
    // polygon-obstacle implementation. Zero velocity is feasible for valid spawns.
    for (let y = Math.floor((a.position.y - range) / cell); y <= Math.floor((a.position.y + range) / cell); y++)
      for (let x = Math.floor((a.position.x - range) / cell); x <= Math.floor((a.position.x + range) / cell); x++) {
        if (grid.walkable(x, y)) continue;
        const delta = { x: a.position.x - clamp(a.position.x, x * cell, (x + 1) * cell),
          y: a.position.y - clamp(a.position.y, y * cell, (y + 1) * cell) };
        const distance = Math.sqrt(length2(delta));
        if (distance <= EPS || distance > range) continue;
        const normal = mul(delta, 1 / distance);
        lines.push({ point: mul(normal, -Math.max(0, distance - a.radius) / horizon), direction: { x: normal.y, y: -normal.x } });
      }
    const staticCount = lines.length;
    const neighbors = hash.query(a.position, (a.speed + maxSpeed) * ORCA_SETTINGS.timeHorizon + 2 * a.radius)
      .filter(b => b !== a && !b.evacuated)
      .sort((b, c) => length2(sub(b.position, a.position)) - length2(sub(c.position, a.position)) || b.id - c.id)
      .slice(0, ORCA_SETTINGS.maxNeighbors);
    for (const b of neighbors) lines.push(pairConstraint(a, b, dt, ORCA_SETTINGS.timeHorizon));
    // A small right-hand preference breaks perfectly symmetric head-on deadlocks.
    // It changes only the objective, never the ORCA half-planes or speed limit.
    const headOn = neighbors.some(b => {
      const p = sub(b.position, a.position);
      return dot(p, desired) > 0 && Math.abs(det(desired, p)) < a.radius + b.radius && dot(desired, b.velocity) < -0.1;
    });
    const bias = headOn ? ORCA_SETTINGS.passingBias : 0;
    const preferred = mul(normalize({ x: desired.x - desired.y * bias, y: desired.y + desired.x * bias }), a.speed);
    const result = solveVelocity(lines, staticCount, a.speed, preferred);
    this.solves++;
    if (!result.feasible) this.infeasible++;
    return result.velocity;
  }
}
