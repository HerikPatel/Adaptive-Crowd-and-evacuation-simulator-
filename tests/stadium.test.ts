import { test } from "node:test";
import assert from "node:assert/strict";
import { STADIUM, STADIUM_FEATURES, STADIUM_SURFACES, STADIUM_SOURCES, featureOnLayer } from "../src/maps/stadium";
import { Experiment } from "../src/simulation/Experiment";

test("stadium preserves public section ranges and gate names without filling numbering gaps", () => {
  const labels = (surface: string) => STADIUM.sections.filter(s => s.surfaceId === surface).map(s => Number(s.label));
  const range = (first: number, length: number) => Array.from({ length }, (_, i) => first + i);
  assert.deepEqual(labels("lower-bowl"), range(101, 44));
  assert.deepEqual(labels("upper-west"), range(201, 14));
  assert.deepEqual(labels("upper-east"), range(217, 14));
  assert.deepEqual(STADIUM.gates.map(g => [g.side, [...g.gateNames]]), [
    ["West", ["A", "B"]], ["North", ["C", "D"]], ["East", ["E"]], ["South", ["G", "H"]],
  ]);
  // Published orientation has east above the field and north to its left.
  const at = (label: string) => STADIUM.sections.find(s => s.label === label)!.at;
  assert.ok(at("217").y < at("121").y && at("121").y < at("110").y);
  assert.ok(at("110").x < at("101").x);
  assert.ok(at("117").x < at("138").x);
});

test("schematic geometry and cross-surface references are valid without inventing movement parameters", () => {
  assert.equal(new Set(STADIUM_FEATURES.map(f => f.id)).size, STADIUM_FEATURES.length);
  const surfaces = new Set(STADIUM_SURFACES.map(s => s.id));
  for (const f of STADIUM_FEATURES) {
    assert.ok(f.sources.length > 0);
    for (const source of f.sources) assert.ok(STADIUM_SOURCES[source].url.startsWith("https://scarletknights.com/"));
    const points = [f.at];
    if (f.kind === "section") {
      assert.ok(surfaces.has(f.surfaceId));
      points.push(...f.polygon);
      const area = f.polygon.reduce((sum, p, i, all) => {
        const q = all[(i + 1) % all.length];
        return sum + p.x * q.y - q.x * p.y;
      }, 0) / 2;
      assert.ok(Math.abs(area) > 100, `${f.id} must have usable drawing geometry`);
      assert.equal(f.capacity, null);
    } else if (f.kind === "connector") {
      assert.ok(surfaces.has(f.from.surfaceId) && surfaces.has(f.to.surfaceId));
      assert.notEqual(f.from.surfaceId, f.to.surfaceId);
      assert.equal(f.connectionStatus, "proposed");
      assert.equal(f.travelSeconds, null);
      assert.equal(f.capacityPerSecond, null);
      points.push(f.from.point, f.to.point);
      assert.ok(featureOnLayer(f, "concourse"));
    } else if (f.kind === "gate") {
      assert.equal(f.to, "exterior");
      assert.equal(f.widthMeters, null);
      points.push(f.approach);
    } else assert.equal(f.evacuationUse, "unspecified");
    for (const p of points) {
      assert.ok(Number.isFinite(p.x) && p.x >= 0 && p.x <= STADIUM.width, f.id);
      assert.ok(Number.isFinite(p.y) && p.y >= 0 && p.y <= STADIUM.height, f.id);
    }
  }
  assert.equal(STADIUM.metersPerUnit, null);
  assert.equal(STADIUM.simulationReady, true);
});

test("map study pauses a run, preserves its layout and cannot advance a hidden simulation", () => {
  const e = new Experiment();
  e.begin(100, "congestion", "closure", "mvp");
  for (let i = 0; i < 60; i++) e.update(1 / 60);
  const before = JSON.stringify(e.simulation);
  e.showStadium();
  const paused = JSON.stringify(e.simulation);
  assert.equal(e.screen, "stadium");
  assert.equal(e.simulation.running, false);
  assert.notEqual(before, paused);
  e.resume();
  for (let i = 0; i < 600; i++) e.update(1 / 60);
  assert.equal(JSON.stringify(e.simulation), paused);
  assert.equal(e.closureTriggered, false);
  e.showMenu();
  assert.equal(JSON.stringify(e.simulation), paused);
  e.begin(50, "shortest", "open", "large");
  assert.equal(e.screen, "simulation");
  assert.equal(e.simulation.agentCount, 50);
  assert.equal(e.simulation.time, 0);
});
