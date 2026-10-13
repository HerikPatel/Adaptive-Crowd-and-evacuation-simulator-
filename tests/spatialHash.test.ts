import { test } from "node:test";
import assert from "node:assert/strict";
import { SpatialHash } from "../src/simulation/SpatialHash";
test("spatial hash filters by true radius across bucket boundaries and clears", () => {
  const h = new SpatialHash(32);
  const points = [
    { id: 1, position: { x: 31, y: 31 } },
    { id: 2, position: { x: 33, y: 31 } },
    { id: 3, position: { x: 58, y: 58 } },
    { id: 4, position: { x: -1, y: 0 } },
  ];
  points.forEach((p) => h.insert(p));
  assert.deepEqual(
    h.query({ x: 32, y: 31 }, 3).map((p) => p.id),
    [1, 2],
  );
  assert.equal(h.query({ x: 0, y: 0 }, 2)[0].id, 4);
  h.clear();
  assert.equal(h.query({ x: 0, y: 0 }, 100).length, 0);
});
