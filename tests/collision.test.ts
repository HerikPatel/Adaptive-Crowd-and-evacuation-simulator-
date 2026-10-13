import { test } from "node:test";
import assert from "node:assert/strict";
import { CollisionSystem } from "../src/collision/CollisionSystem";
import { Agent } from "../src/simulation/Agent";
import { SpatialHash } from "../src/simulation/SpatialHash";
import { createMvpMap } from "../src/maps/mvpMap";
test("wall handling stops high-speed movement without tunneling", () => {
  const g = createMvpMap(),
    c = new CollisionSystem(),
    a = new Agent(0, { x: 50, y: 110 }, 48);
  const p = c.move(a, { x: -1000, y: 20 }, 1, g);
  assert.ok(p.x >= 40 + a.radius);
  assert.ok(!c.intersectsWall(p, a.radius, g));
});
test("soft separation reduces overlap for stationary overlapping agents", () => {
  const g = createMvpMap(),
    c = new CollisionSystem(),
    a = new Agent(0, { x: 100, y: 120 }, 48),
    b = new Agent(1, { x: 105, y: 120 }, 48),
    h = new SpatialHash<Agent>(32);
  h.insert(a);
  h.insert(b);
  const av = c.velocity(a, { x: 0, y: 0 }, h, g),
    bv = c.velocity(b, { x: 0, y: 0 }, h, g);
  assert.ok(av.x < 0);
  assert.ok(bv.x > 0);
});
