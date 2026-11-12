import { test } from "node:test";
import assert from "node:assert/strict";
import { STADIUM, type SurfaceId } from "../src/maps/stadium";
import { StadiumRouter } from "../src/pathfinding/StadiumRouter";
import { StadiumSimulation, STADIUM_STEP } from "../src/simulation/StadiumSimulation";

function advance(s: StadiumSimulation, seconds: number) {
  for (let i = 0; i < Math.ceil(seconds / STADIUM_STEP); i++) s.update(STADIUM_STEP);
}
function finish(s: StadiumSimulation, limit = 1200) {
  s.start();
  for (let i = 0; i < limit / STADIUM_STEP && s.running; i++) {
    s.update(STADIUM_STEP);
    if (i % 30 === 0) {
      const m = s.snapshot();
      assert.equal(m.onSurface + m.inTransfer + m.evacuated, m.population);
      assert.equal(Object.values(m.surfaces).reduce((a, b) => a + b, 0), m.onSurface);
      for (const p of s.spectators) {
        const pos = s.position(p);
        assert.ok(Number.isFinite(pos.x) && Number.isFinite(pos.y));
      }
    }
  }
  assert.ok(s.complete, `${s.time.toFixed(1)}s: ${JSON.stringify(s.spectators.filter(p => p.state.kind !== "evacuated").slice(0, 5))}`);
}

test("100 spectators traverse all levels without loss; only exterior gates count as evacuated", () => {
  const s = new StadiumSimulation();
  const start = s.snapshot();
  assert.equal(start.population, 100);
  assert.equal(start.onSurface, 100);
  assert.ok(start.surfaces["lower-bowl"] && start.surfaces["upper-east"] && start.surfaces["upper-west"]);
  finish(s);
  const events = s.events.filter(e => e.kind === "evacuate");
  assert.equal(events.length, 100);
  assert.equal(new Set(events.map(e => e.personId)).size, 100);
  assert.ok(events.every(e => STADIUM.gates.some(g => g.id === e.edgeId)));
  assert.equal(Object.values(s.snapshot().exits).reduce((a, b) => a + b, 0), 100);
  assert.equal(s.running, false);
});

test("transfer entry rates, transit duration, and queue backpressure are enforced", () => {
  const r = new StadiumRouter();
  r.setParameters("ramp-east", { travelSeconds: 8, capacityPerSecond: 0.2 });
  const s = new StadiumSimulation(r, { count: 12, sections: ["section-217"] });
  s.start();
  let sawQueue = false, sawTransfer = false;
  for (let i = 0; i < 15000 && s.running; i++) {
    s.update(STADIUM_STEP);
    const snapshot = i % 10 === 0 ? s.snapshot() : null;
    if (snapshot) { sawQueue ||= snapshot.transfers["ramp-east"].waiting > 0; sawTransfer ||= snapshot.inTransfer > 0; }
  }
  assert.ok(s.complete); assert.ok(sawQueue); assert.ok(sawTransfer);
  const entries = s.events.filter(e => e.edgeId === "ramp-east" && e.kind === "enter");
  assert.equal(entries.length, 12);
  for (let i = 1; i < entries.length; i++) assert.ok(entries[i].time - entries[i - 1].time >= 5 - 1e-7);
  for (const enter of entries) {
    const leave = s.events.find(e => e.kind === "leave" && e.edgeId === enter.edgeId && e.personId === enter.personId)!;
    assert.ok(leave.time - enter.time >= 8 - 1e-7);
    const evacuation = s.events.find(e => e.kind === "evacuate" && e.personId === enter.personId)!;
    assert.ok(evacuation.time > leave.time);
  }
});

test("closures strand only disconnected surfaces; reopening resumes from unchanged positions", () => {
  const r = new StadiumRouter(); r.setClosed("ramp-west", true);
  const s = new StadiumSimulation(r, { count: 20, sections: ["section-201", "section-101"] });
  s.start(); advance(s, 600);
  assert.equal(s.snapshot().evacuated, 10);
  assert.equal(s.snapshot().stranded, 10);
  assert.equal(s.blocked, true); assert.equal(s.running, false);
  const before = s.spectators.filter(p => p.stranded).map(p => s.position(p));
  r.setClosed("ramp-west", false); s.refreshRoutes();
  assert.deepEqual(s.spectators.filter(p => p.sectionId === "section-201").map(p => s.position(p)), before);
  finish(s);
});

test("closing an occupied ramp stops admissions but lets admitted people finish on the correct surface", () => {
  const r = new StadiumRouter();
  const s = new StadiumSimulation(r, { count: 12, sections: ["section-217"] }); s.start();
  for (let i = 0; i < 9000 && !s.events.some(e => e.edgeId === "ramp-east" && e.kind === "enter"); i++) s.update(STADIUM_STEP);
  const admitted = s.events.filter(e => e.edgeId === "ramp-east" && e.kind === "enter").map(e => e.personId);
  assert.ok(admitted.length > 0);
  const inFlight = s.spectators.find(p => p.id === admitted[0])!;
  assert.equal(s.surfaceOf(inFlight), null);
  r.setClosed("ramp-east", true);
  // New assumptions cannot shorten journeys already in progress.
  r.setParameters("ramp-east", { travelSeconds: 0.1, capacityPerSecond: 100 });
  advance(s, 600);
  assert.equal(s.events.filter(e => e.edgeId === "ramp-east" && e.kind === "enter").length, admitted.length);
  assert.equal(s.snapshot().evacuated, admitted.length);
  const enter = s.events.find(e => e.personId === admitted[0] && e.kind === "enter" && e.edgeId === "ramp-east")!;
  const leave = s.events.find(e => e.personId === admitted[0] && e.kind === "leave" && e.edgeId === "ramp-east")!;
  assert.ok(leave.time - enter.time >= 30 - 1e-7);
  r.setClosed("ramp-east", false); finish(s);
});

