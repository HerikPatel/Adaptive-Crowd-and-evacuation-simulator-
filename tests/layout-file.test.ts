import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLayout, serializeLayout, LAYOUT_FORMAT } from "../src/simulation/LayoutFile";
import { MAPS, type MapId } from "../src/maps/maps";
import { Simulation } from "../src/simulation/Simulation";
import { LayoutEditor } from "../src/simulation/LayoutEditor";
import { CellType } from "../src/simulation/Grid";

const ids = Object.keys(MAPS) as MapId[];

test("every built-in layout survives a save/load round trip unchanged", () => {
  for (const id of ids) {
    const grid = MAPS[id].create();
    const loaded = parseLayout(serializeLayout(grid, id));
    assert.equal(loaded.mapId, id);
    assert.deepEqual(Array.from(loaded.grid.cells), Array.from(grid.cells), id);
  }
});

test("saved files are readable: one text row per grid row", () => {
  const text = serializeLayout(MAPS.mvp.create(), "mvp");
  const data = JSON.parse(text);
  assert.equal(data.format, LAYOUT_FORMAT);
  assert.equal(data.cells.length, 30);
  assert.equal(data.cells[0].length, 50);
  assert.ok(text.split("\n").length > 30);
});

test("an edited layout round-trips and runs to full evacuation", () => {
  const s = new Simulation(80, "mvp");
  const result = new LayoutEditor(s).apply("wall", [{ x: 27, y: 9 }, { x: 27, y: 10 }]);
  assert.ok(result.ok, result.message);
  const loaded = parseLayout(serializeLayout(s.grid, "mvp"));
  const fresh = new Simulation(1, "mvp");
  fresh.agentCount = 80;
  fresh.loadCustomLayout(loaded.grid);
  fresh.reset();
  assert.ok(fresh.hasCustomLayout);
  assert.equal(fresh.grid.type(27, 10), CellType.Wall);
  fresh.running = true;
  for (let i = 0; i < 120 * 60 && fresh.running; i++) fresh.update(1 / 60);
  assert.equal(fresh.metrics.evacuatedCount, 80);
});

test("invalid files are rejected with a clear message", () => {
  const good = JSON.parse(serializeLayout(MAPS.mvp.create(), "mvp"));
  const bad = (change: (d: any) => void) => { const d = structuredClone(good); change(d); return JSON.stringify(d); };
  assert.throws(() => parseLayout("not json"), /not valid JSON/);
  assert.throws(() => parseLayout(JSON.stringify({ hello: 1 })), /not an Evacuation Lab layout/);
  assert.throws(() => parseLayout(bad((d) => { d.version = 9; })), /version 9/);
  assert.throws(() => parseLayout(bad((d) => { d.map = "moon"; })), /does not exist/);
  assert.throws(() => parseLayout(bad((d) => { d.width = 10; })), /50 × 30/);
  assert.throws(() => parseLayout(bad((d) => { d.cells.pop(); })), /30 rows of 50/);
  assert.throws(() => parseLayout(bad((d) => { d.cells[5] = "?" + d.cells[5].slice(1); })), /Unknown cell "\?"/);
  assert.throws(() => parseLayout(bad((d) => { d.cells[0] = "." + d.cells[0].slice(1); })), /touches the map edge/);
  assert.throws(() => parseLayout(bad((d) => { d.cells[10] = d.cells[10].slice(0, 25) + "A" + d.cells[10].slice(26); })), /Exit A is split/);
});
