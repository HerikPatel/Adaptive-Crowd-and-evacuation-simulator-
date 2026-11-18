import { test } from "node:test";
import assert from "node:assert/strict";
import { ComparisonRun, comparisonCsv, comparisonVariants, validateRequest, type ComparisonRequest } from "../src/simulation/BuildingComparison";
import { Simulation } from "../src/simulation/Simulation";
import { LayoutEditor } from "../src/simulation/LayoutEditor";
import { serializeLayout } from "../src/simulation/LayoutFile";

const base = (over: Partial<ComparisonRequest> = {}): ComparisonRequest => ({
  mapId: "mvp", layout: null, population: 60, scenario: "open", movement: "predictive",
  variants: comparisonVariants(["shortest", "congestion"], ["astar", "thetastar"]), timeLimitSeconds: 300, ...over,
});
const runToEnd = (request: ComparisonRequest, i: number) => {
  const run = new ComparisonRun(request, request.variants[i]);
  while (!run.done) run.step(120);
  return run;
};

test("variants: every strategy × algorithm, flow field once", () => {
  const v = comparisonVariants(["shortest", "congestion", "flow-field"], ["astar", "dijkstra", "thetastar"]);
  assert.equal(v.length, 7);
  assert.deepEqual(v.at(-1), { mode: "flow-field", algorithm: null });
});

test("requests are validated", () => {
  assert.doesNotThrow(() => validateRequest(base()));
  assert.throws(() => validateRequest(base({ variants: [] })), /at least one/);
  assert.throws(() => validateRequest(base({ timeLimitSeconds: 5 })), /30 to 1,800/);
  assert.throws(() => validateRequest(base({ mapId: "moon" as "mvp" })), /Unknown building/);
});

test("all variants start from identical positions (matched seed)", () => {
  const r = base();
  const starts = r.variants.map((v) => new ComparisonRun(r, v).experiment.simulation.agents.map((a) => `${a.position.x},${a.position.y}`).join(";"));
  assert.ok(starts.every((s) => s === starts[0]));
});

test("a run evacuates everyone and reports per-exit counts that add up", () => {
  const run = runToEnd(base(), 0), result = run.result();
  assert.equal(result.status, "complete");
  assert.equal(result.evacuated, 60);
  assert.ok(result.totalEvacuationSeconds! > 0);
  assert.equal(Object.values(result.byExit).reduce((a, b) => a + b!, 0), 60);
  assert.equal(result.label, "Shortest Path · A* (4-way grid)");
});

test("comparisons are deterministic: the same variant gives the same result twice", () => {
  const a = runToEnd(base(), 1).result(), b = runToEnd(base(), 1).result();
  assert.equal(a.totalEvacuationSeconds, b.totalEvacuationSeconds);
  assert.deepEqual(a.byExit, b.byExit);
});

test("an edited layout is compared as edited, and the closure scenario applies", () => {
  const s = new Simulation(60, "mvp");
  assert.ok(new LayoutEditor(s).apply("obstacle", [{ x: 27, y: 9 }]).ok);
  const request = base({ layout: serializeLayout(s.grid, "mvp"), scenario: "closure", variants: comparisonVariants(["flow-field"], []) });
  const run = new ComparisonRun(request, request.variants[0]);
  assert.equal(run.experiment.simulation.grid.walkable(27, 9), false);
  while (!run.done) run.step(120);
  const result = run.result();
  assert.equal(result.layout, "edited");
  assert.equal(result.evacuated, 60);
  assert.equal(run.experiment.simulation.grid.blockedExits.has("A"), true);
  assert.ok(result.exitAClosedSeconds! > 4.99, `closed at ${result.exitAClosedSeconds}`);
});

test("a run that hits the time limit is reported as timed out", () => {
  const request = base({ timeLimitSeconds: 30, population: 1000, mapId: "large" });
  const result = runToEnd(request, 0).result();
  assert.equal(result.status, "timed out");
  assert.equal(result.totalEvacuationSeconds, null);
  assert.ok(result.evacuated < 1000);
});

test("the CSV has one row per run with stable, quoted columns", () => {
  const r = base();
  const results = [runToEnd(r, 0).result(), runToEnd(r, 2).result()];
  const lines = comparisonCsv(results).trim().split("\n");
  assert.equal(lines.length, 3);
  assert.match(lines[0], /^map,layout,routing_strategy,algorithm,local_movement,scenario,population,slower_walkers_share,groups,seed,status,evacuated,total_evacuation_s,mean_evacuation_s,elapsed_s,exit_A_closed_s,exit_A_count,exit_B_count,slow_mean_evacuation_s,others_mean_evacuation_s,route_switches,peak_density,compute_ms$/);
  assert.match(lines[1], /^Original bottleneck · 50 × 30,preset,Shortest Path,A\* \(4-way grid\),predictive,All exits open,60,0,0,549,complete,60,/);
});

test("CSV cells with commas or quotes are escaped", () => {
  const r = runToEnd(base(), 0).result();
  const csv = comparisonCsv([{ ...r, map: 'Hall, "B"' }]);
  assert.match(csv.split("\n")[1], /^"Hall, ""B""",/);
});
