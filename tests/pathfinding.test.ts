import { test } from "node:test";
import assert from "node:assert/strict";
import { createMvpMap } from "../src/maps/mvpMap";
import { findPath, findBestPath } from "../src/pathfinding/AStar";
import { Simulation } from "../src/simulation/Simulation";
import { Grid, CellType } from "../src/simulation/Grid";
test("A* rejects unreachable A even when it is geographically closer", () => {
  const grid = new Grid(7, 3, 20);
  grid.cells.fill(CellType.Walkable);
  grid.cells[grid.index(0, 1)] = CellType.ExitA;
  for (let y = 0; y < 3; y++) grid.cells[grid.index(1, y)] = CellType.Wall;
  grid.cells[grid.index(6, 1)] = CellType.ExitB;
  assert.equal(findPath(grid, { x: 2, y: 1 }, "A"), null);
  assert.equal(findBestPath(grid, { x: 2, y: 1 })?.targetExit, "B");
});
test("A* returns cardinal, wall-free paths and prefers the cheaper exit", () => {
  const g = createMvpMap(),
    s = { x: 10, y: 15 },
    a = findPath(g, s, "A")!,
    b = findPath(g, s, "B")!;
  assert.ok(a && b);
  assert.ok(a.totalCost < b.totalCost);
  assert.equal(findBestPath(g, s)?.targetExit, "A");
  for (const route of [a, b]) {
    assert.deepEqual(route.path[0], s);
    for (let i = 0; i < route.path.length; i++) {
      const p = route.path[i];
      assert.ok(g.walkable(p.x, p.y));
      if (i)
        assert.equal(
          Math.abs(p.x - route.path[i - 1].x) +
            Math.abs(p.y - route.path[i - 1].y),
          1,
        );
    }
  }
});
test("blocked exit is unavailable and reachable B is selected", () => {
  const g = createMvpMap();
  g.exitABlocked = true;
  assert.equal(findPath(g, { x: 10, y: 15 }, "A"), null);
  assert.equal(findBestPath(g, { x: 10, y: 15 })?.targetExit, "B");
});
test("one agent finishes evacuation", () => {
  const s = new Simulation(1);
  s.running = true;
  for (let i = 0; i < 120 * 60 && s.running; i++) s.update(1 / 60);
  assert.ok(s.agents[0].evacuated);
  assert.ok(s.time < 120);
});
