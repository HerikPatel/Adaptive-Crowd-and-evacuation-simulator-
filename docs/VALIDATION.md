# Validation results

## Optional building ORCA - November 16, 2026

- `npm run build`: TypeScript and production compilation pass; ORCA attribution and license are included in the public build assets.
- `npm test`: **95 passing unit and simulation tests**, including the shortcut's crossing, overspeed and wall-penetration rejection cases.
- `npm run test:browser` against the production preview: **18 passing Chrome tests**, including both movement modes' stress samples, ORCA setup/reset/results/mobile controls, and existing stadium worker/CSV flows.

The focused ORCA suite checks analytical velocity constraints and speed bounds, infeasible/parallel constraints, reciprocal avoidance over the horizon, deterministic degenerate pairs, head-on passage without contact correction, wall editing, atomic setting validation and reproducible reset. Full scenarios check body sweeps, wall clearance and speed limits at every step, including agents exiting during the step. All six ORCA scenario runs completed.

With seed 549, Congestion Aware and fixed 1/60-second updates:

| Building map | Population | Closure | ORCA completion (s) | Predictive completion (s) |
| --- | ---: | --- | ---: | ---: |
| Original bottleneck | 100 | None | 27.567 | Not compared in this batch |
| Original bottleneck | 100 | A at 8 s | 26.133 | Not compared in this batch |
| Original bottleneck | 500 | A at 8 s | 39.233 | Not compared in this batch |
| Distributed wings | 500 | None | 54.650 | 40.167 |
| Distributed wings | 500 | A at 8 s | 53.650 | 47.683 |
| Distributed wings | 1,000 | None | 102.867 | 84.533 |

The predictive larger-map results were reproduced by the regression run with the same code, seed, crowd and closure timing. ORCA is slower in all three compared cases, so predictive steering remains the default. These are simulation times; no rendering-performance claim follows from them. The ORCA branch also passes independent two-agent avoidance checks before the common contact stage, demonstrating that the new mode is more than a label on the existing solver.

Dense ORCA neighborhoods sometimes have no velocity satisfying every constraint within the speed limit. For the 500-person open run, 179,449 of 570,972 individual proposals were marked constraint-infeasible before contact correction. The common safety stage still passes the full scenario's clearance checks; this counter is not a count of collisions. See [the integration assumptions](ORCA.md).

Production-browser checks after the verified-clear shortcut collected eight samples per crowd. In the final full browser run, ORCA sampled **60 FPS at 200 agents** and **26-60 FPS at 500 agents** (16.7-38.6 ms); predictive steering sampled 60 FPS and 50-60 FPS respectively. An earlier isolated ORCA run sampled 58-60 FPS at 500, illustrating host/run variability. Heavy headless tests were stopped during both browser measurements. These are local early-evacuation samples, not sustained minimums or presentation-laptop guarantees. The shortcut retains every hard clearance check and skips corrective iterations only when the entire proposed step passes.

## Collision handling and stadium passing - November 15, 2026

- `npm run build`: TypeScript and Vite production compilation pass, including the experiment worker.
- `npm test`: **83 passing unit and simulation tests** after the final movement changes, with no failures.
- The full production-preview browser suite passed **15 tests** after the stadium movement update. After the final grid changes, all **six affected browser tests** in `app.spec.ts` and `stadium-experiments.spec.ts` passed again. A separate isolated production stress run also passed.
- Movement regressions cover between-frame crossings, head-on avoidance, touching queues, dense doorway corners, atomic rejection of unsafe door closures, and a complete grid closure scenario. The larger-map scenarios check body sweeps, wall clearance, and speed limits at every fixed step, including people who evacuate during that step.
- Stadium regressions cover faster walkers passing slower walkers with oncoming traffic and a live gate closure, continuous body clearance, corridor width and speed bounds, merging, reset, and queue-only behavior on narrow corridors. Browser checks cover both movement selectors, reset/disabled states, the worker, and movement/version fields in exported results.

Distributed-wings outcomes with seed 549, Congestion Aware, and fixed 1/60-second steps:

