import { test } from "node:test";
import assert from "node:assert/strict";
import { OrcaSolver, pairConstraint, solveVelocity, violation, type OrcaLine } from "../src/collision/OrcaSolver";
import { Agent } from "../src/simulation/Agent";
import { SpatialHash } from "../src/simulation/SpatialHash";
import { Grid, CellType } from "../src/simulation/Grid";
import { Simulation } from "../src/simulation/Simulation";
import { Experiment } from "../src/simulation/Experiment";
import { motionsClear } from "../src/collision/PredictiveMotion";
import { CollisionSystem } from "../src/collision/CollisionSystem";
import { updateWithClearance } from "./helpers/gridClearance";

const dt = 1 / 60;
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);
const norm = (p: { x: number; y: number }) => Math.hypot(p.x, p.y);
function openGrid() {
  const grid = new Grid(30, 20, 20);
  for (let y = 1; y < grid.height - 1; y++) for (let x = 1; x < grid.width - 1; x++) grid.cells[grid.index(x, y)] = CellType.Walkable;
  return grid;
}

test("ORCA velocity LP finds the closest feasible velocity and respects static constraints when infeasible", () => {
  const lines: OrcaLine[] = [
    { point: { x: 1, y: 0 }, direction: { x: 0, y: 1 } }, // x <= 1
    { point: { x: 0, y: 2 }, direction: { x: -1, y: 0 } }, // y <= 2
  ];
  const result = solveVelocity(lines, 0, 5, { x: 4, y: 4 });
  assert.ok(result.feasible); near(result.velocity.x, 1); near(result.velocity.y, 2);
  const circle = solveVelocity([], 0, 5, { x: 6, y: 8 });
  near(circle.velocity.x, 3); near(circle.velocity.y, 4);
  const opposing: OrcaLine[] = [
    { point: { x: 0, y: 0 }, direction: { x: 0, y: -1 } }, // static x >= 0
    { point: { x: -2, y: 0 }, direction: { x: 0, y: 1 } }, // impossible x <= -2
  ];
  const crowded = solveVelocity(opposing, 1, 1, { x: 1, y: 0 });
  assert.equal(crowded.feasible, false);
  assert.ok(violation(opposing[0], crowded.velocity) <= 1e-6);
  assert.ok(norm(crowded.velocity) <= 1 + 1e-6);
  // Parallel and nearly parallel constraints must not divide by zero.
  const parallel = solveVelocity([...lines, { point: { x: 0.5, y: 0 }, direction: { x: 1e-12, y: 1 } }], 0, 5, { x: 4, y: 4 });
  assert.ok(parallel.feasible); near(parallel.velocity.x, 0.5);
});

test("reciprocal ORCA constraints avoid both cutoff-circle and cone-leg collisions over the horizon", () => {
  for (const speed of [0, 10]) {
    const a = { id: 0, position: { x: 0, y: 0 }, velocity: { x: speed, y: 0 }, radius: 1 };
    const b = { id: 1, position: { x: 20, y: 0 }, velocity: { x: -speed, y: 0 }, radius: 1 };
    const horizon = 2, ab = pairConstraint(a, b, dt, horizon), ba = pairConstraint(b, a, dt, horizon);
    const av = solveVelocity([ab], 0, 10, { x: 10, y: 0 });
    const bv = solveVelocity([ba], 0, 10, { x: -10, y: 0 });
    assert.ok(av.feasible && bv.feasible);
    assert.ok(motionsClear(a.position, { x: av.velocity.x * horizon, y: av.velocity.y * horizon },
      b.position, { x: 20 + bv.velocity.x * horizon, y: bv.velocity.y * horizon }, 2));
    near(av.velocity.x, -bv.velocity.x); near(av.velocity.y, -bv.velocity.y);
  }
  const a = { id: 0, position: { x: 0, y: 0 }, velocity: { x: 0, y: 0 }, radius: 1 };
  const b = { ...a, id: 1 };
  const ab = pairConstraint(a, b, dt, 1), ba = pairConstraint(b, a, dt, 1);
  assert.ok(Number.isFinite(norm(ab.point))); near(ab.point.x, -ba.point.x);
});

test("ORCA alone lets head-on walkers pass with continuous clearance and individual speed limits", () => {
  const grid = openGrid(), solver = new OrcaSolver(), collision = new CollisionSystem(), hash = new SpatialHash<Agent>(32);
  const agents = [new Agent(0, { x: 120, y: 180 }, 48), new Agent(1, { x: 360, y: 180 }, 36)];
  const goals = [{ x: 360, y: 180 }, { x: 120, y: 180 }];
  for (let step = 0; step < 1200; step++) {
    hash.clear(); agents.forEach(a => hash.insert(a));
    const before = agents.map(a => ({ ...a.position }));
    // No contact projection: verifies ORCA's proposals themselves, from one snapshot.
    const velocities = agents.map((a, i) => solver.velocity(a, norm({ x: a.position.x - goals[i].x, y: a.position.y - goals[i].y }) < 2
      ? { x: 0, y: 0 } : collision.direction(a, goals[i]), hash, grid, dt, 48));
    agents.forEach((a, i) => {
      assert.ok(norm(velocities[i]) <= a.speed + 1e-6);
      a.position = { x: a.position.x + velocities[i].x * dt, y: a.position.y + velocities[i].y * dt };
      a.velocity = velocities[i];
      assert.ok(collision.canTravel(before[i], a.position, a.radius, grid));
    });
    assert.ok(motionsClear(before[0], agents[0].position, before[1], agents[1].position, agents[0].radius + agents[1].radius));
  }
  agents.forEach((a, i) => assert.ok(norm({ x: a.position.x - goals[i].x, y: a.position.y - goals[i].y }) < 2));
});

