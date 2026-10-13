import { test } from "node:test";
import assert from "node:assert/strict";
import { Grid, CellType } from "../src/simulation/Grid";
import { Density } from "../src/simulation/Density";
import { Agent } from "../src/simulation/Agent";
import { SpatialHash } from "../src/simulation/SpatialHash";
test("smoothed congestion follows moving agents and updates only at 10 Hz", () => {
  const grid = new Grid(10, 10, 20);
  grid.cells.fill(CellType.Walkable);
  const density = new Density(),
    hash = new SpatialHash<Agent>(32),
    a = new Agent(0, grid.center({ x: 2, y: 2 }), 48);
  hash.insert(a);
  density.update(grid, hash, 1 / 60);
  assert.equal(density.revision, 0);
  assert.equal(grid.density[grid.index(2, 2)], 0);
  for (let i = 0; i < 5; i++) density.update(grid, hash, 1 / 60);
  assert.equal(density.revision, 1);
  const old = grid.density[grid.index(2, 2)];
  assert.ok(old > 0);
  a.position = grid.center({ x: 7, y: 7 });
  hash.clear();
  hash.insert(a);
  for (let i = 0; i < 6; i++) density.update(grid, hash, 1 / 60);
  assert.equal(density.revision, 2);
  assert.ok(grid.density[grid.index(2, 2)] < old);
  assert.ok(grid.density[grid.index(7, 7)] > 0);
});
