import assert from "node:assert/strict";
import test from "node:test";
import { createStadiumNetwork } from "../src/maps/stadiumNavigation";
import { createPhysicalPath, samplePhysicalPath, STADIUM_PHYSICAL_SEATS, transferDuration } from "../src/simulation/StadiumPhysicalGeometry";

test("cumulative physical sampling handles unequal segments exactly", () => {
  const path = createPhysicalPath("unequal", [
    { x: 0, y: 0, z: 0 }, { x: 3, y: 0, z: 0 }, { x: 3, y: 4, z: 0 },
  ], 1.2);
  assert.equal(path.length, 7);
  const sample = samplePhysicalPath(path, 5);
  assert.deepEqual(sample.position, { x: 3, y: 2, z: 0 });
  assert.deepEqual(sample.direction, { x: 0, y: 1, z: 0 });
  assert.equal(sample.progress, 5 / 7);
  assert.equal(sample.segmentIndex, 1);
});

test("east ramp bend uses one continuous path for its endpoints and progress", () => {
  const ramp = createStadiumNetwork().edges.find(edge => edge.id === "ramp-east")!;
  assert.equal(ramp.physicalPath.points.length, 3);
  assert.deepEqual(samplePhysicalPath(ramp.physicalPath, 0).position, ramp.physicalPath.points[0]);
  assert.deepEqual(samplePhysicalPath(ramp.physicalPath, ramp.physicalPath.length).position, ramp.physicalPath.points.at(-1));
  const bendDistance = ramp.physicalPath.cumulative[1];
  assert.deepEqual(samplePhysicalPath(ramp.physicalPath, bendDistance).position, ramp.physicalPath.points[1]);
});

test("physical transfer duration never exceeds preferred walking speed", () => {
  assert.equal(transferDuration(12, 1.2, 0.1), 10);
  assert.equal(transferDuration(1, 0.6, 3), 6);
  assert.equal(transferDuration(1, 1.2, 3), 3);
});

test("every section has deterministic seats with row-to-aisle access", () => {
  assert.equal(STADIUM_PHYSICAL_SEATS.size, 72);
  assert.ok([...STADIUM_PHYSICAL_SEATS.values()].every(seats => seats.length >= 100));
  for (const seats of STADIUM_PHYSICAL_SEATS.values()) for (const seat of seats.slice(0, 3)) {
    assert.equal(seat.accessPath.points[0].x, seat.position.x);
    assert.equal(seat.accessPath.points[0].z, seat.position.z);
    assert.ok(seat.accessPath.length > 0);
  }
});
