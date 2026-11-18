import { test } from "node:test";
import assert from "node:assert/strict";
import { Experiment } from "../src/simulation/Experiment";
import { Simulation } from "../src/simulation/Simulation";
import { CROWD, DEFAULT_CROWD } from "../src/config/simulationConfig";
import { ComparisonRun, comparisonVariants, validateRequest } from "../src/simulation/BuildingComparison";
import { distance } from "../src/utils/Vector2";

const finish = (e: Experiment, limit = 300) => { while (e.screen === "simulation" && e.simulation.time < limit) e.update(1 / 60); };

test("the default crowd is identical to a crowd with no mix at all", () => {
  const a = new Simulation(120, "large"), b = new Simulation(120, "large");
  b.crowd = { ...DEFAULT_CROWD };
  b.reset();
  assert.deepEqual(a.agents.map((x) => [x.position, x.speed]), b.agents.map((x) => [x.position, x.speed]));
  assert.equal(a.agents.some((x) => x.slow || x.groupId !== null), false);
});

test("the chosen share of people walk slower, and starting positions do not change", () => {
  const plain = new Simulation(200, "large"), mixed = new Simulation(200, "large");
  mixed.crowd = { slowShare: 0.2, groups: false };
  mixed.reset();
  const slow = mixed.agents.filter((a) => a.slow);
  assert.equal(slow.length, 40);
  for (const a of slow) assert.ok(Math.abs(a.baseSpeed - plain.agents[a.id].baseSpeed * CROWD.slowSpeedFactor) < 1e-9);
  assert.deepEqual(mixed.agents.map((a) => a.position), plain.agents.map((a) => a.position));
});

test("groups have 2-4 members who start close together", () => {
  const s = new Simulation(300, "large");
  s.crowd = { slowShare: 0, groups: true };
  s.reset();
  assert.ok(s.groups.size > 10);
  for (const [id, members] of s.groups) {
    assert.ok(members.length >= 2 && members.length <= CROWD.maxGroupSize);
    assert.equal(members[0].id, id);
    for (const m of members) {
      assert.equal(m.groupId, id);
      assert.ok(distance(m.position, members[0].position) <= CROWD.groupRadiusCells * s.grid.cellSize + 1e-9);
    }
  }
});

test("everyone in a group leaves by the same exit, and everyone evacuates", () => {
  for (const map of ["large", "mvp", "lecture", "corridor"] as const) {
    const e = new Experiment();
    e.simulation.crowd = { slowShare: 0.2, groups: true };
    e.begin(250, "congestion", "open", map, true);
    finish(e);
    assert.equal(e.simulation.metrics.remainingAgents, 0, map);
    for (const members of e.simulation.groups.values())
      assert.equal(new Set(members.map((m) => m.targetExit)).size, 1, map);
  }
});

test("slower walkers take longer on average than everyone else", () => {
  const e = new Experiment();
  e.simulation.crowd = { slowShare: 0.2, groups: false };
  e.begin(250, "congestion", "open", "large", true);
  finish(e);
  const summary = e.simulation.crowdSummary();
  assert.equal(summary.slowCount, 50);
  assert.ok(summary.slowMean! > summary.othersMean! * 1.2);
});

test("mixed crowds work with fire, the closure and every strategy, deterministically", () => {
  const once = (scenario: "fire" | "closure", mode: "shortest" | "flow-field") => {
    const e = new Experiment();
    e.simulation.crowd = { slowShare: 0.1, groups: true };
    e.begin(200, mode, scenario, "large", true);
    finish(e);
    return [e.simulation.metrics.remainingAgents, e.simulation.time];
  };
  for (const scenario of ["fire", "closure"] as const)
    for (const mode of ["shortest", "flow-field"] as const) {
      const [remaining, time] = once(scenario, mode);
      assert.equal(remaining, 0, `${scenario}/${mode}`);
      assert.deepEqual(once(scenario, mode), [remaining, time]);
    }
});

test("comparisons carry the crowd mix and report per-group times", () => {
  const request = { mapId: "large" as const, layout: null, population: 150, scenario: "open" as const, movement: "predictive" as const,
    crowd: { slowShare: 0.2, groups: true }, variants: comparisonVariants(["congestion"], ["astar"]), timeLimitSeconds: 300 };
  validateRequest(request);
  assert.throws(() => validateRequest({ ...request, crowd: { slowShare: 0.5, groups: true } }), /crowd mix/);
  const run = new ComparisonRun(request, request.variants[0]);
  while (!run.done) run.step(120);
  const r = run.result();
  assert.equal(r.evacuated, 150);
  assert.ok(r.groups > 0 && r.slowMeanSeconds! > r.othersMeanSeconds!);
});
