import { test } from "node:test";
import assert from "node:assert/strict";
import { Simulation } from "../src/simulation/Simulation";
import { MAPS } from "../src/maps/maps";
import { findPath } from "../src/pathfinding/AStar";

test("large map has distributed, wall-free spawns and separated reachable exits", () => {
  const s = new Simulation(500, "large");
  assert.equal(s.grid.width, 70);
  assert.equal(s.grid.height, 42);
  for (const area of MAPS.large.spawnAreas) {
    const occupants = s.agents.filter(
      (a) =>
        a.position.x >= area.x1 - 1 &&
        a.position.x <= area.x2 + 1 &&
        a.position.y >= area.y1 - 1 &&
        a.position.y <= area.y2 + 1,
    );
    assert.ok(occupants.length > 70);
    for (const exit of ["A", "B"] as const)
      assert.ok(findPath(s.grid, s.grid.cell(occupants[0].position), exit));
  }
  for (const a of s.agents)
    assert.ok(!s.collision.intersectsWall(a.position, a.radius, s.grid));
  assert.equal(s.grid.exits("A")[0].x, 2);
  assert.equal(s.grid.exits("B")[0].y, 39);
  const initial = JSON.stringify(s.agents);
  s.setExitABlocked(true);
  s.reset();
  assert.equal(JSON.stringify(s.agents), initial);
  assert.equal(s.mapId, "large");
});

test("west-facing door closure pushes a touching circle back onto valid floor", () => {
  const s = new Simulation(1, "large"),
    a = s.agents[0];
  a.position = { x: 61, y: 230 };
  a.targetExit = "A";
  assert.ok(!s.collision.intersectsWall(a.position, a.radius, s.grid));
  s.setExitABlocked(true);
  assert.ok(a.position.x > 64);
  assert.ok(!s.collision.intersectsWall(a.position, a.radius, s.grid));
});

for (const [count, blocked] of [
  [100, false],
  [500, false],
  [500, true],
  [1000, false],
] as const)
  test(`large map evacuates ${count} agents with closure=${blocked}`, (t) => {
    const s = new Simulation(count, "large");
    s.running = true;
    for (let step = 0; step < 180 * 60 && s.running; step++) {
      if (blocked && step === 8 * 60) s.setExitABlocked(true);
      s.update(1 / 60);
      if (step % 60 === 0)
        for (const a of s.agents)
          if (!a.evacuated)
            assert.ok(
              !s.collision.intersectsWall(a.position, a.radius, s.grid),
            );
    }
    t.diagnostic(
      JSON.stringify({
        time: s.time,
        remaining: s.metrics.remainingAgents,
        A: s.metrics.exitAEvacuatedCount,
        B: s.metrics.exitBEvacuatedCount,
      }),
    );
    assert.equal(s.metrics.remainingAgents, 0);
    if (!blocked)
      assert.ok(
        s.metrics.exitAEvacuatedCount > 0 && s.metrics.exitBEvacuatedCount > 0,
      );
    else
      assert.ok(
        s.agents
          .filter((a) => a.targetExit === "A")
          .every((a) => a.evacuationTime! <= 8),
      );
  });
