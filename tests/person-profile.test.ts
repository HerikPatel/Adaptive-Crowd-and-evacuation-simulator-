import { test } from "node:test";
import assert from "node:assert/strict";
import { bodyRadius, createProfile, walkingSpeed, validateProfile } from "../src/simulation/PersonProfile";
import { DiscReservations } from "../src/collision/DiscReservations";
import { StadiumSimulation, STADIUM_STEP } from "../src/simulation/StadiumSimulation";

test("profile sampling is repeatable, bounded and variable; gender is not a speed penalty", () => {
  const profiles = Array.from({ length: 1000 }, (_, id) => createProfile(549, id, "mixed"));
  assert.deepEqual(profiles, Array.from({ length: 1000 }, (_, id) => createProfile(549, id, "mixed")));
  assert.notDeepEqual(profiles[0], createProfile(550, 0, "mixed"));
  for (const p of profiles) {
    validateProfile(p);
    assert.ok(walkingSpeed(p) >= 0.45 && walkingSpeed(p) <= 1.8);
    assert.ok(bodyRadius(p) >= 0.22 && bodyRadius(p) <= 0.32);
    assert.equal(walkingSpeed({ ...p, gender: "unspecified" }), walkingSpeed(p));
  }
  assert.ok(new Set(profiles.map(p => walkingSpeed(p).toFixed(2))).size > 50);
  assert.ok(new Set(profiles.map(p => bodyRadius(p).toFixed(2))).size > 5);
  const uniform = createProfile(549, 0, "uniform");
  assert.equal(walkingSpeed(uniform), 1.2);
  assert.equal(uniform.reactionSeconds, 0);
});

test("swept body reservations stop tunneling, allow moving apart and isolate levels", () => {
  const bodies = new DiscReservations();
  bodies.set(1, "lower", { x: 5, y: 0 }, 0.3);
  const fraction = bodies.fraction(2, "lower", { x: 0, y: 0 }, { x: 10, y: 0 }, 0.3);
  assert.ok(fraction > 0.43 && fraction < 0.44);
  assert.equal(bodies.fraction(2, "upper", { x: 0, y: 0 }, { x: 10, y: 0 }, 0.3), 1);
  assert.equal(bodies.fits(2, "lower", { x: 5, y: 0 }, 0.3), false);
  assert.equal(bodies.fits(2, "upper", { x: 5, y: 0 }, 0.3), true);
  assert.equal(bodies.fraction(2, "lower", { x: 4.39, y: 0 }, { x: 3, y: 0 }, 0.3), 1);
  bodies.set(1, "lower", { x: 20, y: 0 }, 0.3);
  assert.equal(bodies.fraction(2, "lower", { x: 0, y: 0 }, { x: 10, y: 0 }, 0.3), 1);
});

test("comparison modes keep the same seats; manual profiles validate atomically", () => {
  const mixed = new StadiumSimulation(undefined, { count: 20, profileMode: "mixed" });
  const uniform = new StadiumSimulation(undefined, { count: 20, profileMode: "uniform" });
  assert.deepEqual(mixed.spectators.map(p => p.seat), uniform.spectators.map(p => p.seat));
  const before = JSON.stringify(mixed.spectators);
  assert.throws(() => mixed.setProfile(0, { ...mixed.spectators[0].profile, speedOverride: NaN }));
  assert.equal(JSON.stringify(mixed.spectators), before);
  mixed.setProfile(0, { ...mixed.spectators[0].profile, speedOverride: 0.6, reactionSeconds: 5 });
  mixed.start();
  for (let i = 0; i < 120; i++) mixed.update(STADIUM_STEP);
  assert.equal(mixed.spectators[0].state.kind, "seated");
  mixed.pause(); assert.throws(() => mixed.setProfile(0, mixed.spectators[0].profile));
  mixed.reset(); assert.equal(JSON.stringify(mixed.spectators), before);
});

test("a slower individual takes longer to exit from the identical starting seat", () => {
  const run = (speed: number) => {
    const s = new StadiumSimulation(undefined, { count: 1, sections: ["section-217"], profileMode: "uniform" });
    s.setProfile(0, { ...s.spectators[0].profile, speedOverride: speed }); s.start();
    for (let i = 0; i < 15000 && s.running; i++) s.update(STADIUM_STEP);
    assert.ok(s.complete);
    return s;
  };
  const slow = run(0.6), fast = run(1.5);
  assert.deepEqual(slow.spectators[0].seat, fast.spectators[0].seat);
  assert.ok(slow.time > fast.time * 1.5);
  const entered = slow.events.find(e => e.edgeId === "ramp-east" && e.kind === "enter")!;
  const left = slow.events.find(e => e.edgeId === "ramp-east" && e.kind === "leave")!;
  assert.ok(left.time - entered.time >= 60 - 1e-7);
});

test("mixed bodies remain separated at every step through seats, turns, transfers and merges", () => {
  const s = new StadiumSimulation(undefined, { count: 100 });
  const check = () => {
    const bodies = new DiscReservations();
    for (const p of s.spectators) {
      if (p.state.kind === "evacuated") continue;
      const zone = p.state.kind === "transfer" ? `transfer:${p.state.step.edgeId}` : s.surfaceOf(p)!;
      const position = s.position(p), at = { x: position.x * 0.2, y: position.y * 0.2 };
      assert.ok(bodies.fits(p.id, zone, at, bodyRadius(p.profile)), `overlap at ${s.time.toFixed(3)}s, person ${p.id}, ${JSON.stringify(p.state)}`);
      bodies.set(p.id, zone, at, bodyRadius(p.profile));
    }
  };
  check(); s.start();
  for (let i = 0; i < 18000 && s.running; i++) { s.update(STADIUM_STEP); check(); }
  assert.ok(s.complete);
});
