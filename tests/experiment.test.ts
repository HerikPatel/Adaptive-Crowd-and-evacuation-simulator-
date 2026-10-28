import { test } from "node:test";
import assert from "node:assert/strict";
import { Experiment } from "../src/simulation/Experiment";

const dt = 1 / 60;
const steps = (e: Experiment, count: number) => {
  for (let i = 0; i < count; i++) e.update(dt);
};

test("menu is idle and invalid settings do not replace an experiment", () => {
  const e = new Experiment();
  e.resume();
  steps(e, 60);
  assert.equal(e.screen, "menu");
  assert.equal(e.simulation.time, 0);
  e.begin(200, "shortest", "open");
  steps(e, 60);
  const before = JSON.stringify(e);
  assert.throws(() => e.begin(999, "congestion", "closure"));
  assert.throws(() => e.begin(100, "invalid" as "shortest", "open"));
  assert.throws(() => e.begin(100, "shortest", "invalid" as "open"));
  assert.throws(() => e.begin(100, "shortest", "open", "invalid" as "mvp"));
  assert.equal(JSON.stringify(e), before);
});

test("scheduled closure follows simulation time, fires once, and resets on replay", () => {
  const e = new Experiment();
  e.begin(100, "congestion", "closure", "mvp");
  steps(e, 300);
  assert.equal(e.closureTriggered, false);
  assert.equal(e.simulation.grid.exitABlocked, false);
  const pausedTime = e.simulation.time;
  e.pause();
  steps(e, 600);
  assert.equal(e.simulation.time, pausedTime);
  assert.equal(e.closureTriggered, false);
  e.resume();
  e.update(dt);
  assert.equal(e.closureTriggered, true);
  assert.equal(e.simulation.grid.exitABlocked, true);
  e.simulation.setExitABlocked(false);
  steps(e, 60);
  assert.equal(e.simulation.grid.exitABlocked, false);
  e.restart();
  assert.equal(e.simulation.time, 0);
  assert.equal(e.closureTriggered, false);
  assert.equal(e.simulation.running, false);
  assert.equal(e.scenario, "closure");
  e.resume();
  steps(e, 301);
  assert.equal(e.simulation.grid.exitABlocked, true);
});

test("complete runs enter results and replay reproduces the automatic scenario", () => {
  const e = new Experiment();
  e.begin(100, "congestion", "closure", "mvp");
  const initial = JSON.stringify(e.simulation.agents);
  const finish = () => {
    for (let i = 0; i < 120 * 60 && e.screen === "simulation"; i++) e.update(dt);
    assert.equal(e.screen, "results");
    assert.equal(e.simulation.metrics.remainingAgents, 0);
    assert.equal(e.simulation.metrics.exitBEvacuatedCount, 100);
    assert.equal(e.simulation.running, false);
    return JSON.stringify(e.simulation.metrics);
  };
  const first = finish();
  e.resume();
  steps(e, 60);
  assert.equal(JSON.stringify(e.simulation.metrics), first);
  e.restart(true);
  assert.equal(JSON.stringify(e.simulation.agents), initial);
  assert.equal(e.simulation.metrics.totalEvacuationTime, null);
  assert.equal(e.closureTriggered, false);
  assert.equal(finish(), first);
});

test("returning to setup stops a run and starting again applies fresh settings", () => {
  const e = new Experiment();
  e.begin(500, "shortest", "closure");
  steps(e, 90);
  e.showMenu();
  const before = JSON.stringify(e.simulation.agents);
  e.resume();
  steps(e, 600);
  assert.equal(e.simulation.running, false);
  assert.equal(JSON.stringify(e.simulation.agents), before);
  assert.equal(e.simulation.agentCount, 500);
  assert.equal(e.simulation.mapId, "large");
  e.begin(200, "congestion", "open", "mvp");
  assert.equal(e.simulation.time, 0);
  assert.equal(e.simulation.agents.length, 200);
  assert.equal(e.simulation.mode, "congestion");
  assert.equal(e.simulation.mapId, "mvp");
  assert.equal(e.simulation.grid.exitABlocked, false);
  assert.equal(e.closureTriggered, false);
  steps(e, 310);
  assert.equal(e.simulation.grid.exitABlocked, false);
});
