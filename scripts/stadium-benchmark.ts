import { mkdirSync, writeFileSync } from "node:fs";
import { cpus, platform, release } from "node:os";
import { experimentJobs, experimentTimeLimit, StadiumExperimentRun, resultsCsv, samplesCsv, STADIUM_EXPERIMENT_VERSION, type ExperimentResult } from "../src/simulation/StadiumExperiment";
import { statisticsCsv } from "../src/simulation/StadiumStatistics";
import type { StadiumMovement } from "../src/simulation/StadiumSimulation";

// npm run benchmark:stadium -- --populations=100,500,1000 --seeds=549
const options = new Map<string, string>();
for (const arg of process.argv.slice(2)) {
  const match = /^--(populations|seeds|time-limit|output|movement)=(.+)$/.exec(arg);
  if (!match || options.has(match[1])) throw new Error(`Invalid or repeated option: ${arg}. Use --populations=100,500 --seeds=549,550,551 --time-limit=3600 --output=docs/benchmarks/repeated.`);
  options.set(match[1], match[2]);
}
const values = (name: string, fallback: string) => (options.get(name) ?? fallback).split(",").map(s => s.trim() ? Number(s) : NaN);
const request = { populations: values("populations", "100"), seeds: values("seeds", "549"), timeLimitSeconds: Number(options.get("time-limit") ?? 1800), movementMode: (options.get("movement") ?? "passing") as StadiumMovement };
const jobs = experimentJobs(request), timeLimit = experimentTimeLimit(request);
const results: ExperimentResult[] = [];
const directory = options.get("output") ?? "docs/benchmarks";
mkdirSync(directory, { recursive: true });
const startedAt = new Date().toISOString();
const save = () => {
  writeFileSync(`${directory}/stadium-summary.csv`, resultsCsv(results));
  writeFileSync(`${directory}/stadium-time-series.csv`, samplesCsv(results));
  writeFileSync(`${directory}/stadium-statistics.csv`, statisticsCsv(results));
  writeFileSync(`${directory}/stadium-environment.json`, JSON.stringify({ version: STADIUM_EXPERIMENT_VERSION, startedAt, generatedAt: new Date().toISOString(), node: process.version,
    os: `${platform()} ${release()}`, cpu: cpus()[0]?.model, request, jobs: jobs.length, completedJobs: results.length, batchComplete: results.length === jobs.length, timestepSeconds: 1 / 30,
    note: "Timings are elapsed simulation-update durations, include routing, exclude construction/rendering, and depend on host load/pauses. Statistics match seeds and use only fully completed pairs for completion-time comparisons. These are schematic model outputs, not measured evacuation times." }, null, 2) + "\n");
};
save();
for (const job of jobs) {
  const run = new StadiumExperimentRun(job, timeLimit);
  while (!run.done) run.step();
  const result = run.result(); results.push(result);
  process.stdout.write(`${results.length}/${jobs.length}: ${job.population} seed ${job.seed} ${job.profile} ${job.scenario} ${job.routing}: ${result.status}, ${result.evacuated} outside, ${result.elapsedSeconds.toFixed(1)} s, ${result.routeSwitches} switches\n`);
  save();
}