| Population | Closure | Completion (s) | A evacuated | B evacuated |
| --- | --- | ---: | ---: | ---: |
| 100 | None | 16.250 | 42 | 58 |
| 500 | None | 40.167 | 223 | 277 |
| 500 | A at 8 s | 47.683 | 33 | 467 |
| 1,000 | None | 84.533 | 451 | 549 |

The original map also completes its normal, late-closure, shortest-path, and deterministic-reset scenarios. Normal 200- and 500-person runs finish at 32.000 and 52.383 simulated seconds respectively. These are model outcomes, not CPU timings.

An isolated Chrome run against the production preview collected eight readout samples per population with heavy headless tests stopped: **60 FPS in all samples at 200 agents**, and **50-60 FPS at 500 agents** (16.7-20.0 ms). The stress browser test passed. These local samples do not establish a sustained minimum on the presentation laptop or performance of dense stadium rendering.

New stadium comparisons use `stadium-movement-v2` and record queue/passing mode. The benchmark reports and CSVs below retain their **historical `stadium-traffic-v1` results**; they do not establish an evacuation-time benefit from the new passing model. Matched-seed v2 measurements remain in [FUTURE_TODO.txt](../FUTURE_TODO.txt). Neither movement solver is a complete ORCA implementation or a learned controller, and arbitrary edited layouts can still create conservative waits.

## Experiment limits and summaries across seeds — November 14, 2026

- `npm run build`: TypeScript and production compilation pass, including the updated worker and CLI.
- `npx tsx --test tests/stadium-statistics.test.ts`: **5 passing tests** for signed paired effects, sample standard deviation, unequal completion, unmatched seeds, protocol separation, duplicate rejection, CSV denominators/missing values, and run-limit validation/stopping samples.
- `npx tsx --test tests/stadium-traffic.test.ts`: **10 passing routing and experiment regression tests**.
- `npm run test:browser -- tests/browser/stadium-experiments.spec.ts` against the production preview: **2 passing Chrome tests**, covering worker execution with a custom 60-second limit, three seeds/24 runs, statistics CSV content, incomplete-result presentation, single-seed summaries, cancellation, validation, and mobile overflow.
- See [follow-up measurements](benchmarks/FOLLOW_UP.md) for the longer-limit and repeated-seed batches. That milestone used `stadium-traffic-v1`; its changes were to experiment controls and analysis.
- All **56 follow-up runs** completed: 48 repeated-seed cases at 100/500 people and eight extended-limit cases at 1,000 people. Artifact checks verified paired statistics, conservation through gate totals, sample endpoints/order, and exact preservation of all **3,875 original seed-549 samples**. The previously timed-out closure cases complete between 1,837.1 and 2,148.1 simulated seconds.

## Stadium adaptive routing and comparisons — November 13, 2026

- `npm run build`: TypeScript and production compilation pass, including the separate experiment worker bundle.
- `npm test`: **70 passing tests**, including adaptive queue feedback, route stability, closures/reopening, matched seats, deterministic experiments, incomplete-result reporting, and corridor conflict handling.
- `npm run test:browser` against `npm run preview -- --port 5174 --strictPort`: **14 passing Chrome tests**, covering both grid and stadium interfaces, production worker execution, cancellation, CSV downloads, charts, and mobile layout.
- Swept-body separation is checked at every fixed step of mixed 100-person scenarios and a crowded aisle/stair crossing. The existing 1,000-person baseline completion test passes; the corrected 1,000-person uniform adaptive open-gate diagnostic also clears completely.
- A maximum-population comparison exposed agents blocking each other where schematic south stair approaches run alongside section aisles. Those same-surface aisle/approach pairs now share reservations, without adding route connections at drawing overlaps. The fix applies to both routing modes; a dedicated regression checks clearance and completion.

See [the experiment protocol](STADIUM_EXPERIMENTS.md) and the historical [24-run comparison report](benchmarks/README.md), completed November 14. The grid measurements below also describe earlier versions and remain useful only with their stated setup. No claim about stadium rendering FPS is inferred from headless update timings.

## Earlier grid measurements — October 13, 2026

