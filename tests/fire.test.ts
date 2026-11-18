import { test } from "node:test";
import assert from "node:assert/strict";
import { Experiment } from "../src/simulation/Experiment";
import { Simulation } from "../src/simulation/Simulation";
import { FireSpread, fireOrigin, updateSmoke } from "../src/simulation/FireSpread";
import { findRoute } from "../src/pathfinding/algorithms";
import { FIRE, PATH_ALGORITHMS } from "../src/config/simulationConfig";
import { CellType } from "../src/simulation/Grid";
import { serializeLayout, parseLayout } from "../src/simulation/LayoutFile";
import { MAPS, type MapId } from "../src/maps/maps";

const run = (e: Experiment, seconds: number) => { while (e.screen === "simulation" && e.simulation.time < seconds) e.update(1 / 60); };

test("fire starts at 5 s, grows over time, and stops at its size limit", () => {
  const e = new Experiment();
  e.begin(100, "congestion", "fire", "large", true);
  run(e, 4.9);
  assert.equal(e.fire!.started, false);
  run(e, 5.1);
  assert.equal(e.fire!.startTime! >= 5 - 1e-6, true);
  run(e, 10);
  const mid = e.fire!.burning;
  assert.ok(mid > 1);
  run(e, 120);
  assert.ok(e.fire!.burning >= mid && e.fire!.burning <= FIRE.maxCells);
});

test("burning cells block walking and no planner routes through them", () => {
  const e = new Experiment();
  e.begin(60, "congestion", "fire", "large", true);
  run(e, 12);
  const g = e.simulation.grid;
  const burning = [...g.fire.keys()].filter((i) => g.fire[i]);
  assert.ok(burning.length > 3);
  for (const i of burning) assert.equal(g.walkable(i % g.width, Math.floor(i / g.width)), false);
  for (const algorithm of PATH_ALGORITHMS)
    for (const exit of g.exitIds) {
      const route = findRoute(g, { x: 10, y: 10 }, exit, "shortest", algorithm);
      if (route) for (const p of route.path) assert.equal(g.fire[g.index(p.x, p.y)], 0, algorithm);
    }
});

test("smoke surrounds the fire, fades with distance and slows walkers", () => {
  const g = MAPS.large.create(), o = fireOrigin(g)!;
  g.fire[g.index(o.x, o.y)] = 1;
  updateSmoke(g);
  const near = g.hazard[g.index(o.x + 1, o.y)], far = g.hazard[g.index(o.x + 3, o.y)];
  assert.ok(near > far && far > 0);
  assert.equal(g.hazard[g.index(o.x + FIRE.smokeRangeCells + 2, o.y)], 0);
  // Smoke raises the cost of routes through it for every strategy.
  const clear = MAPS.large.create();
  assert.ok(findRoute(g, { x: o.x - 6, y: o.y }, "B", "shortest", "astar")!.totalCost > findRoute(clear, { x: o.x - 6, y: o.y }, "B", "shortest", "astar")!.totalCost);
});

test("the fire never traps anyone, and everyone evacuates on every building map", () => {
  for (const map of Object.keys(MAPS) as MapId[]) {
    const e = new Experiment();
    e.begin(Math.min(150, e.simulation.populationLimit(map)), "congestion", "fire", map, true);
    run(e, 200);
    assert.equal(e.simulation.metrics.remainingAgents, 0, map);
    assert.ok(e.fire!.started, map);
  }
});

test("fire is run state: never saved in layouts, cleared on reset and edits", () => {
  const e = new Experiment();
  e.begin(60, "congestion", "fire", "large", true);
  run(e, 10);
  const g = e.simulation.grid;
  assert.ok(g.fire.includes(1));
  assert.equal(g.cloneLayout(false).fire.includes(1), false);
  const loaded = parseLayout(serializeLayout(g, "large"));
  assert.equal(loaded.grid.fire.includes(1), false);
  for (let i = 0; i < g.cells.length; i++) if (g.fire[i]) assert.equal(loaded.grid.cells[i], CellType.Walkable);
  e.restart();
  assert.equal(e.simulation.grid.fire.includes(1), false);
  assert.equal(e.fire!.started, false);
});

test("fire runs are deterministic", () => {
  const once = () => { const e = new Experiment(); e.begin(120, "shortest", "fire", "large", true); run(e, 200); return [e.simulation.time, e.fire!.burning]; };
  assert.deepEqual(once(), once());
});

test("other scenarios are unaffected: no smoke, normal speeds", () => {
  const s = new Simulation(50, "large");
  s.running = true;
  for (let i = 0; i < 300; i++) s.update(1 / 60);
  assert.equal(s.grid.hazard.some((v) => v > 0), false);
  for (const a of s.agents) assert.equal(a.speed, a.baseSpeed);
  assert.equal(new FireSpread(s.grid).started, false);
});
