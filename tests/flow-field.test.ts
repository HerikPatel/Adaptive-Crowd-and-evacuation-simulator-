import { test } from "node:test";
import assert from "node:assert/strict";
import { CONFIG, EXIT_IDS } from "../src/config/simulationConfig";
import { buildFlowField, traceFlowField, SharedFlowFields } from "../src/pathfinding/SharedFlowField";
import { CongestionRouter } from "../src/pathfinding/CongestionRouter";
import { findPath } from "../src/pathfinding/AStar";
import { Grid, CellType } from "../src/simulation/Grid";
import { Agent } from "../src/simulation/Agent";
import { Simulation } from "../src/simulation/Simulation";
import { Experiment } from "../src/simulation/Experiment";
import { LayoutEditor } from "../src/simulation/LayoutEditor";
import { createMvpMap } from "../src/maps/mvpMap";
import { updateWithClearance } from "./helpers/gridClearance";
import type { GridPosition } from "../src/utils/Vector2";

function room() {
  const g = new Grid(16, 12);
  for (let y = 1; y < g.height - 1; y++) for (let x = 1; x < g.width - 1; x++) g.cells[g.index(x, y)] = CellType.Walkable;
  return g;
}
const costs = (g: Grid) => Float64Array.from(g.density, d => 1 + CONFIG.congestionWeight * d);
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);

test("reverse weighted fields match A* costs for every reachable cell and all eight exits", () => {
  const g = room();
  for (let y = 2; y < 10; y++) if (y !== 6) g.cells[g.index(7, y)] = CellType.Wall;
  EXIT_IDS.forEach((id, i) => g.placeExit(id, { x: 14, y: i + 1 }));
  g.placeExit("A", { x: 13, y: 1 }); // wide opening, multiple zero-cost sources
  for (let i = 0; i < g.density.length; i++) g.density[i] = ((i * 17) % 31) / 30;
  const entry = costs(g);
  for (const exit of EXIT_IDS) {
    const field = buildFlowField(g, exit, entry);
    assert.deepEqual(field, buildFlowField(g, exit, entry));
    for (let y = 0; y < g.height; y++) for (let x = 0; x < g.width; x++) {
      const start = { x, y }, expected = findPath(g, start, exit, "congestion"), route = traceFlowField(field, start);
      assert.equal(Boolean(route), Boolean(expected));
      if (!route || !expected) continue;
      near(route.totalCost, expected.totalCost);
      near(route.path.slice(1).reduce((sum, p) => sum + entry[g.index(p.x, p.y)], 0), expected.totalCost);
      assert.equal(g.exitAt(route.path.at(-1)!.x, route.path.at(-1)!.y), exit);
      for (let i = 1; i < route.path.length; i++) {
        const a: GridPosition = route.path[i - 1], b: GridPosition = route.path[i];
        assert.equal(Math.abs(a.x - b.x) + Math.abs(a.y - b.y), 1);
        assert.ok(g.walkable(b.x, b.y));
        assert.ok(field.integration[g.index(a.x, a.y)] > field.integration[g.index(b.x, b.y)]);
      }
    }
  }
});

test("fields charge the forward destination, handle blocked/unreachable goals, and never cut diagonal corners", () => {
  const g = new Grid(5, 5);
  g.cells[g.index(1, 1)] = CellType.Walkable;
  g.cells[g.index(2, 1)] = CellType.Walkable;
  g.cells[g.index(1, 3)] = CellType.Walkable;
  g.placeExit("A", { x: 3, y: 1 });
  g.placeExit("B", { x: 2, y: 2 });
  g.density[g.index(1, 1)] = 1;
  g.density[g.index(3, 1)] = 0.5;
  let field = buildFlowField(g, "A", costs(g));
  near(traceFlowField(field, { x: 1, y: 1 })!.totalCost, 3.5);
  assert.equal(traceFlowField(field, { x: 3, y: 1 })!.path.length, 1);
  for (const start of [{ x: 1, y: 3 }, { x: -1, y: 1 }, { x: 5, y: 0 }, { x: 1.5, y: 1 }])
    assert.equal(traceFlowField(field, start), null);
  g.setExitBlocked("A", true);
  field = buildFlowField(g, "A", costs(g));
  assert.ok(field.integration.every(v => v === Infinity));
  assert.equal(traceFlowField(field, { x: 3, y: 1 }), null);
});

