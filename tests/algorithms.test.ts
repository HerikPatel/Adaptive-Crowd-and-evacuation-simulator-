import { test } from "node:test";
import assert from "node:assert/strict";
import { createMvpMap } from "../src/maps/mvpMap";
import { createLargeMap } from "../src/maps/largeMap";
import { findRoute, findBestRoute, lineOfSight } from "../src/pathfinding/algorithms";
import { findPath } from "../src/pathfinding/AStar";
import { PATH_ALGORITHMS } from "../src/config/simulationConfig";
import { Simulation } from "../src/simulation/Simulation";
import { Experiment } from "../src/simulation/Experiment";
import { Grid, CellType } from "../src/simulation/Grid";

test("every algorithm finds a reachable exit and rejects unreachable ones", () => {
  const grid = new Grid(7, 3, 20);
  grid.cells.fill(CellType.Walkable);
  grid.cells[grid.index(0, 1)] = CellType.ExitA;
  for (let y = 0; y < 3; y++) grid.cells[grid.index(1, y)] = CellType.Wall;
  grid.cells[grid.index(6, 1)] = CellType.ExitB;
  for (const algorithm of PATH_ALGORITHMS) {
    assert.equal(findRoute(grid, { x: 2, y: 1 }, "A", "shortest", algorithm), null, algorithm);
    assert.equal(findBestRoute(grid, { x: 2, y: 1 }, "shortest", algorithm)?.targetExit, "B", algorithm);
  }
});

test("A* wrapper matches the original planner exactly", () => {
  const g = createMvpMap();
  assert.deepEqual(findRoute(g, { x: 10, y: 15 }, "A", "congestion", "astar"), findPath(g, { x: 10, y: 15 }, "A", "congestion"));
});

test("optimal grid planners agree on cost; Theta* is never longer and keeps body clearance", () => {
  for (const g of [createMvpMap(), createLargeMap()]) {
    for (let i = 0; i < 40; i++) {
      const x = 1 + ((i * 7) % (g.width - 2)), y = 1 + ((i * 11) % (g.height - 2));
      if (!g.walkable(x, y) || g.exitAt(x, y)) continue;
      for (const exit of g.exitIds) {
        const a = findRoute(g, { x, y }, exit, "shortest", "astar");
        if (!a) continue;
        assert.equal(findRoute(g, { x, y }, exit, "shortest", "dijkstra")!.totalCost, a.totalCost);
        assert.equal(findRoute(g, { x, y }, exit, "shortest", "bfs")!.totalCost, a.totalCost);
        assert.ok(findRoute(g, { x, y }, exit, "shortest", "greedy")!.totalCost >= a.totalCost);
        const t = findRoute(g, { x, y }, exit, "shortest", "thetastar")!;
        assert.ok(t.totalCost <= a.totalCost + 1e-9);
        assert.deepEqual(t.path[0], { x, y });
        assert.ok(g.exitAt(t.path.at(-1)!.x, t.path.at(-1)!.y));
        for (let k = 1; k < t.path.length; k++) assert.ok(lineOfSight(g, t.path[k - 1], t.path[k], 4.3));
      }
    }
  }
});

test("Theta* produces fewer, any-angle waypoints than A*", () => {
  const g = createMvpMap(), s = { x: 10, y: 15 };
  const a = findRoute(g, s, "A", "shortest", "astar")!, t = findRoute(g, s, "A", "shortest", "thetastar")!;
  assert.ok(t.path.length < a.path.length / 4);
  assert.ok(t.totalCost < a.totalCost);
});

test("congestion raises Theta* cost", () => {
  const g = createMvpMap(), s = { x: 27, y: 15 };
  const base = findRoute(g, s, "A", "congestion", "thetastar")!;
  for (let y = 9; y <= 14; y++) for (let x = 31; x <= 47; x++) g.density[g.index(x, y)] = 1;
  assert.ok(findRoute(g, s, "A", "congestion", "thetastar")!.totalCost > base.totalCost);
});

test("line of sight respects blocked exits after a layout change", () => {
  const g = createMvpMap(), [exit] = g.exits("A");
  const inside = { x: exit.x - 1, y: exit.y };
  assert.ok(lineOfSight(g, inside, exit));
  g.exitABlocked = true;
  assert.ok(!lineOfSight(g, inside, exit));
});

test("every algorithm evacuates a full crowd", () => {
  for (const algorithm of PATH_ALGORITHMS) {
    const s = new Simulation(60, "mvp");
    s.algorithm = algorithm;
    s.running = true;
    for (let i = 0; i < 150 * 60 && s.running; i++) s.update(1 / 60);
    assert.equal(s.metrics.evacuatedCount, 60, algorithm);
  }
});

test("experiment validates and keeps the selected algorithm", () => {
  const e = new Experiment();
  e.begin(50, "shortest", "open", "mvp", false, "predictive", "thetastar");
  assert.equal(e.simulation.algorithm, "thetastar");
  e.restart();
  assert.equal(e.simulation.algorithm, "thetastar");
  assert.throws(() => e.begin(50, "shortest", "open", "mvp", false, "predictive", "jps" as "astar"));
});
