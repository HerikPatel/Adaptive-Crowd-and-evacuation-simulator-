import assert from "node:assert/strict";
import { motionsClear } from "../../src/collision/PredictiveMotion";
import { Simulation } from "../../src/simulation/Simulation";
import { SpatialHash } from "../../src/simulation/SpatialHash";

/** Includes agents that exit this step, and checks the whole simultaneous motion. */
export function updateWithClearance(s: Simulation, dt = 1 / 60) {
  const before = s.agents.filter(a => !a.evacuated).map(agent => ({ id: agent.id, position: { ...agent.position }, agent }));
  const hash = new SpatialHash<(typeof before)[number]>(32);
  before.forEach(p => hash.insert(p));
  const travel = Math.max(0, ...before.map(p => p.agent.speed * dt));
  const radius = Math.max(0, ...before.map(p => p.agent.radius));
  s.update(dt);
  for (const p of before) {
    const a = p.agent;
    assert.ok(Math.hypot(a.position.x - p.position.x, a.position.y - p.position.y) <= a.speed * dt + 1e-7, `speed budget: ${a.id} at ${s.time}`);
    assert.ok(s.collision.canTravel(p.position, a.position, a.radius, s.grid), `wall sweep: ${a.id} at ${s.time}`);
    for (const q of hash.query(p.position, a.radius + radius + 2 * travel)) {
      if (q.id <= p.id) continue;
      assert.ok(motionsClear(p.position, a.position, q.position, q.agent.position, a.radius + q.agent.radius), `body sweep: ${a.id}/${q.id} at ${s.time}`);
    }
  }
}
