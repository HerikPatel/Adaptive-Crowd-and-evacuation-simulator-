import { test } from "node:test";
import assert from "node:assert/strict";
import { StadiumRouter, routeStepKey } from "../src/pathfinding/StadiumRouter";
import { StadiumTrafficRouter, shouldSwitchRoute } from "../src/pathfinding/StadiumTrafficRouter";
import { StadiumSimulation, STADIUM_STEP, type StadiumSpectator } from "../src/simulation/StadiumSimulation";
import { createProfile, bodyRadius } from "../src/simulation/PersonProfile";
import { DiscReservations } from "../src/collision/DiscReservations";
import { corridorsConflict } from "../src/collision/StadiumJunctions";
import { experimentJobs, StadiumExperimentRun, resultsCsv, samplesCsv } from "../src/simulation/StadiumExperiment";

test("conflicting schematic stair approaches are recognized without adding graph links", () => {
  const r = new StadiumRouter(), a = r.edges.get("section-136-aisle")!, b = r.edges.get("stairs-south-east-entry")!;
  assert.equal(corridorsConflict(a, b), true);
  assert.equal(corridorsConflict(a, r.edges.get("section-101-aisle")!), false);
  assert.equal(corridorsConflict(a, r.edges.get("lower-bowl-ring-16")!), false, "explicit common-node junction already has a reservation");
  const network = JSON.stringify(r.network);
  new StadiumSimulation(r, { count: 1 });
  assert.equal(JSON.stringify(r.network), network);
});

test("a crowded physical section aisle and stair approach both clear without body overlap", () => {
  const r = new StadiumRouter();
  for (const edge of r.controls) if (edge.kind === "passage") r.setClosed(edge.id, true);
  const s = new StadiumSimulation(r, { count: 30, sections: ["section-135"], routingMode: "adaptive", profileMode: "uniform" });
  s.start();
  for (let i = 0; i < 36000 && s.running; i++) {
    s.update(STADIUM_STEP);
    const bodies = new DiscReservations();
    for (const p of s.spectators) {
      if (p.state.kind === "evacuated") continue;
      const pos = s.physicalSample(p).position, at = { x: pos.x, y: pos.z };
      const zone = p.state.kind === "transfer" ? `transfer:${p.state.step.edgeId}` : p.state.kind === "seated"
        ? `seats:${s.surfaceOf(p)!}` : p.state.kind === "approaching" ? `approach:${p.sectionId}` : s.surfaceOf(p)!;
      assert.ok(bodies.fits(p.id, zone, at, bodyRadius(p.profile)), `crossing overlap at ${s.time}`);
      bodies.set(p.id, zone, at, bodyRadius(p.profile));
    }
  }
  assert.ok(s.complete, `crossing stall at ${s.time}`);
  assert.ok(s.events.some(e => e.kind === "enter" && e.edgeId === "stairs-south-east"));
});

test("shared potentials match free-flow shortest times; dynamic delay changes the exit", () => {
  const r = new StadiumRouter(), potential = r.potential();
  for (const node of Object.values(r.network.sectionNodes)) {
    const base = r.routeFromNode(node)!, shared = r.routeFromPotential(node, potential, {})!;
    assert.ok(Math.abs(base.freeFlowSeconds - shared.freeFlowSeconds) < 1e-7);
  }
  const node = r.edges.get("gate-east")!.from, base = r.routeFromNode(node)!;
  const delays = new Map([[routeStepKey(base.steps.at(-1)!), 1000]]);
  const alternative = r.routeFromPotential(node, r.potential({ delays }), { delays })!;
  assert.notEqual(alternative.gateId, base.gateId);
  assert.ok(alternative.freeFlowSeconds > base.freeFlowSeconds);
  assert.ok(alternative.estimatedSeconds < r.routeSeconds(base.steps, { delays }));
  r.setClosed(alternative.gateId, true);
  assert.ok(!r.routeFromPotential(node, r.potential({ delays }), { delays })!.steps.some(s => r.isClosed(s.edgeId)));
});

