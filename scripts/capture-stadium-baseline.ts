import { StadiumRouter } from "../src/pathfinding/StadiumRouter";
import { StadiumSimulation, STADIUM_STEP, type StadiumRunOptions } from "../src/simulation/StadiumSimulation";

interface BaselineResult {
  population: number;
  completionSeconds: number;
  averageEvacuationSeconds: number | null;
  exits: Record<string, number>;
  replacements: number;
  collisionWaits: number;
}

function finish(simulation: StadiumSimulation, limitSeconds = 1800) {
  simulation.start();
  for (let i = 0; i < limitSeconds / STADIUM_STEP && simulation.running; i++) simulation.update(STADIUM_STEP);
  if (!simulation.complete) throw new Error(`Baseline did not complete after ${simulation.time.toFixed(1)} seconds.`);
}

function result(simulation: StadiumSimulation): BaselineResult {
  const snapshot = simulation.snapshot();
  return {
    population: snapshot.population,
    completionSeconds: Number(snapshot.time.toFixed(3)),
    averageEvacuationSeconds: snapshot.averageEvacuationSeconds === null ? null : Number(snapshot.averageEvacuationSeconds.toFixed(3)),
    exits: snapshot.exits,
    replacements: simulation.spectators.filter(person => person.replacementReason !== null).length,
    collisionWaits: snapshot.collisionWaits,
  };
}

function normal(options: StadiumRunOptions) {
  const simulation = new StadiumSimulation(undefined, options);
  finish(simulation);
  return result(simulation);
}

function timedGateClosure() {
  const router = new StadiumRouter(), simulation = new StadiumSimulation(router, { count: 100, seed: 549, profileMode: "mixed" });
  simulation.start();
  while (simulation.time < 5 - STADIUM_STEP / 2) simulation.update(STADIUM_STEP);
  router.setClosed("gate-west", true);
  finish(simulation);
  return result(simulation);
}

function disconnectedDeck() {
  const router = new StadiumRouter();
  router.setClosed("ramp-east", true);
  const simulation = new StadiumSimulation(router, { count: 20, seed: 549, profileMode: "uniform", sections: ["section-217"] });
  simulation.start();
  simulation.update(STADIUM_STEP);
  const disconnected = { stranded: simulation.snapshot().stranded, running: simulation.running };
  router.setClosed("ramp-east", false);
  simulation.refreshRoutes();
  simulation.start();
  finish(simulation);
  return { disconnected, recovered: result(simulation) };
}

const seeded100 = normal({ count: 100, seed: 549, profileMode: "mixed" });
const replay100 = normal({ count: 100, seed: 549, profileMode: "mixed" });
const report = {
  capturedAt: new Date().toISOString(),
  seeded100,
  uniform1000: normal({ count: 1000, seed: 549, profileMode: "uniform" }),
  gateWestClosureAt5Seconds: timedGateClosure(),
  eastUpperDisconnectionAndReopening: disconnectedDeck(),
  deterministicReplay: { identical: JSON.stringify(seeded100) === JSON.stringify(replay100), replay: replay100 },
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