Verified locally on October 13, 2026, using Windows, Node 24.13.1, and installed Chrome 155.0.8059.40.

## Larger-map update

The default layout is now Distributed wings (70×42), with four seeded spawn areas, a west-facing A exit, and a south-facing B exit. The original map remains selectable. The updated suite passes **23 simulation tests and 3 browser tests**, covering layout switching, Canvas dimensions, distributed spawns, reset, west-facing door closure, and complete evacuation.

New-map fixed-step outcomes, seed 549 / Congestion Aware:

| Population | Closure | Completion (s) | A evacuated | B evacuated |
| --- | --- | ---: | ---: | ---: |
| 100 | None | 16.583 | 42 | 58 |
| 500 | None | 28.450 | 224 | 276 |
| 500 | A at 8 s | 48.183 | 63 | 437 |

Eight Chrome readout samples on the larger map, same viewport and settings as below: **43–49 FPS at 200 agents** (20.5–23.5 ms), and **40–45 FPS at 500 agents** (22.5–25.0 ms). These are local sample ranges, not hardware-independent guarantees. The original-map results below are retained as the earlier baseline.

## Automated checks

- `npm run build`: passes TypeScript checking and Vite production compilation.
- `npm test`: 18 passing unit and full-simulation scenario tests.
- `npm run test:browser`: 2 passing Chrome browser tests.
- Vite HTTP readiness check: status 200.

Covered behavior includes full evacuation, live exit closure and rerouting, circle-wall handling, reduced overlap forces, spatial queries, density smoothing/movement, route hysteresis, bounded replanning, pause, responsive controls, and reset reproducibility. Browser reset also compares the Canvas image with its original state. The browser control test reports no page errors.

The full-simulation scenarios include normal 100/200/500-agent runs, closure at five seconds with 100 agents, a late closure at twelve seconds with 500 agents, and Shortest Path with 200 agents. Wall penetration is sampled throughout those runs; no agent exceeds four exit switches in these scenarios.

## Reproducible headless simulation results

Seed 549, Congestion Aware, both exits open, fixed 1/60 s steps:

| Population | Complete at (simulation seconds) | Exit A | Exit B | Exit switches |
| ---------- | -------------------------------: | -----: | -----: | ------------: |
| 200        |                           28.917 |     75 |    125 |            55 |
| 500        |                           30.383 |    245 |    255 |            72 |

These values are model outcomes, not CPU timings or browser FPS measurements. Population need not scale evacuation time linearly because congestion changes path choice and exit utilization.

## Browser rendering observations

Headless installed Chrome, Vite development server, 1440×1100 viewport, debug overlays off, Congestion Aware. Eight readout samples per population were collected at approximately 0.5 s intervals after the first five simulation seconds:

| Population |    Observed rounded FPS | Observed frame interval |
| ---------- | ----------------------: | ----------------------: |
| 200        | 60 in all eight samples |                 16.7 ms |
| 500        | 60 in all eight samples |            16.6–16.7 ms |

These observations exceed the numerical targets in this environment. They do **not** establish performance on a particular mid-range laptop or a worst-case sustained minimum. Follow [the manual performance procedure](MANUAL_TESTS.md) on the presentation laptop, preferably using the production build, and record hardware and browser details. Re-run browser tests to regenerate screenshots and sample attachments in `test-results/`.

## Issues found and resolved

- A full-crowd test exposed agents competing indefinitely for one exact waypoint center. Circle-clearance-checked local lookahead resolved the stall; all tested populations and closure scenarios now complete.
- Initial browser assertions allowed only five wall-clock seconds to observe five simulation seconds, and sampled the timer before the paused UI refresh. The test now allows scheduling margin and waits for the Paused state before checking timer stability.
- Windows sandbox restrictions blocked npm downloads and compiler/test subprocesses. Approved tool execution resolved these environment restrictions; they were not browser application runtime errors.

These earlier grid versions used soft separation and allowed temporary overlap in dense crowds. The November 15 milestone adds hard simultaneous sweep checks, with the coverage and limitations recorded above. The model remains uncalibrated for real evacuation planning.
