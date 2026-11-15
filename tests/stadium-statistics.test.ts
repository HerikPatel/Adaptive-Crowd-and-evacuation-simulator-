import { test } from "node:test";
import assert from "node:assert/strict";
import { experimentJobs, experimentTimeLimit, StadiumExperimentRun, type ExperimentResult } from "../src/simulation/StadiumExperiment";
import { routingSummaries, statisticsCsv } from "../src/simulation/StadiumStatistics";

function result(seed: number, routing: ExperimentResult["routing"], time: number, overrides: Partial<ExperimentResult> = {}): ExperimentResult {
  return { version: "test", population: 100, seed, profile: "uniform", routing, scenario: "open", timeLimitSeconds: 1800,
    movementMode: "passing", completedPasses: 0, passAttempts: 0,
    status: "complete", elapsedSeconds: time, totalEvacuationSeconds: time, meanExitSeconds: time / 2, evacuated: 100,
    meanWaitingSeconds: 0, peakWaiting: 0, routeSwitches: 0, forcedReroutes: 0, routingSearches: 1,
    computeMs: 0, steps: 1, maxStepMs: 0, exits: {}, samples: [], ...overrides };
}

test("statistics average matched per-seed effects, retaining worse outcomes and sample variability", () => {
  const results = [result(11, "adaptive", 80), result(12, "free-flow", 400), result(11, "free-flow", 100), result(12, "adaptive", 440)];
  const [s] = routingSummaries(results);
  assert.deepEqual(s.seeds, [11, 12]); assert.equal(s.pairs, 2); assert.equal(s.completedPairs, 2);
  assert.equal(s.completionReductionSeconds.mean, -10);
  assert.ok(Math.abs(s.completionReductionSeconds.sd! - Math.sqrt(1800)) < 1e-10);
  assert.equal(s.completionReductionPercent.mean, 5, "mean paired percentages, not percentage of mean times");
  assert.equal(s.completionReductionPercent.min, -10); assert.equal(s.completionReductionPercent.max, 20);
  assert.equal(s.baselineCompletionSeconds.mean, 250); assert.equal(s.adaptiveCompletionSeconds.mean, 260);
});

test("incomplete and unmatched runs stay visible but cannot masquerade as completion-time pairs", () => {
  const results = [result(1, "free-flow", 100), result(1, "adaptive", 90),
    result(2, "free-flow", 1800, { status: "timeout", totalEvacuationSeconds: null, evacuated: 80 }), result(2, "adaptive", 1700),
    result(3, "free-flow", 5, { status: "blocked", totalEvacuationSeconds: null, evacuated: 0 }),
    result(3, "adaptive", 1800, { status: "timeout", totalEvacuationSeconds: null, evacuated: 70 }),
    result(4, "adaptive", 1)];
  const [s] = routingSummaries(results);
  assert.equal(s.pairs, 3); assert.equal(s.unmatchedSeeds, 1); assert.equal(s.completedPairs, 1);
  assert.equal(s.baselineComplete, 1); assert.equal(s.adaptiveComplete, 2);
  assert.equal(s.baselineTimeout, 1); assert.equal(s.adaptiveTimeout, 1); assert.equal(s.baselineBlocked, 1);
  assert.deepEqual(s.completionReductionSeconds, { n: 1, mean: 10, sd: null, min: 10, max: 10 });
  assert.equal(s.evacuatedDifference.mean, 30); assert.equal(s.evacuatedDifference.n, 3);
  assert.equal(s.adaptiveCompletionSeconds.mean, 90, "same fully completed seed subset as baseline");
});

test("protocol versions, run limits and scenarios form separate groups; duplicate runs are rejected", () => {
  const baseline = result(1, "free-flow", 100);
  const groups = routingSummaries([baseline, result(1, "adaptive", 90, { timeLimitSeconds: 3600 }),
    result(1, "adaptive", 90, { version: "different" }), result(1, "adaptive", 90, { scenario: "east-closure" })]);
  assert.equal(groups.length, 4);
  for (const group of groups) { assert.equal(group.pairs, 0); assert.equal(group.unmatchedSeeds, 1); assert.equal(group.completionReductionPercent.mean, null); }
  assert.throws(() => routingSummaries([baseline, baseline]), /Duplicate/);
  assert.equal(routingSummaries([baseline, result(1, "adaptive", 90, { movementMode: "queue" })]).length, 2);
  assert.deepEqual(routingSummaries([]), []);
});

test("statistics export includes denominators, censoring counts and blank unavailable statistics", () => {
  const csv = statisticsCsv([result(1, "free-flow", 1800, { status: "timeout", totalEvacuationSeconds: null, evacuated: 80 }),
    result(1, "adaptive", 1800, { status: "timeout", totalEvacuationSeconds: null, evacuated: 90 })]);
  const rows = csv.trim().split("\r\n").map(row => row.split(",").map(value => value.slice(1, -1)));
  assert.equal(rows.length, 2); assert.equal(rows[0].length, rows[1].length);
  const record = Object.fromEntries(rows[0].map((key, i) => [key, rows[1][i]]));
  assert.equal(record.matched_pairs, "1"); assert.equal(record.completed_pairs, "0"); assert.equal(record.baseline_timeout, "1");
  assert.equal(record.completion_reduction_seconds_complete_pairs_mean, "");
  assert.equal(record.evacuated_difference_at_stop_mean, "10"); assert.equal(record.evacuated_difference_at_stop_sd, "");
});

test("run limits are shared validated options and preserve exact stopping samples", () => {
  assert.equal(experimentTimeLimit({}), 1800);
  for (const timeLimitSeconds of [60, 3600, 7200]) {
    assert.equal(experimentTimeLimit({ timeLimitSeconds }), timeLimitSeconds);
    assert.equal(experimentJobs({ populations: [1], seeds: [0], timeLimitSeconds }).length, 8);
  }
  for (const timeLimitSeconds of [0, 59, 7201, 1800.5, NaN, Infinity])
    assert.throws(() => experimentJobs({ populations: [1], seeds: [0], timeLimitSeconds }), /run limit/);
  const jobs = experimentJobs({ populations: [4], seeds: [549], timeLimitSeconds: 60 });
  const run = new StadiumExperimentRun(jobs[0], experimentTimeLimit({ timeLimitSeconds: 60 }));
  while (!run.done) run.step();
  const r = run.result(); assert.equal(r.timeLimitSeconds, 60); assert.equal(r.status, "timeout");
  assert.ok(Math.abs(r.elapsedSeconds - 60) < 1e-8); assert.equal(r.totalEvacuationSeconds, null);
  assert.equal(r.samples.at(-1)!.time, r.elapsedSeconds); assert.equal(r.samples.at(-1)!.evacuated, r.evacuated);
});
