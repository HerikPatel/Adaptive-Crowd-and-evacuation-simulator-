# Repeated-seed and longer-limit stadium measurements

This follow-up uses the same `stadium-traffic-v1` movement and routing model as the [original comparison](README.md). The new experiment controls allow longer limits and report paired statistics across seeds. Both batches were collected on November 14, 2026.

## Protocol and reproduction

These are historical v1 results. Current code runs `stadium-movement-v2`, so the commands below preserve the original scenario parameters but write new passing-model results to separate directories. They do not reproduce the historical v1 trajectories or establish a passing benefit. Repeat with `--movement=queue` and separate output paths for a current-model comparison.

The repeated-seed batch uses 100 and 500 people with seeds 549, 550, and 551, at the original 1,800-second limit: 48 runs, or 24 routing pairs. Each profile/scenario/population group has three matched seeds. The extended-limit batch uses 1,000 people, seed 549, and a 3,600-second limit: eight runs, or four routing pairs. Both use all default seating sections, uniform/mixed profiles, open/east-closure scenarios, and fixed 1/30-second steps.

```powershell
npm run benchmark:stadium -- --populations=100,500 --seeds=549,550,551 --time-limit=1800 --movement=passing --output=docs/benchmarks/movement-v2-repeated-passing
npm run benchmark:stadium -- --populations=1000 --seeds=549 --time-limit=3600 --movement=passing --output=docs/benchmarks/movement-v2-extended-passing
```

The two batches are stored separately from the original results. Their different populations, seed counts, and time limits must not be pooled into one overall percentage.

All **56 runs finished with the entire population evacuated** within their configured limits. The recorded CSVs contain all outcomes from both requested batches.

| Batch | Per-run results | Samples | Paired statistics | Environment |
| --- | --- | --- | --- | --- |
| Repeated seeds | [CSV](repeated-seeds/stadium-summary.csv) | [CSV](repeated-seeds/stadium-time-series.csv) | [CSV](repeated-seeds/stadium-statistics.csv) | [JSON](repeated-seeds/stadium-environment.json) |
| Extended limit | [CSV](extended-limit/stadium-summary.csv) | [CSV](extended-limit/stadium-time-series.csv) | [CSV](extended-limit/stadium-statistics.csv) | [JSON](extended-limit/stadium-environment.json) |

## Repeated-seed results

Each row has three matched, fully completed pairs. Completion means are simulated seconds. Reduction and its sample standard deviation are percentage points, rounded to two decimals; ranges include every tested seed.

| People | Profile | Scenario | Baseline mean completion | Adaptive mean completion | Mean reduction ± SD | Reduction range |
| ---: | --- | --- | ---: | ---: | ---: | ---: |
| 100 | Uniform | Open | 165.2 | 165.2 | 0.00 ± 0.00% | 0.00 to 0.00% |
| 100 | Uniform | East closed at 35 s | 249.9 | 249.9 | 0.00 ± 0.00% | 0.00 to 0.00% |
| 100 | Mixed | Open | 186.6 | 186.6 | 0.00 ± 0.00% | 0.00 to 0.00% |
| 100 | Mixed | East closed at 35 s | 240.4 | 240.3 | 0.04 ± 1.19% | -1.12 to 1.25% |
| 500 | Uniform | Open | 548.1 | 514.6 | 6.12 ± 0.23% | 5.89 to 6.35% |
| 500 | Uniform | East closed at 35 s | 1,102.9 | 1,002.8 | 9.08 ± 0.48% | 8.67 to 9.61% |
| 500 | Mixed | Open | 528.6 | 496.9 | 5.99 ± 0.44% | 5.49 to 6.28% |
| 500 | Mixed | East closed at 35 s | 1,062.0 | 967.2 | 8.93 ± 1.15% | 7.67 to 9.94% |

Adaptive was faster in every tested 500-person pair. At 100 people, most completion times were identical. The mixed closure scenario includes a regression: seed 550 took 238.5 s with baseline and 241.1 s with adaptive, about 1.12% slower. Seed 551 improved by about 1.25%, while seed 549 was unchanged. Reporting only the small positive average would hide this variability.

## Extended-limit results

All rows use 1,000 people and seed 549, with a 3,600-second cap. Times are simulated seconds. This is a single-seed comparison, with no variability estimate.

| Profile | Scenario | Baseline completion | Adaptive completion | Reduction |
| --- | --- | ---: | ---: | ---: |
| Uniform | Open | 1,066.9 | 1,000.2 | 6.25% |
| Uniform | East closed at 35 s | 2,148.1 | 1,893.7 | 11.84% |
| Mixed | Open | 1,025.5 | 985.3 | 3.92% |
| Mixed | East closed at 35 s | 2,072.5 | 1,837.1 | 11.36% |

The four closure cases that previously timed out all finish beyond 1,800 s and below 3,600 s. The earlier counts of 901/972 uniform and 918/989 mixed people outside at 1,800 s remain unchanged; they were partial observations of these longer trajectories, not failed evacuations or completion-time estimates.

## Interpreting the statistics

Reduction is `(baseline - adaptive) / baseline * 100`, computed within each matched seed before averaging. Positive values favor adaptive; negative values retain slower adaptive outcomes. Standard deviation describes the observed spread across seeds and is not a confidence interval. Three seeds are a small sample; the extended-limit batch has just one seed and cannot estimate variability.

Only pairs where both policies finish contribute to completion-time means. The statistics CSV also includes matched/unmatched seed counts, complete/timeout/blocked counts, and evacuated-at-stop counts. A timed-out run never receives a fabricated completion time.

## Limits and measurement conditions

The two batches ran concurrently on the same host. Elapsed update timings are retained in the raw CSVs for provenance, but are affected by scheduling and host load; this report makes no performance or FPS comparison from them. Simulation time and movement decisions use fixed steps, independently of wall-clock timing.

The longer limit does not change speed, route costs, gate capacity, or collision rules. It only permits the existing trajectory to continue. The original 1,800-second closure results remain valid observations at that earlier horizon. Geometry, body profiles, queue delays and capacities remain schematic assumptions; these measurements do not validate real SHI Stadium evacuation times.

## Verification

Independent artifact checks verified all 56 rows, 12 statistical groups, per-gate totals, completion status, monotonic sample times/exit counts, final sample agreement, paired means, and sample standard deviations. All **3,875 time-series samples** from the original seed-549 batch appear exactly in the new datasets, confirming the recorded trajectories are preserved through the original horizon.

The production build, five new statistics/limit tests, ten existing stadium routing/experiment regressions, and two production-browser experiment tests passed. See [validation details](../VALIDATION.md).
