import { test } from "node:test";
import assert from "node:assert/strict";
import { STADIUM } from "../src/maps/stadium";
import { createStadiumNetwork, intersectsStadiumField, validateStadiumNetwork } from "../src/maps/stadiumNavigation";
import { StadiumRouter } from "../src/pathfinding/StadiumRouter";

test("every stadium section has a continuous, surface-aware route to each exterior gate", () => {
  const router = new StadiumRouter();
  assert.deepEqual(validateStadiumNetwork(router.network), []);
  assert.equal(router.connectivity().reachable.length, 72);
  for (const section of STADIUM.sections) for (const gate of STADIUM.gates) {
    const route = router.route(section.id, gate.id);
    assert.ok(route, `${section.id} to ${gate.id}`);
    assert.equal(route.gateId, gate.id);
    assert.ok(route.freeFlowSeconds > 0 && route.assumedWalkMeters > 0 && route.transferSeconds > 0);
    let current = router.network.sectionNodes[section.id];
    const visited = new Set([current]);
    for (const step of route.steps) {
      assert.equal(step.from, current);
      const edge = router.edges.get(step.edgeId)!;
      assert.ok((edge.from === step.from && edge.to === step.to) || (edge.direction === "both" && edge.to === step.from && edge.from === step.to));
      assert.equal(intersectsStadiumField(edge.points), false);
      const from = router.nodes.get(step.from)!, to = router.nodes.get(step.to)!;
      if (from.surfaceId !== to.surfaceId) assert.ok(edge.transfer || edge.kind === "gate");
      if (to.surfaceId.startsWith("upper")) assert.equal(to.surfaceId, section.surfaceId);
      assert.ok(!visited.has(step.to), "route must not loop");
      visited.add(step.to); current = step.to;
    }
    assert.equal(current, router.network.gateNodes[gate.id]);
    assert.equal(router.edges.get(route.steps.at(-1)!.edgeId)!.kind, "gate");
    const expected = section.surfaceId === "upper-east" ? "ramp-east" : section.surfaceId === "upper-west" ? "ramp-west" : null;
    if (expected) assert.ok(route.steps.some(s => s.edgeId === expected));
  }
});

test("closures disconnect only the affected deck and cannot escape through overlapping drawing geometry", () => {
  const router = new StadiumRouter();
  router.setClosed("ramp-east", true);
  assert.deepEqual(router.connectivity().disconnected, STADIUM.sections.filter(s => s.surfaceId === "upper-east").map(s => s.id));
  assert.equal(router.route("section-217"), null);
  assert.ok(router.route("section-201"));
  router.setClosed("ramp-west", true);
  assert.equal(router.connectivity().disconnected.length, 28);
  // The west gate approach visually overlaps the west deck but is not a neighbor.
  assert.equal(router.route("section-207", "gate-west"), null);
  assert.ok(router.route("section-101", "gate-west"));
  router.reset();
  assert.equal(router.connectivity().reachable.length, 72);
  for (const gate of STADIUM.gates) router.setClosed(gate.id, true);
  assert.equal(router.connectivity().disconnected.length, 72);
  assert.equal(router.route("section-101"), null);
});

test("routes find alternatives when a gate or a lower-bowl opening closes", () => {
  const router = new StadiumRouter();
  const original = router.route("section-101")!;
  router.setClosed(original.gateId, true);
  const alternative = router.route("section-101")!;
  assert.ok(alternative);
  assert.notEqual(alternative.gateId, original.gateId);
  assert.equal(router.route("section-101", original.gateId), null);
  router.reset();
  router.setClosed("passage-101", true);
  const nextOpening = router.route("section-101");
  assert.ok(nextOpening);
  assert.ok(!nextOpening.steps.some(s => s.edgeId === "passage-101"));
  assert.equal(router.connectivity().disconnected.length, 0);
  for (const edge of router.controls) if (edge.transfer) router.setClosed(edge.id, true);
  assert.equal(router.connectivity().disconnected.length, 72);
});

test("assumed transfer time affects route cost; capacities and invalid edits never silently change measured data", () => {
  const router = new StadiumRouter();
  const original = router.route("section-217", "gate-north")!;
  const measured = JSON.stringify(STADIUM);
  router.setParameters("ramp-east", { travelSeconds: 90, capacityPerSecond: 0.5 });
  const changed = router.route("section-217", "gate-north")!;
  assert.ok(Math.abs(changed.freeFlowSeconds - original.freeFlowSeconds - 60) < 1e-8);
  assert.deepEqual(router.parameters("ramp-east"), { travelSeconds: 90, capacityPerSecond: 0.5 });
  for (const travelSeconds of [NaN, Infinity, 0, -1, 3601]) assert.throws(() => router.setParameters("ramp-east", { travelSeconds, capacityPerSecond: 1 }));
  for (const capacityPerSecond of [NaN, Infinity, 0, -1, 101]) assert.throws(() => router.setParameters("ramp-east", { travelSeconds: 30, capacityPerSecond }));
  assert.deepEqual(router.parameters("ramp-east"), { travelSeconds: 90, capacityPerSecond: 0.5 });
  assert.throws(() => router.setParameters("gate-east", { travelSeconds: 30, capacityPerSecond: 1 }));
  assert.throws(() => router.setClosed("elevator-101", true));
  assert.equal(JSON.stringify(STADIUM), measured);
  router.reset();
  assert.deepEqual(router.route("section-217", "gate-north"), original);
  assert.deepEqual(new StadiumRouter().route("section-217", "gate-north"), original);
});

test("network validation rejects missing endpoints, floor shortcuts, field routes and invalid transfer limits", () => {
  const network = createStadiumNetwork();
  const broken = structuredClone(network);
  broken.edges[0].to = "missing-node";
  assert.ok(validateStadiumNetwork(broken).some(e => e.includes("missing endpoint")));
  const jump = structuredClone(network);
  jump.nodes.find(n => n.id === jump.edges[0].to)!.surfaceId = "upper-west";
  assert.ok(validateStadiumNetwork(jump).some(e => e.includes("one interior surface")));
  const field = structuredClone(network);
  field.edges[0].points.splice(1, 0, { x: 600, y: 440 });
  assert.ok(validateStadiumNetwork(field).some(e => e.includes("intersects the field")));
  const invalid = structuredClone(network);
  invalid.edges.find(e => e.transfer)!.transfer!.capacityPerSecond = 0;
  assert.throws(() => new StadiumRouter(invalid), /positive time and capacity/);
});