test("observed queues trigger a worthwhile switch only after cooldown; closures bypass it", () => {
  const r = new StadiumRouter(), traffic = new StadiumTrafficRouter(r, "adaptive"), nodeId = r.edges.get("gate-east")!.from;
  const people: StadiumSpectator[] = Array.from({ length: 500 }, (_, id) => ({ id, sectionId: "section-101", seat: { x: 0, y: 0 }, profile: createProfile(549, id, "uniform"), state: { kind: "node", nodeId }, waiting: true, stranded: false }));
  traffic.sample(people, 0);
  for (const p of people) assert.equal(traffic.choose(p, nodeId, 0)!.gateId, "gate-east");
  traffic.sample(people, 2);
  assert.equal(traffic.queues.get(`gate-east:${nodeId}`), 500);
  assert.equal(traffic.choose(people[0], nodeId, 2)!.gateId, "gate-east");
  const alternate = traffic.choose(people[0], nodeId, 10)!;
  assert.notEqual(alternate.gateId, "gate-east"); assert.equal(traffic.switches, 1);
  assert.ok(traffic.searches <= 2, "same speed band shares a potential");
  r.setClosed(alternate.gateId, true); traffic.sample(people, 10.1);
  assert.ok(!traffic.choose(people[0], nodeId, 10.1)!.steps.some(s => r.isClosed(s.edgeId)));
  assert.equal(traffic.forcedReroutes, 1);
  assert.equal(shouldSwitchRoute(100, 90), false); assert.equal(shouldSwitchRoute(10, 8), false);
  assert.equal(shouldSwitchRoute(100, 80), true);
});

test("adaptive mixed crowds keep body clearance and population conservation after a gate closure", () => {
  const s = new StadiumSimulation(undefined, { count: 100, routingMode: "adaptive" }); s.start();
  let closed = false;
  let admitted = new Set<number>();
  for (let i = 0; i < 18000 && s.running; i++) {
    if (!closed && s.time >= 35 - 1e-8) {
      admitted = new Set(s.spectators.filter(p => p.state.kind === "walking" && p.state.step.edgeId === "gate-east").map(p => p.id));
      s.router.setClosed("gate-east", true); closed = true;
    }
    s.update(STADIUM_STEP);
    const bodies = new DiscReservations();
    for (const p of s.spectators) {
      if (p.state.kind === "evacuated") continue;
      const zone = p.state.kind === "transfer" ? `transfer:${p.state.step.edgeId}` : p.state.kind === "seated"
        ? `seats:${s.surfaceOf(p)!}` : p.state.kind === "approaching" ? `approach:${p.sectionId}` : s.surfaceOf(p)!;
      const pos = s.physicalSample(p).position, at = { x: pos.x, y: pos.z };
      assert.ok(bodies.fits(p.id, zone, at, bodyRadius(p.profile)), `overlap at ${s.time}, person ${p.id}`);
      bodies.set(p.id, zone, at, bodyRadius(p.profile));
    }
    if (i % 30 === 0) { const m = s.snapshot(); assert.equal(m.onSurface + m.inTransfer + m.evacuated, 100); }
  }
  assert.ok(s.complete, `not complete at ${s.time}: ${JSON.stringify(s.snapshot())}`);
  assert.ok(s.snapshot().trafficSnapshots > 1);
  assert.ok(s.snapshot().meanWaitingSeconds >= 0);
  for (const e of s.events.filter(e => e.kind === "evacuate" && e.edgeId === "gate-east" && e.time > 35 + 1e-8)) assert.ok(admitted.has(e.personId));
});

test("voluntary reroutes never retrace a departed node; closure recovery may retrace it", () => {
  const r = new StadiumRouter(), delays = new Map([[routeStepKey({ edgeId: "gate-east", from: r.edges.get("gate-east")!.from, to: "" }), 10000]]);
  const congested = r.potential({ delays });
  const route = r.network.nodes.map(n => r.routeFromNode(n.id)).find(route => route?.gateId === "gate-east" && route.steps.length >= 2 &&
    r.routeFromPotential(route.steps[0].to, congested, { delays })?.steps.some(s => s.to === route.steps[0].from))!;
  assert.ok(route, "the ring supplies a case where the cheapest detour initially doubles back");
  const first = route.steps[0], traffic = new StadiumTrafficRouter(r, "adaptive");
  const p: StadiumSpectator = { id: 0, sectionId: "section-101", seat: { x: 0, y: 0 }, profile: createProfile(549, 0, "uniform"), state: { kind: "node", nodeId: first.from }, waiting: true, stranded: false };
  traffic.sample([], 0); traffic.choose(p, first.from, 0); traffic.depart(0, first);
  for (const [key, value] of delays) traffic.delays.set(key, value);
  traffic.sample([], 10);
  assert.equal(traffic.choose(p, first.to, 10)!.gateId, "gate-east");
  assert.equal(traffic.switches, 0);
  r.setClosed("gate-east", true); traffic.sample([], 10.1);
  const recovered = traffic.choose(p, first.to, 10.1)!;
  assert.notEqual(recovered.gateId, "gate-east");
  assert.ok(recovered.steps.some(s => s.to === first.from));
});