test("pause and reset preserve reproducibility; invalid reset leaves the current run intact", () => {
  const s = new StadiumSimulation(undefined, { count: 20 });
  const initial = JSON.stringify(s.spectators);
  s.start(); advance(s, 60); s.pause();
  const paused = JSON.stringify([s.time, s.spectators, s.events]);
  advance(s, 5); assert.equal(JSON.stringify([s.time, s.spectators, s.events]), paused);
  assert.throws(() => s.reset({ count: 0 }));
  assert.throws(() => s.reset({ count: 10, sections: ["unknown"] }));
  assert.equal(JSON.stringify([s.time, s.spectators, s.events]), paused);
  s.reset(); assert.equal(JSON.stringify(s.spectators), initial);
  s.start(); advance(s, 60); assert.equal(JSON.stringify([s.time, s.spectators, s.events]), paused);
});

test("walkers stay on their own graph surface until an explicit transfer or gate", () => {
  const s = new StadiumSimulation(undefined, { count: 72 }); s.start();
  const previous = new Map<number, SurfaceId | null>(s.spectators.map(p => [p.id, s.surfaceOf(p)]));
  for (let i = 0; i < 12000 && s.running; i++) {
    s.update(STADIUM_STEP);
    for (const p of s.spectators) {
      const before = previous.get(p.id), after = s.surfaceOf(p);
      if (before !== after && before !== null && after !== null) assert.equal(after, "exterior");
      previous.set(p.id, after);
    }
  }
  assert.ok(s.complete);
});

test("a busy landing delays transfer arrivals without losing people or overtaking", () => {
  const r = new StadiumRouter();
  const s = new StadiumSimulation(r, { count: 100, sections: STADIUM.sections.filter(section => section.surfaceId === "upper-east").map(section => section.id) });
  s.start();
  for (let i = 0; i < 9000 && s.events.filter(e => e.edgeId === "ramp-east" && e.kind === "enter").length < 3; i++) s.update(STADIUM_STEP);
  assert.ok(s.events.filter(e => e.edgeId === "ramp-east" && e.kind === "enter").length >= 3);
  // The first arrival cannot leave the landing while every gate is closed.
  for (const gate of STADIUM.gates) r.setClosed(gate.id, true);
  advance(s, 45);
  assert.ok(s.snapshot().inTransfer > 0);
  assert.ok(s.spectators.some(p => p.state.kind === "transfer" && p.waiting));
  assert.equal(s.snapshot().evacuated, 0);
  assert.equal(s.snapshot().onSurface + s.snapshot().inTransfer, 100);
  for (const gate of STADIUM.gates) r.setClosed(gate.id, false);
  finish(s);
  const enters = s.events.filter(e => e.edgeId === "ramp-east" && e.kind === "enter");
  const leaves = s.events.filter(e => e.edgeId === "ramp-east" && e.kind === "leave");
  assert.deepEqual(leaves.map(e => e.personId), enters.map(e => e.personId));
  assert.ok(leaves.some((e, i) => e.time - enters[i].time > 30 + STADIUM_STEP * 2), "landing occupancy must delay an arrival");
});

test("the maximum 1000-person preset clears without graph merge deadlocks", () => {
  const s = new StadiumSimulation(undefined, { count: 1000 });
  finish(s, 1800);
});

test("a gate closure reroutes moving crowds without admitting new people to that gate", () => {
  const r = new StadiumRouter();
  const s = new StadiumSimulation(r, { count: 200 }); s.start(); advance(s, 35);
  const closureTime = s.time;
  const admitted = new Set(s.spectators.filter(p => p.state.kind === "walking" && p.state.step.edgeId === "gate-east").map(p => p.id));
  r.setClosed("gate-east", true);
  finish(s);
  for (const event of s.events.filter(e => e.kind === "evacuate" && e.edgeId === "gate-east" && e.time > closureTime))
    assert.ok(admitted.has(event.personId));
  assert.ok(s.snapshot().exits["gate-north"] > 0);
});

test("reducing capacity during a paused run immediately sets the next admission interval", () => {
  const r = new StadiumRouter();
  const s = new StadiumSimulation(r, { count: 20, sections: ["section-217"] }); s.start();
  for (let i = 0; i < 9000 && !s.events.some(e => e.edgeId === "ramp-east" && e.kind === "enter"); i++) s.update(STADIUM_STEP);
  s.pause();
  const priorEntries = s.events.filter(e => e.edgeId === "ramp-east" && e.kind === "enter").length;
  assert.ok(priorEntries > 0);
  r.setParameters("ramp-east", { travelSeconds: 30, capacityPerSecond: 0.1 });
  finish(s);
  const entries = s.events.filter(e => e.edgeId === "ramp-east" && e.kind === "enter");
  for (let i = priorEntries; i < entries.length; i++) assert.ok(entries[i].time - entries[i - 1].time >= 10 - 1e-7);
});