test("ORCA wall constraints allow tangential movement and react immediately to edited walls", () => {
  const grid = openGrid(), solver = new OrcaSolver(), hash = new SpatialHash<Agent>(32), collision = new CollisionSystem();
  const a = new Agent(0, { x: 155.7, y: 150 }, 48);
  hash.insert(a);
  const free = solver.velocity(a, { x: 1, y: 0 }, hash, grid, dt, 48);
  near(free.x, 48);
  grid.cells[grid.index(8, 7)] = CellType.Wall;
  const blocked = solver.velocity(a, { x: 1, y: 0 }, hash, grid, dt, 48);
  assert.ok(blocked.x <= 1e-6);
  const along = solver.velocity(a, { x: 0, y: 1 }, hash, grid, dt, 48);
  assert.ok(along.y > 47.9);
  assert.ok(collision.canTravel(a.position, { x: a.position.x + along.x * dt, y: a.position.y + along.y * dt }, a.radius, grid));
});

test("ORCA settings preserve the seed, reject invalid modes atomically, and reproduce reset trajectories", () => {
  const e = new Experiment(), initial = JSON.stringify(e.simulation.agents);
  e.begin(100, "congestion", "open", "large", true, "orca");
  assert.equal(JSON.stringify(e.simulation.agents), initial);
  const advance = () => { for (let i = 0; i < 180; i++) e.update(dt); return JSON.stringify(e.simulation.agents); };
  const first = advance(), before = JSON.stringify(e);
  assert.ok(e.simulation.orca.solves > 0);
  assert.throws(() => e.begin(5, "shortest", "open", "mvp", true, "invalid" as "orca"));
  assert.equal(JSON.stringify(e), before);
  e.restart(true); assert.equal(e.simulation.movementMode, "orca");
  assert.equal(e.simulation.orca.solves, 0);
  assert.equal(advance(), first);
  e.begin(100, "congestion", "open", "large", false, "predictive");
  assert.equal(JSON.stringify(e.simulation.agents), initial);
});

test("clear-step shortcut retains safe motion but still rejects crossing, overspeed and wall penetration", () => {
  const grid = openGrid(), collision = new CollisionSystem(), hash = new SpatialHash<Agent>(32);
  const agents = [new Agent(0, { x: 100, y: 150 }, 48), new Agent(1, { x: 109, y: 150 }, 48)];
  agents.forEach(a => hash.insert(a));
  const advance = collision.reserveMovements(agents.map(agent => ({ agent, position: { x: agent.position.x + 0.8, y: 150 } })), agents, hash, grid, dt, 0, true);
  advance.forEach(({ agent, position }) => near(position.x - agent.position.x, 0.8));
  for (const [seconds, targets] of [
    [1, [{ x: 109, y: 150 }, { x: 100, y: 150 }]],
    [dt, [{ x: 200, y: 150 }, { x: 209, y: 150 }]],
    [2, [{ x: 5, y: 150 }, { x: 109, y: 150 }]],
  ] as const) {
    const moves = collision.reserveMovements(agents.map((agent, i) => ({ agent, position: targets[i] })), agents, hash, grid, seconds, 0, true);
    assert.ok(motionsClear(agents[0].position, moves[0].position, agents[1].position, moves[1].position, agents[0].radius + agents[1].radius));
    for (const { agent, position } of moves) {
      assert.ok(norm({ x: position.x - agent.position.x, y: position.y - agent.position.y }) <= agent.speed * seconds + 1e-7);
      assert.ok(collision.canTravel(agent.position, position, agent.radius, grid));
    }
  }
});

for (const [map, count, closure] of [
  ["mvp", 100, false], ["mvp", 100, true], ["mvp", 500, true], ["large", 500, false], ["large", 500, true], ["large", 1000, false],
] as const) test(`ORCA ${map} ${count} closure=${closure} completes with hard body, wall and speed checks`, t => {
  const s = new Simulation(count, map); s.movementMode = "orca"; s.running = true;
  for (let step = 0; step < 180 * 60 && s.running; step++) {
    if (closure && step === 8 * 60) assert.ok(s.setExitABlocked(true).ok);
    updateWithClearance(s);
  }
  t.diagnostic(JSON.stringify({ map, count, closure, seconds: s.time, remaining: s.metrics.remainingAgents, solves: s.orca.solves, infeasible: s.orca.infeasible }));
  assert.equal(s.metrics.remainingAgents, 0);
});