test("adaptive crowds resume after all exits are reopened and reset clears traffic history", () => {
  const r = new StadiumRouter(); for (const id of Object.keys(r.network.gateNodes)) r.setClosed(id, true);
  const s = new StadiumSimulation(r, { count: 8, routingMode: "adaptive" });
  assert.equal(s.blocked, true); const seats = s.spectators.map(p => p.seat);
  r.reset(); s.start();
  for (let i = 0; i < 18000 && s.running; i++) s.update(STADIUM_STEP);
  assert.ok(s.complete); assert.ok(s.navigation.snapshots > 1);
  s.reset(); assert.equal(s.navigation.switches, 0); assert.equal(s.waitingPersonSeconds, 0);
  assert.deepEqual(s.spectators.map(p => p.seat), seats);
  assert.ok([...s.navigation.delays.values()].every(n => n === 0));
});

test("comparison matrix pairs identical seats; repeated runs and CSV preserve reproducibility", () => {
  const jobs = experimentJobs({ populations: [8], seeds: [549] }); assert.equal(jobs.length, 8);
  const runs = jobs.map(job => new StadiumExperimentRun(job));
  const seats = runs[0].simulation.spectators.map(p => p.seat);
  for (const run of runs) assert.deepEqual(run.simulation.spectators.map(p => p.seat), seats);
  const run = runs[7]; while (!run.done) run.step();
  const again = new StadiumExperimentRun(jobs[7]); while (!again.done) again.step();
  const stable = ({ computeMs: _a, maxStepMs: _b, ...rest }: ReturnType<StadiumExperimentRun["result"]>) => rest;
  assert.equal(run.result().status, "complete"); assert.deepEqual(stable(run.result()), stable(again.result()));
  assert.deepEqual(run.simulation.events, again.simulation.events);
  const summary = resultsCsv([run.result()]);
  assert.ok(summary.includes('"gate-east"')); assert.ok(summary.includes('"east-closure"'));
  assert.equal(summary.trim().split("\r\n").length, 2);
  const samples = samplesCsv([run.result()]); assert.equal(samples.trim().split("\r\n").length, run.samples.length + 1);
  assert.equal(run.samples.at(-1)!.evacuated, 8);
  assert.throws(() => experimentJobs({ populations: [100, 100], seeds: [549] }));
  assert.throws(() => experimentJobs({ populations: [1001], seeds: [549] }));
});

test("timeouts export missing completion times, never a successful evacuation", () => {
  const run = new StadiumExperimentRun({ population: 5, seed: 549, routing: "adaptive", profile: "mixed", scenario: "open" }, 1);
  while (!run.done) run.step();
  const r = run.result(); assert.equal(r.status, "timeout"); assert.equal(r.totalEvacuationSeconds, null); assert.equal(r.meanExitSeconds, null);
  assert.equal(r.timeLimitSeconds, 1); assert.equal(r.evacuated, 0);
  assert.ok(resultsCsv([r]).includes('"timeout"'));
});

test("disconnected experiment reports blocked instead of completion", () => {
  const run = new StadiumExperimentRun({ population: 5, seed: 549, routing: "adaptive", profile: "mixed", scenario: "open" });
  for (const id of Object.keys(run.simulation.router.network.gateNodes)) run.simulation.router.setClosed(id, true);
  run.step();
  assert.equal(run.done, true); assert.equal(run.result().status, "blocked");
  assert.equal(run.result().totalEvacuationSeconds, null); assert.equal(run.samples.at(-1)!.stranded, 5);
});
