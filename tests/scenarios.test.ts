import { test } from "node:test";
import assert from "node:assert/strict";
import { Simulation } from "../src/simulation/Simulation";
function run(
  count: number,
  block: boolean,
  mode: "shortest" | "congestion" = "congestion",
  blockStep = 300,
) {
  const s = new Simulation(count);
  s.mode = mode;
  const switches = new Uint8Array(count);
  s.running = true;
  for (let step = 0; step < 180 * 60 && s.running; step++) {
    if (block && step === blockStep) s.setExitABlocked(true);
    const targets = s.agents.map((a) => a.targetExit);
    s.update(1 / 60);
    for (const a of s.agents)
      if (targets[a.id] && targets[a.id] !== a.targetExit) {
        switches[a.id]++;
        assert.ok(
          switches[a.id] <= 4,
          `agent ${a.id} oscillates between exits`,
        );
      }
    if (step % 30 === 0)
      for (const a of s.agents)
        if (!a.evacuated)
          assert.ok(
            !s.collision.intersectsWall(a.position, a.radius, s.grid),
            `agent ${a.id} penetrates a wall`,
          );
  }
  return s;
}
test("100 agents finish a normal evacuation without wall penetration", () => {
  const s = run(100, false);
  assert.equal(
    s.agents.filter((a) => !a.evacuated).length,
    0,
    JSON.stringify(s.agents.filter((a) => !a.evacuated).slice(0, 3)),
  );
  assert.equal(s.metrics.evacuatedCount, 100);
  assert.equal(s.metrics.remainingAgents, 0);
  assert.equal(
    s.metrics.exitAEvacuatedCount + s.metrics.exitBEvacuatedCount,
    100,
  );
  assert.ok(s.metrics.totalEvacuationTime);
  assert.ok(s.metrics.peakDensity > 0);
  assert.ok(s.metrics.averageEvacuationTime <= s.metrics.totalEvacuationTime!);
  assert.ok(
    s.metrics.exitAEvacuatedCount > 0 && s.metrics.exitBEvacuatedCount > 0,
  );
  assert.equal(
    s.metrics.timeToClearExitA,
    Math.max(
      ...s.agents
        .filter((a) => a.targetExit === "A")
        .map((a) => a.evacuationTime!),
    ),
  );
  assert.equal(
    s.metrics.timeToClearExitB,
    Math.max(
      ...s.agents
        .filter((a) => a.targetExit === "B")
        .map((a) => a.evacuationTime!),
    ),
  );
});
test("100 agents finish after Exit A closes at five seconds", () => {
  const s = run(100, true);
  assert.equal(
    s.agents.filter((a) => !a.evacuated).length,
    0,
    JSON.stringify(s.agents.filter((a) => !a.evacuated).slice(0, 3)),
  );
  assert.ok(s.agents.every((a) => a.targetExit === "B"));
});
for (const count of [200, 500])
  test(`${count} agents complete stress scenario`, (t) => {
    const s = run(count, false);
    t.diagnostic(
      JSON.stringify({
        count,
        time: s.time,
        remaining: s.metrics.remainingAgents,
        A: s.metrics.exitAEvacuatedCount,
        B: s.metrics.exitBEvacuatedCount,
        switches: s.routeSwitchCount,
      }),
    );
    assert.equal(s.metrics.remainingAgents, 0);
  });
test("reset restores identical seed, positions, metrics, doors, density and queue", () => {
  const s = new Simulation(100);
  const initial = JSON.stringify(s.agents);
  s.running = true;
  for (let i = 0; i < 90; i++) s.update(1 / 60);
  const state = JSON.stringify(s.agents);
  s.setExitABlocked(true);
  s.reset();
  assert.equal(JSON.stringify(s.agents), initial);
  assert.equal(s.time, 0);
  assert.equal(s.grid.exitABlocked, false);
  assert.ok(s.grid.density.every((d) => d === 0));
  assert.equal(s.metrics.evacuatedCount, 0);
  s.running = true;
  for (let i = 0; i < 90; i++) s.update(1 / 60);
  assert.equal(JSON.stringify(s.agents), state);
});
test("500 agents evacuate after a late closure requires reversing through A branch", () => {
  const s = run(500, true, "congestion", 12 * 60);
  assert.equal(s.metrics.remainingAgents, 0);
  assert.ok(
    s.agents
      .filter((a) => a.targetExit === "A")
      .every((a) => a.evacuationTime! <= 12),
  );
});
test("shortest-path mode also completes a 200-agent run", () => {
  const s = run(200, false, "shortest");
  assert.equal(s.metrics.remainingAgents, 0);
});