test("one snapshot is shared across requests, density refreshes at 0.5 s, topology bypasses the interval", () => {
  const g = room(), fields = new SharedFlowFields();
  g.placeExit("A", { x: 14, y: 5 });
  fields.prepare(g, 0);
  const first = fields.field("A")!;
  g.density.fill(1);
  fields.prepare(g, 0.49);
  assert.equal(fields.field("A"), first);
  assert.equal(fields.builds, 1);
  near(fields.stepCost({ x: 2, y: 5 }), 1);
  fields.prepare(g, 0.5);
  const congested = fields.field("A")!;
  near(congested.integration[g.index(2, 5)], 4 * first.integration[g.index(2, 5)]);
  near(fields.stepCost({ x: 2, y: 5 }), 4);
  g.placeExit("B", { x: 2, y: 5 });
  fields.prepare(g, 0.51);
  assert.equal(fields.field("B")!.integration[g.index(2, 5)], 0);
  g.setExitBlocked("A", true);
  fields.prepare(g, 0.52);
  assert.equal(fields.field("A"), null);
  g.setExitBlocked("A", false);
  fields.prepare(g, 0.53);
  assert.ok(Number.isFinite(fields.field("A")!.integration[g.index(2, 5)]));
  const edited = g.cloneLayout();
  for (let y = 1; y < edited.height - 1; y++) edited.cells[edited.index(7, y)] = CellType.Wall;
  fields.prepare(edited, 0.54);
  assert.equal(traceFlowField(fields.field("A")!, { x: 2, y: 5 }), null);
  fields.prepare(g, 0.55); // undo to the original topology, same frame window
  assert.ok(traceFlowField(fields.field("A")!, { x: 2, y: 5 }));
});

test("shared routing retains exit commitment, but congestion and closures can change it", () => {
  const g = room(), router = new CongestionRouter(), start = { x: 7, y: 5 };
  g.placeExit("A", { x: 2, y: 5 });
  g.placeExit("B", { x: 13, y: 5 });
  const agent = new Agent(0, g.center(start), 48);
  agent.path = findPath(g, start, "B")!.path;
  agent.targetExit = "B";
  // A improves 6 steps to 5: >15%, so switch. Move A one cell left: 6 vs 6 retains B.
  assert.equal(router.plan(agent, g, "flow-field", 0)!.targetExit, "A");
  g.cells[g.index(2, 5)] = CellType.Walkable;
  g.placeExit("A", { x: 1, y: 5 });
  assert.equal(router.plan(agent, g, "flow-field", 0.01), null);
  g.setExitBlocked("B", true);
  assert.equal(router.plan(agent, g, "flow-field", 0.02)!.targetExit, "A");
  const mvp = createMvpMap(), at = { x: 27, y: 15 }, person = new Agent(1, mvp.center(at), 48);
  person.path = findPath(mvp, at, "A")!.path; person.targetExit = "A";
  for (let y = 9; y <= 14; y++) for (let x = 31; x <= 47; x++) mvp.density[mvp.index(x, y)] = 1;
  assert.equal(router.plan(person, mvp, "flow-field", 0.03)!.targetExit, "B");
});

