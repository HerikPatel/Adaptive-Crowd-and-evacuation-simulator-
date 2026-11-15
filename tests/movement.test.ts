import { test } from "node:test";
import assert from "node:assert/strict";
import { Agent } from "../src/simulation/Agent";
import { SpatialHash } from "../src/simulation/SpatialHash";
import { Simulation } from "../src/simulation/Simulation";
import { CollisionSystem } from "../src/collision/CollisionSystem";
import { motionsClear } from "../src/collision/PredictiveMotion";
import { createMvpMap } from "../src/maps/mvpMap";
import { StadiumRouter } from "../src/pathfinding/StadiumRouter";
import { StadiumSimulation, STADIUM_STEP, type StadiumMovement, type StadiumTravel } from "../src/simulation/StadiumSimulation";
import { StadiumCorridor } from "../src/collision/StadiumCorridor";
import { DiscReservations } from "../src/collision/DiscReservations";
import { bodyRadius, walkingSpeed } from "../src/simulation/PersonProfile";
import { updateWithClearance } from "./helpers/gridClearance";
import { Grid, CellType } from "../src/simulation/Grid";

test("grid reservations prevent between-frame crossings, not just final-position overlaps", () => {
  const grid = createMvpMap(), collision = new CollisionSystem(), hash = new SpatialHash<Agent>(32);
  const a = new Agent(0, { x: 100, y: 120 }, 100, 0), b = new Agent(1, { x: 130, y: 100 }, 100, 0);
  hash.insert(a); hash.insert(b);
  const movements = collision.reserveMovements([{ agent: a, position: { x: 150, y: 120 } }, { agent: b, position: { x: 130, y: 140 } }], [a, b], hash, grid, 1, 0);
  assert.ok(motionsClear(a.position, movements[0].position, b.position, movements[1].position, a.radius + b.radius));
  assert.ok(!motionsClear(a.position, { x: 150, y: 120 }, b.position, { x: 130, y: 140 }, a.radius + b.radius));
});

test("head-on walkers anticipate one another, pass, and retain clearance throughout each step", () => {
  const grid = createMvpMap(), collision = new CollisionSystem(), hash = new SpatialHash<Agent>(32);
  const agents = [new Agent(0, { x: 100, y: 150 }, 48, 0), new Agent(1, { x: 300, y: 150 }, 48, 0)];
  const goals = [{ x: 300, y: 150 }, { x: 100, y: 150 }];
  for (let tick = 0; tick < 1200; tick++) {
    hash.clear(); agents.forEach(a => hash.insert(a));
    const before = agents.map(a => ({ ...a.position }));
    const moves = agents.map((a, i) => ({ agent: a, position: Math.hypot(a.position.x - goals[i].x, a.position.y - goals[i].y) < 2 ? a.position : collision.move(a, collision.velocity(a, collision.direction(a, goals[i]), hash, grid), 1 / 60, grid) }));
    const reserved = collision.reserveMovements(moves, agents, hash, grid, 1 / 60, tick);
    for (const { agent: a, position } of reserved) {
      a.velocity = { x: (position.x - a.position.x) * 60, y: (position.y - a.position.y) * 60 };
      a.stalledSeconds = Math.hypot(a.velocity.x, a.velocity.y) < 0.1 * a.speed ? a.stalledSeconds + 1 / 60 : 0;
      a.position = position;
      assert.ok(!collision.intersectsWall(position, a.radius, grid));
    }
    assert.ok(motionsClear(before[0], agents[0].position, before[1], agents[1].position, agents[0].radius + agents[1].radius));
  }
  for (const [i, a] of agents.entries()) assert.ok(Math.hypot(a.position.x - goals[i].x, a.position.y - goals[i].y) < 2);
});

test("a touching queue advances together without depending on agent order", () => {
  const grid = createMvpMap(), collision = new CollisionSystem(), hash = new SpatialHash<Agent>(32);
  const agents = Array.from({ length: 5 }, (_, id) => new Agent(id, { x: 100 + id * 9.1, y: 150 }, 48));
  agents.forEach(a => hash.insert(a));
  for (const order of [agents, [...agents].reverse()]) {
    const reserved = collision.reserveMovements(order.map(a => ({ agent: a, position: { x: a.position.x + 0.8, y: a.position.y } })), order, hash, grid, 1 / 60, 0);
    for (const { agent, position } of reserved) assert.ok(Math.abs(position.x - agent.position.x - 0.8) < 1e-6);
  }
});

test("a packed doorway rejects closure atomically instead of overlapping relocated bodies", () => {
  const s = new Simulation(6), grid = new Grid(7, 3, 20);
  for (let x = 1; x <= 5; x++) grid.cells[grid.index(x, 1)] = CellType.Walkable;
  grid.placeExit("A", { x: 1, y: 1 }); grid.placeExit("B", { x: 5, y: 1 });
  s.grid = grid; s.agents = [41, 50, 60, 70, 80, 90].map((x, id) => new Agent(id, { x, y: 30 }, 48));
  const before = JSON.stringify(s.agents), revision = grid.layoutRevision;
  assert.equal(s.setExitABlocked(true).ok, false);
  assert.equal(grid.exitABlocked, false); assert.equal(grid.layoutRevision, revision);
  assert.equal(JSON.stringify(s.agents), before);
  s.agents.slice(1).forEach(a => { a.evacuated = true; });
  assert.equal(s.setExitABlocked(true).ok, true);
  assert.ok(!s.collision.intersectsWall(s.agents[0].position, s.agents[0].radius, grid));
});

