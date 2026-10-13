import { test } from "node:test";
import assert from "node:assert/strict";
import { Simulation } from "../src/simulation/Simulation";
import {
  shouldSwitch,
  CongestionRouter,
} from "../src/pathfinding/CongestionRouter";
import { findPath } from "../src/pathfinding/AStar";
import { createMvpMap } from "../src/maps/mvpMap";
import { Agent } from "../src/simulation/Agent";
test("hysteresis rejects small improvements and accepts significant improvements", () => {
  assert.equal(shouldSwitch(90, 100), false);
  assert.equal(shouldSwitch(85, 100), false);
  assert.equal(shouldSwitch(84, 100), true);
});
test("congestion raises cost and redirects committed A agents to B", () => {
  const g = createMvpMap(),
    start = { x: 27, y: 15 };
  const base = findPath(g, start, "A")!;
  for (let y = 9; y <= 14; y++)
    for (let x = 31; x <= 47; x++) g.density[g.index(x, y)] = 1;
  assert.ok(findPath(g, start, "A", "congestion")!.totalCost > base.totalCost);
  const a = new Agent(0, g.center(start), 48);
  a.path = base.path;
  a.targetExit = "A";
  assert.equal(
    new CongestionRouter().plan(a, g, "congestion")?.targetExit,
    "B",
  );
});
test("blocking invalidates A paths immediately; bounded queue sends agents to B", () => {
  const s = new Simulation(100);
  s.running = true;
  for (let i = 0; i < 60; i++) s.update(1 / 60);
  assert.ok(s.agents.some((a) => a.targetExit === "A"));
  s.setExitABlocked(true);
  for (const a of s.agents.filter((a) => a.targetExit === "A"))
    assert.equal(a.path.length, 0);
  const queued = s.replanQueue.length;
  s.update(1 / 60);
  assert.ok(queued - s.replanQueue.length <= 5);
  for (let i = 0; i < 30; i++) s.update(1 / 60);
  assert.ok(s.agents.every((a) => a.targetExit === "B"));
  assert.ok(
    s.agents.every(
      (a) => !s.collision.intersectsWall(a.position, a.radius, s.grid),
    ),
  );
});
