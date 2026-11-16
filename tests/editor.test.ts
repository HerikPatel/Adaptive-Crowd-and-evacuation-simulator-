import { test } from "node:test";
import assert from "node:assert/strict";
import { Simulation } from "../src/simulation/Simulation";
import { LayoutEditor } from "../src/simulation/LayoutEditor";
import { CellType } from "../src/simulation/Grid";
import { Experiment } from "../src/simulation/Experiment";
import { findBestPath } from "../src/pathfinding/AStar";
import { EXIT_IDS, type RoutingMode } from "../src/config/simulationConfig";

test("custom crowd sizes validate atomically against each layout's spawn capacity", () => {
  const e = new Experiment();
  e.begin(137, "congestion", "open", "mvp", false);
  const s = e.simulation, capacity = s.populationLimit("mvp");
  assert.equal(s.agents.length, 137);
  assert.equal(s.running, false);
  const initial = JSON.stringify(s.agents);
  e.restart();
  assert.equal(JSON.stringify(s.agents), initial);
  for (const count of [0, -8, 137.5, NaN, Infinity, capacity + 1])
    assert.throws(() => e.begin(count, "shortest", "closure", "mvp"));
  assert.equal(s.agentCount, 137);
  assert.equal(s.mode, "congestion");
  assert.equal(JSON.stringify(s.agents), initial);
  e.begin(1000, "shortest", "open", "large", false);
  assert.equal(s.agents.length, 1000);
  assert.equal(new Set(s.agents.map((a) => `${a.position.x},${a.position.y}`)).size, 1000);
  assert.ok(s.agents.every((a) => !s.collision.intersectsWall(a.position, a.radius, s.grid)));
  assert.throws(() => e.begin(1000, "shortest", "open", "mvp"));
  assert.equal(s.mapId, "large");
});

test("wall strokes and erasing are atomic, undoable, and survive reset", () => {
  const s = new Simulation(137), editor = new LayoutEditor(s);
  const cells = [{ x: 20, y: 13 }, { x: 21, y: 13 }, { x: 22, y: 13 }];
  assert.equal(editor.apply("wall", cells).ok, true);
  assert.ok(cells.every((p) => s.grid.type(p.x, p.y) === CellType.Wall));
  assert.equal(editor.apply("floor", [{ x: 21, y: 13 }]).ok, true);
  assert.equal(s.grid.type(21, 13), CellType.Walkable);
  assert.equal(editor.undo().ok, true);
  assert.equal(s.grid.type(21, 13), CellType.Wall);
  s.reset();
  assert.ok(cells.every((p) => s.grid.type(p.x, p.y) === CellType.Wall));
  assert.equal(editor.canUndo, false);
  assert.equal(s.metrics.remainingAgents, 137);
  assert.equal(s.hasCustomLayout, true);
  s.restoreOriginalLayout();
  assert.equal(s.hasCustomLayout, false);
  assert.equal(s.grid.type(21, 13), CellType.Walkable);
});

test("edits reject occupied cells, trapped areas, exits, and the outer boundary without changing state", () => {
  const s = new Simulation(137), editor = new LayoutEditor(s);
  const grid = s.grid, before = Array.from(grid.cells);
  const occupied = grid.cell(s.agents[0].position);
  for (const cells of [
    [occupied], [{ x: 8, y: 4 }, occupied], [{ x: 0, y: 10 }],
    [{ x: 47, y: 11 }], Array.from({ length: 5 }, (_, i) => ({ x: 20, y: 13 + i })),
  ]) {
    assert.equal(editor.apply("wall", cells).ok, false);
    assert.equal(s.grid, grid);
    assert.deepEqual(Array.from(s.grid.cells), before);
    assert.equal(editor.canUndo, false);
  }
  assert.equal(editor.apply("exit", [occupied]).ok, false);
  assert.equal(editor.apply("floor", [{ x: 47, y: 11 }]).ok, false);
  assert.equal(editor.apply("floor", [{ x: 8, y: 1 }]).ok, false, "isolated floor has no escape");
  assert.equal(editor.apply("exit", [{ x: 8, y: 1 }]).ok, false, "an exit sealed inside walls cannot be reached");
  s.running = true;
  assert.equal(editor.apply("wall", [{ x: 8, y: 4 }]).ok, false);
});