test("1,000 route requests reuse two fields instead of 2,000 per-agent A* searches", t => {
  const s = new Simulation(1000, "large"), shared = new CongestionRouter(), baseline = new CongestionRouter();
  const started = performance.now();
  const actual = s.agents.map(a => shared.plan(a, s.grid, "flow-field", 0)!);
  const sharedMs = performance.now() - started, baselineStart = performance.now();
  const expected = s.agents.map(a => baseline.plan(a, s.grid, "congestion", 0)!);
  const baselineMs = performance.now() - baselineStart;
  actual.forEach((route, i) => { near(route.totalCost, expected[i].totalCost); assert.equal(route.targetExit, expected[i].targetExit); });
  assert.equal(shared.requests, 1000);
  assert.equal(shared.searches, 2);
  assert.equal(shared.flowFields.snapshots, 1);
  assert.equal(baseline.searches, 2000);
  t.diagnostic(JSON.stringify({ requests: 1000, sharedSearches: shared.searches, aStarSearches: baseline.searches, sharedMs, baselineMs,
    note: "Static initial-density routing only; timings depend on host load and are not browser FPS." }));
});

test("flow-field settings reset deterministically with ORCA and edits invalidate fields before rerouting", () => {
  const e = new Experiment(), s = e.simulation, initial = JSON.stringify(s.agents);
  e.begin(100, "flow-field", "open", "large", true, "orca");
  assert.equal(JSON.stringify(s.agents), initial);
  const advance = () => {
    for (let step = 0; step < 90; step++) e.update(1 / 60);
    return JSON.stringify([s.agents, s.router.requests, s.router.searches]);
  };
  const first = advance();
  assert.ok(s.orca.solves > 0);
  e.restart(true);
  assert.equal(s.router.searches, 0);
  assert.equal(s.mode, "flow-field"); assert.equal(s.movementMode, "orca");
  assert.equal(advance(), first);
  e.begin(50, "flow-field", "open", "mvp", true);
  for (let step = 0; step < 45; step++) e.update(1 / 60);
  e.pause();
  const editor = new LayoutEditor(s), builds = s.router.searches;
  assert.ok(editor.apply("wall", [{ x: 20, y: 13 }]).ok);
  assert.ok(editor.apply("exit", [{ x: 3, y: 4 }]).ok);
  assert.ok(s.agents.every(a => a.path.length === 0));
  s.processReplans();
  assert.equal(s.router.searches, builds + 3);
  assert.ok(s.agents.some(a => a.targetExit === "C"));
  assert.ok(s.setExitBlocked("C", true).ok);
  assert.ok(s.agents.filter(a => a.targetExit === "C").every(a => a.path.length === 0));
  s.processReplans();
  assert.equal(s.router.searches, builds + 5);
  assert.ok(s.agents.every(a => a.path.every(p => s.grid.walkable(p.x, p.y))));
});

for (const [map, count, movement, closure] of [
  ["mvp", 100, "predictive", false], ["mvp", 100, "orca", true],
  ["large", 500, "predictive", false], ["large", 500, "predictive", true],
  ["large", 500, "orca", true], ["large", 1000, "orca", false],
] as const) test(`shared flow field ${map} ${count} ${movement} closure=${closure} clears with body/wall/speed checks`, t => {
  const s = new Simulation(count, map);
  s.mode = "flow-field"; s.movementMode = movement; s.running = true;
  let closureAt: number | null = null, rejectedClosures = 0;
  for (let step = 0; step < 180 * 60 && s.running; step++) {
    if (closure && step >= 8 * 60 && closureAt === null) {
      const before = s.agents.map(a => ({ ...a.position }));
      const result = s.setExitABlocked(true);
      if (result.ok) closureAt = s.time;
      else {
        // Closing a doorway must never squeeze overlapping bodies into its approach.
        assert.match(result.message, /agent is in this doorway/);
        assert.equal(s.grid.exitABlocked, false);
        assert.deepEqual(s.agents.map(a => a.position), before);
        rejectedClosures++;
      }
    }
    updateWithClearance(s);
  }
  t.diagnostic(JSON.stringify({ map, count, movement, closure, seconds: s.time, remaining: s.metrics.remainingAgents,
    closureAt, rejectedClosures, requests: s.router.requests, fieldBuilds: s.router.searches, snapshots: s.router.flowFields.snapshots }));
  if (closure) assert.notEqual(closureAt, null);
  assert.equal(s.metrics.remainingAgents, 0);
});
