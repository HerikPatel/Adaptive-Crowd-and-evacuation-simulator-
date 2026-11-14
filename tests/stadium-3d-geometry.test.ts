import assert from "node:assert/strict";
import test from "node:test";
import { STADIUM } from "../src/maps/stadium";
import { bowlRadius, lowerBowlElevation, mapToGround, stadiumSurfacePoint } from "../src/ui/Stadium3DGeometry";

test("3D projection is visual-only, centered, and gives the bowl a real slope", () => {
  assert.deepEqual(mapToGround({ x: STADIUM.width / 2, y: STADIUM.height / 2 }), { x: 0, z: 0 });
  const inner = { x: 600, y: 575 };
  const outer = { x: 600, y: 660 };
  assert.ok(bowlRadius(outer) > bowlRadius(inner));
  assert.ok(lowerBowlElevation(outer) > lowerBowlElevation(inner));
  assert.deepEqual(inner, { x: 600, y: 575 }, "projection must not mutate map points");
});

test("upper-deck connectors visibly descend to the shared concourse", () => {
  const point = { x: 350, y: 155 };
  const upper = stadiumSurfacePoint(point, "upper-east");
  const concourse = stadiumSurfacePoint(point, "concourse");
  const exterior = stadiumSurfacePoint(point, "exterior");
  assert.ok(upper.y > concourse.y);
  assert.ok(concourse.y > exterior.y);
  assert.equal(upper.x, concourse.x);
  assert.equal(upper.z, concourse.z);
});