test("eight exits support widening, routing, blocking, and reset without losing labels", () => {
  const s = new Simulation(25), editor = new LayoutEditor(s);
  for (let i = 0; i < 6; i++)
    assert.equal(editor.apply("exit", [{ x: 2 + i * 2, y: 4 }]).ok, true);
  assert.deepEqual(s.grid.exitIds, EXIT_IDS);
  assert.equal(editor.apply("exit", [{ x: 15, y: 4 }]).ok, false);
  assert.equal(editor.apply("exit", [{ x: 3, y: 4 }], "C").ok, true);
  assert.equal(s.grid.exits("C").length, 2);
  assert.equal(editor.apply("exit", [{ x: 17, y: 4 }], "C").ok, false);
  assert.equal(findBestPath(s.grid, { x: 3, y: 5 })?.targetExit, "C");
  for (const id of EXIT_IDS.slice(0, -1)) assert.equal(s.setExitBlocked(id, true).ok, true);
  assert.equal(s.setExitBlocked("H", true).ok, false);
  assert.equal(findBestPath(s.grid, { x: 3, y: 5 })?.targetExit, "H");
  assert.equal(s.setExitBlocked("C", false).ok, true);
  assert.equal(findBestPath(s.grid, { x: 3, y: 5 })?.targetExit, "C");
  s.reset();
  assert.deepEqual(s.grid.exitIds, EXIT_IDS);
  assert.equal(s.grid.blockedExits.size, 0);
  assert.deepEqual(Array.from(s.metrics.byExit.keys()), EXIT_IDS);
});

for (const mode of ["shortest", "congestion"] as RoutingMode[])
  test(`${mode} evacuates a custom crowd through added exits with reproducible metrics`, () => {
    const s = new Simulation(137), editor = new LayoutEditor(s);
    s.mode = mode;
    assert.equal(editor.apply("exit", [{ x: 3, y: 4 }, { x: 4, y: 4 }]).ok, true);
    assert.equal(editor.apply("exit", [{ x: 16, y: 4 }, { x: 17, y: 4 }]).ok, true);
    // Spawn positions must be regenerated against the custom layout before comparison.
    s.reset();
    const finish = () => {
      s.running = true;
      for (let step = 0; step < 120 * 60 && s.running; step++) {
        s.update(1 / 60);
        if (step % 60 === 0)
          assert.ok(s.agents.every((a) => a.evacuated || !s.collision.intersectsWall(a.position, a.radius, s.grid)));
      }
      assert.equal(s.metrics.remainingAgents, 0);
      const records = Array.from(s.metrics.byExit);
      assert.equal(records.reduce((sum, [, r]) => sum + r.count, 0), 137);
      assert.ok(s.metrics.byExit.get("C")!.count > 0);
      assert.ok(s.metrics.byExit.get("D")!.count > 0);
      for (const [, record] of records) assert.equal(record.clear, record.last);
      return JSON.stringify([s.metrics, records, s.agents]);
    };
    const first = finish();
    s.reset();
    assert.equal(finish(), first);
  });

test("editing a paused run invalidates stale paths and closing a new exit reroutes its agents", () => {
  const s = new Simulation(50), editor = new LayoutEditor(s);
  s.running = true;
  for (let step = 0; step < 60; step++) s.update(1 / 60);
  s.running = false;
  const time = s.time, positions = s.agents.map((a) => ({ ...a.position }));
  assert.equal(editor.apply("exit", [{ x: 3, y: 4 }]).ok, true);
  assert.equal(s.time, time);
  assert.deepEqual(s.agents.map((a) => a.position), positions);
  assert.ok(s.agents.every((a) => a.path.length === 0 && a.queued));
  s.running = true;
  for (let step = 0; step < 30; step++) s.update(1 / 60);
  const users = s.agents.filter((a) => !a.evacuated && a.targetExit === "C");
  assert.ok(users.length > 0);
  assert.equal(s.setExitBlocked("C", true).ok, true);
  assert.ok(users.every((a) => a.path.length === 0 && a.queued));
  for (let step = 0; step < 120 * 60 && s.running; step++) s.update(1 / 60);
  assert.equal(s.metrics.remainingAgents, 0);
});

test("edited layouts stay separate when changing maps and returning from setup", () => {
  const e = new Experiment();
  e.begin(75, "shortest", "open", "mvp", false);
  assert.equal(new LayoutEditor(e.simulation).apply("exit", [{ x: 3, y: 4 }]).ok, true);
  e.showMenu();
  e.begin(75, "shortest", "open", "large", false);
  assert.deepEqual(e.simulation.grid.exitIds, ["A", "B"]);
  e.begin(75, "shortest", "open", "mvp", false);
  assert.deepEqual(e.simulation.grid.exitIds, ["A", "B", "C"]);
});

test("scheduled closure reports a skipped attempt if it would close the last escape", () => {
  const e = new Experiment();
  e.begin(25, "shortest", "closure", "mvp");
  assert.equal(e.simulation.setExitBlocked("B", true).ok, true);
  for (let step = 0; step < 301; step++) e.update(1 / 60);
  assert.equal(e.closureTriggered, true);
  assert.match(e.closureMessage, /at least one exit/);
  assert.equal(e.simulation.grid.exitABlocked, false);
});