test("agents yield around rounded doorway corners so the center walker can enter", () => {
  const s = new Simulation(3, "large"), cornerX = 100 + Math.sqrt(4.3 ** 2 - 1.8 ** 2);
  s.agents = [new Agent(0, { x: cornerX, y: 221.8 }, 48), new Agent(1, { x: 106.6, y: 230 }, 48), new Agent(2, { x: cornerX, y: 238.2 }, 48)];
  s.replanQueue = []; s.agents.forEach(a => s.enqueue(a)); s.running = true;
  for (let tick = 0; tick < 600 && s.running; tick++) updateWithClearance(s);
  assert.equal(s.metrics.remainingAgents, 0);
});

test("dense grid evacuation and a live closure preserve hard clearance and finish", () => {
  const s = new Simulation(100); s.running = true;
  for (let tick = 0; tick < 10800 && s.running; tick++) {
    if (tick === 300) assert.ok(s.setExitABlocked(true).ok);
    updateWithClearance(s);
  }
  assert.equal(s.metrics.remainingAgents, 0);
});

function stagedPassing(mode: StadiumMovement, narrow = false, oncoming = false) {
  const router = new StadiumRouter(), edge = router.edges.get("concourse-ring-45")!;
  if (narrow) edge.widthMeters = 2.4;
  const s = new StadiumSimulation(router, { count: oncoming ? 3 : 2, profileMode: "uniform", movementMode: mode });
  s.setProfile(0, { ...s.spectators[0].profile, speedOverride: 0.45 });
  s.setProfile(1, { ...s.spectators[1].profile, speedOverride: 1.8 });
  s.spectators[0].state = { kind: "walking", step: { edgeId: edge.id, from: edge.from, to: edge.to }, distance: 3.5, enteredAt: 0, duration: 0 };
  s.spectators[1].state = { kind: "walking", step: { edgeId: edge.id, from: edge.from, to: edge.to }, distance: 2.3, enteredAt: 0, duration: 0 };
  if (oncoming) s.spectators[2].state = { kind: "walking", step: { edgeId: edge.id, from: edge.to, to: edge.from }, distance: 2.3, enteredAt: 0, duration: 0 };
  return { s, edge, corridor: new StadiumCorridor(edge) };
}

test("wide-corridor passing clears a slow walker, respects oncoming traffic and speed, and merges before a junction", () => {
  const { s, edge, corridor } = stagedPassing("passing", false, true);
  s.start(); let shifted = false, returned = false;
  for (let tick = 0; tick < 18000 && s.running; tick++) {
    const before = s.spectators.map(p => ({ at: s.position(p), state: structuredClone(p.state) }));
    if (tick === 90) s.router.setClosed("gate-east", true); // a route closure during passing must preserve the maneuver
    s.update(STADIUM_STEP);
    const bodies = new DiscReservations();
    for (const p of s.spectators) {
      if (p.state.kind === "evacuated") continue;
      const position = s.position(p), at = { x: position.x * 0.2, y: position.y * 0.2 }, radius = bodyRadius(p.profile);
      const zone = p.state.kind === "transfer" ? `transfer:${p.state.step.edgeId}` : s.surfaceOf(p)!;
      assert.ok(bodies.fits(p.id, zone, at, radius), `body overlap at ${s.time}`); bodies.set(p.id, zone, at, radius);
      if (p.state.kind === "walking" && p.state.step.edgeId === edge.id) {
        assert.ok(Math.abs(0.4 + (p.state.lateral ?? 0)) + radius < edge.widthMeters! / 2);
        const old = before[p.id];
        if (old.state.kind === "walking" && old.state.step.edgeId === edge.id) assert.ok(Math.hypot(position.x - old.at.x, position.y - old.at.y) * 0.2 <= walkingSpeed(p.profile) * STADIUM_STEP + 1e-5, "lateral motion consumes the speed budget");
        shifted ||= (p.state.lateral ?? 0) > 0.7;
      }
    }
    // Same-corridor walkers must stay separated between rendered positions too.
    for (const p of s.spectators) for (const q of s.spectators) {
      if (q.id <= p.id) continue;
      const oldP = before[p.id], oldQ = before[q.id];
      if (oldP.state.kind !== "walking" || oldQ.state.kind !== "walking" || p.state.kind !== "walking" || q.state.kind !== "walking" ||
          [oldP.state.step.edgeId, oldQ.state.step.edgeId, p.state.step.edgeId, q.state.step.edgeId].some(id => id !== edge.id)) continue;
      const meters = (at: { x: number; y: number }) => ({ x: at.x * 0.2, y: at.y * 0.2 });
      assert.ok(motionsClear(meters(oldP.at), meters(s.position(p)), meters(oldQ.at), meters(s.position(q)), bodyRadius(p.profile) + bodyRadius(q.profile)), "passing sweep clearance");
    }
    const fast = s.spectators[1].state;
    if (shifted && fast.kind !== "walking") returned = true;
  }
  assert.ok(corridor.supportsPassing(bodyRadius(s.spectators[1].profile)));
  assert.ok(shifted); assert.ok(returned); assert.ok(s.completedPasses >= 1); assert.ok(s.complete);
  s.reset(); assert.equal(s.completedPasses, 0); assert.equal(s.passAttempts, 0);
});

test("queue mode and narrow corridors do not allow overtaking", () => {
  for (const [mode, narrow] of [["queue", false], ["passing", true]] as const) {
    const { s, edge } = stagedPassing(mode, narrow); s.start();
    for (let i = 0; i < 900 && s.running; i++) {
      s.update(STADIUM_STEP);
      const slow = s.spectators[0].state, fast = s.spectators[1].state;
      if (slow.kind === "walking" && fast.kind === "walking" && slow.step.edgeId === edge.id && fast.step.edgeId === edge.id)
        assert.ok(fast.distance < slow.distance);
    }
    assert.equal(s.passAttempts, 0); assert.equal(s.completedPasses, 0);
  }
});
