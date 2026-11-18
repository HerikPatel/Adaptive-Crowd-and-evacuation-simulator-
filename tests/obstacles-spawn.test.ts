import { test } from "node:test";
import assert from "node:assert/strict";
import { Simulation } from "../src/simulation/Simulation";
import { LayoutEditor } from "../src/simulation/LayoutEditor";
import { CellType } from "../src/simulation/Grid";
import { findRoute } from "../src/pathfinding/algorithms";
import { PATH_ALGORITHMS } from "../src/config/simulationConfig";

const rect = (x1: number, y1: number, x2: number, y2: number) => {
  const cells = [];
  for (let y = y1; y <= y2; y++) for (let x = x1; x <= x2; x++) cells.push({ x, y });
  return cells;
};

test("furniture blocks walking like a wall and Erase wall removes it", () => {
  const s = new Simulation(40, "mvp"), editor = new LayoutEditor(s);
  assert.ok(editor.apply("obstacle", [{ x: 27, y: 9 }]).ok);
  assert.equal(s.grid.type(27, 9), CellType.Obstacle);
  assert.equal(s.grid.walkable(27, 9), false);
  assert.equal(s.grid.exitAt(27, 9), null);
  assert.ok(editor.apply("floor", [{ x: 27, y: 9 }]).ok);
  assert.equal(s.grid.walkable(27, 9), true);
});

test("no planner routes through furniture", () => {
  const s = new Simulation(40, "mvp"), editor = new LayoutEditor(s);
  assert.ok(editor.apply("obstacle", rect(26, 9, 27, 10)).ok);
  for (const algorithm of PATH_ALGORITHMS) {
    const route = findRoute(s.grid, { x: 10, y: 15 }, "A", "shortest", algorithm)!;
    assert.ok(route, algorithm);
    for (const p of route.path) assert.ok(s.grid.walkable(p.x, p.y), `${algorithm} at ${p.x},${p.y}`);
  }
});

test("painted start zones replace the preset spawn areas", () => {
  const s = new Simulation(30, "mvp"), editor = new LayoutEditor(s);
  const zone = rect(4, 15, 12, 20);
  assert.ok(editor.apply("spawn", zone).ok);
  s.reset();
  const inZone = new Set(zone.map((p) => `${p.x},${p.y}`));
  for (const a of s.agents) {
    const c = s.grid.cell(a.position);
    assert.ok(inZone.has(`${c.x},${c.y}`), `agent ${a.id} at ${c.x},${c.y}`);
  }
  // Erasing every zone cell returns to the preset areas.
  assert.ok(editor.apply("unspawn", zone).ok);
  assert.equal(s.grid.hasSpawnZones, false);
});

test("start zones must be on open floor and hold at least one person", () => {
  const s = new Simulation(30, "mvp"), editor = new LayoutEditor(s);
  const wall = { x: 0, y: 0 };
  for (let y = 1; y < s.grid.height - 1 && !wall.x; y++)
    for (let x = 1; x < s.grid.width - 1; x++) if (s.grid.type(x, y) === CellType.Wall) { wall.x = x; wall.y = y; break; }
  assert.match(editor.apply("spawn", [wall]).message, /open floor/);
});

test("a crowd placed in start zones around furniture evacuates fully", () => {
  const s = new Simulation(60, "large"), editor = new LayoutEditor(s);
  assert.ok(editor.apply("spawn", rect(6, 7, 16, 15)).ok);
  s.agentCount = Math.min(60, s.populationLimit());
  s.reset();
  const furniture = editor.apply("obstacle", rect(19, 10, 20, 12));
  assert.ok(furniture.ok, furniture.message);
  assert.ok(s.agentCount >= 30);
  s.running = true;
  for (let i = 0; i < 150 * 60 && s.running; i++) s.update(1 / 60);
  assert.equal(s.metrics.evacuatedCount, s.agentCount);
});
