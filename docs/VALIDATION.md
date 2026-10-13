# Validation results

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

Soft separation still allows temporary overlap in dense crowds, and the model is not calibrated for real evacuation planning. See the README for the remaining MVP limitations.
