# Adaptive stadium routing and reproducible comparisons

## Run it

Open **SHI Stadium** in the map menu. **Stadium routing** selects Adaptive or the Free-flow baseline; changing it resets the crowd while retaining network settings. Adaptive is the viewer default. The highlighted route inspector remains a reference-speed, free-flow estimate, independent of each person's live decisions.

Below the map, **Stadium experiments** runs the full comparison matrix. Enter up to three populations (1–1,000) and up to three integer seeds. Each population/seed produces eight cases: two routing modes × two crowd profiles × two exit scenarios. The defaults are 100 people, seed 549, and a 1,800-second run limit. **Run limit (simulated seconds)** accepts whole numbers from 60 to 7,200; try 3,600 for large exit-closure scenarios. Results include a table, evacuation-time bars, paired differences, summaries across seeds, and selectable evacuation/waiting curves. Download results, time-series, and statistics CSVs before reloading. Cancel retains finished runs and discards the interrupted case. Leaving the stadium cancels a batch.

Experiments use their own default network and all seating sections, not live closures, connection edits, selected seating subsets, or individual overrides. This keeps the matrix reproducible. Live runs are paused when a batch starts. A background Web Worker performs the experiments without blocking the controls. Large batches can take minutes.

**Comparison local movement** selects passing (default) or the queue baseline for every case in a batch. It is independent of the live crowd's selector. The eight-case matrix holds movement mode fixed; run another batch and download both sets to compare movement policies. Results use model version `stadium-movement-v2`, include movement mode in every CSV, and report attempted/completed passes in the results CSV. Routing summaries never pair different movement modes.

The recorded v1 benchmarks below remain historical evidence for the previous movement algorithm. They are not measurements of the new passing model, and queue mode in v2 is not a promise of bit-identical v1 replay.

For repeatable headless measurements:

```powershell
npm run benchmark:stadium -- --populations=100,500,1000 --seeds=549
```

This writes `docs/benchmarks/stadium-summary.csv`, `stadium-time-series.csv`, `stadium-statistics.csv`, and `stadium-environment.json`. Re-running replaces those generated measurements. Use `--output=docs/benchmarks/movement-v2` to preserve the historical baseline. Add `--movement=queue` for the queue baseline (`passing` is the default), `--seeds=549,550,551` for repeated seeds, and `--time-limit=3600` to extend each run. Files are refreshed after each finished case, including counts of completed jobs and a `batchComplete` flag in the environment file. An interrupted case is not saved. Physical simulation outcomes are deterministic; compute timings depend on host load and pauses.

For example, run a repeated-seed batch without replacing the initial baseline:

```powershell
npm run benchmark:stadium -- --populations=100,500 --seeds=549,550,551 --time-limit=1800 --output=docs/benchmarks/repeated-seeds
```

The [recorded 24-run comparison](benchmarks/README.md) includes all completed and timed-out outcomes for populations 100, 500, and 1,000 with seed 549.

## What the algorithm does

The baseline uses fixed reference-speed travel costs (1.2 m/s) and updates itineraries when network settings change. Adaptive routing adds feedback from the moving crowd:

1. Every 2 simulated seconds, measure occupancy on each directed edge, people waiting at entrances, and stopped upstream walkers within 15 m of a transfer. Surface connectivity is explicit; overlapping drawing layers never share traffic counts.
2. Estimate an additional delay per edge. With length `L`, occupancy `n`, entrance/upstream queue `q`, and headway `h`, use `load = n*h/max(L, 1.1)`. The assumed extra time is `q*service + referenceTravelTime*min(3, 2*load²)`. Walking uses `h=1.1 m` and `service=1.1/1.2 s`; transfers use `h=1.6 m` and the larger of `1/capacity` or `1.6*travelTime/max(L,1.6)`. Smooth with `newDelay = 0.65*oldDelay + 0.35*observedDelay`.
3. Solve reverse, multi-source Dijkstra from all open exterior gates. This yields a shared graph travel-time potential for each 0.1 m/s speed band. Walking and transfer costs reflect that band's preferred speed. Actual movement keeps each person's exact speed. Fields and extracted candidate routes are cached until the next traffic sample or network revision.
4. Each person retains an itinerary. At nodes, reconsider after 8 seconds plus a deterministic 0–1.75 s stagger. Evaluate the remaining committed route and alternative against the **same current traffic snapshot and start node**. Switch only if the alternative saves at least 3 seconds and more than 15%, and does not revisit a previously departed node. These rules reduce oscillation and discretionary reversals.
5. A closed connection invalidates a committed route immediately, bypassing cooldown and improvement checks. Replanning still occurs at real nodes. People already on an edge finish it, preserving transfer duration, body clearance, and population conservation. Forced recovery can retrace a prior node if necessary.

This is a dynamic graph-cost policy built around shared shortest-time potentials, not a learned controller. Delay coefficients, queue lookahead, speed bands, smoothing and switching thresholds are transparent experimental assumptions. Compare their effect before claiming improvement. In particular, the adaptive/baseline comparison changes both congestion costs and preferred-speed awareness; it is a comparison of these complete policies, not an isolated ablation of the congestion term.

## Research context and tradeoffs

[Treuille, Cooper and Popović, *Continuum Crowds* (SIGGRAPH 2006)](https://grail.cs.washington.edu/projects/continuum-crowds/) demonstrates dynamic potential fields combining global navigation with crowd motion. It motivates considering current traffic during route selection. Our implementation uses an explicit multi-level graph, individual bodies and a queue-delay heuristic; it does **not** reproduce their continuum solver, equations, or collision method.

[ORCA](https://gamma-web.iacs.umd.edu/ORCA/) addresses local reciprocal collision avoidance and remains a separate future comparison. Stadium movement uses swept-disc reservations, conservative junction ownership and bounded lateral passing on modeled wide corridors. It does not implement ORCA's continuous velocity-space optimization. See [movement assumptions](AGENT_BEHAVIOR.md).

Adaptive costs are estimates of present conditions, not predictions of future arrivals or a globally optimal evacuation assignment. Traffic measurements can lag, queues can be double-penalized conservatively by occupancy and waiting terms, people can herd toward the same alternative, and avoiding revisits can reject a beneficial detour. The current model has one ramp per upper deck, so adaptive routing cannot invent an alternative for an isolated deck. The small graph and speed-band sharing bound search work, but collision and junction processing can still dominate runtime.

Maximum-population testing exposed a movement conflict where the schematic south stair approaches run close to section 136/140 aisles. Those aisle/approach pairs now share one reservation on the same surface, while ordinary circulation merges retain node reservations. This prevents a waiting aisle occupant from trapping the stair approach's node owner. The rule adds no graph shortcuts and applies identically to both routing modes. It is conservative: it serializes the affected corridors and can reduce their throughput. A dedicated crowded-crossing test checks completion and separation at every step.

## Experimental protocol and metrics

- **Population/seed:** equal allocation across all modeled sections, with exactly the same starting seats across the four routing/profile combinations. Profiles use a separate random stream. Uniform versus mixed changes speed, body size and response delay together; it is not a speed-only experiment.
- **Open:** every default connector and gate remains open.
- **East closure:** close `gate-east` at the fixed-step boundary at 35 s, before further movement. Previously admitted people finish their gate edge. All other default connections remain open.
- **Clock:** 1/30 s fixed steps, configurable cap (default 1,800 s). No rendering, wall-clock duration, playback multiplier or active map layer affects the simulation. A longer cap preserves the same simulated trajectory until the earlier stopping time; it does not speed up movement or change route costs.
- **Completion:** total evacuation time is recorded only if every person exits. Blocked and timed-out cases have a blank completion time, their actual evacuated count, and explicit status. Never compare their elapsed time as a successful evacuation.
- **Mean exit:** average elapsed exit time among those who evacuated; incomplete cases are explicitly partial.
- **Mean wait:** integrated stopped-person seconds after response delay, divided by the initial population. Includes waiting for seat access and blocked landings, excludes time stranded with no route and time moving slowly. Incomplete runs include only waiting accumulated through their stopping time. Peak wait uses the same definition. Time-series waiting additionally includes initial response delay, as labeled.
- **Routes/gates:** voluntary switches, forced reroutes, shared potential searches, and counts through each gate group. A route change can retain the same destination gate.
- **Performance:** total update compute time, step count, mean and maximum update milliseconds. Includes simulation/routing, excludes construction, chart rendering, CSV formatting and worker scheduling gaps. These are host-specific timings, not browser FPS guarantees.
- **Curves:** samples every 5 simulated seconds plus the initial and final state. They do not capture every between-sample spike.

For a presentation, report paired differences at the same population/seed/profile/scenario, include worse or incomplete outcomes, and repeat several seeds before drawing general conclusions. Geometry, movement parameters and demographic coefficients remain schematic assumptions rather than a validated SHI Stadium evacuation model.

## Summaries across seeds

The **Summary across seeds** table groups runs by model version, movement mode, population, profile, scenario, and time limit, then pairs baseline and adaptive by seed. A seed with only one finished policy is reported as unmatched and excluded from paired statistics. Duplicate results for one policy/seed are rejected instead of being counted twice.

For each pair in which both policies complete, the reduction is `baselineSeconds - adaptiveSeconds`; its percentage is `100 * reduction / baselineSeconds`. Positive values mean adaptive was faster; negative values retain regressions. The reported percentage is the mean of those per-seed percentages, not the percentage change between averaged times. Baseline and adaptive completion means use that same fully completed subset.

The table and statistics CSV report the number of matched and completed pairs. With two or more observations, spread is the **sample standard deviation**, using denominator `n - 1`. This describes variability among the tested seeds, not a confidence interval or statistical significance. A single observation has no standard deviation; zero observations have no mean. Missing statistics are blank in CSV.

Incomplete pairs remain in completion/timeout/blocked counts and in the mean number evacuated at each run's stopping point. They never enter completion-time means as if the cap were their evacuation time. If one policy completes and the other times out, the completed-pair mean can select an easier subset; use the completion counts and per-run table to interpret it. Evacuated-at-stop statistics include blocked cases that may stop before the cap and are labeled accordingly.

The [follow-up measurements](benchmarks/FOLLOW_UP.md) report repeated seeds and longer runs separately from the original fixed-limit batch.

## Validation

Automated checks compare the shared potentials against the existing shortest-time search, verify queue-driven exit changes, cooldown/hysteresis and closure overrides, check body clearance throughout an adaptive closure run, and verify paired seats, deterministic reruns, timeout reporting and CSV shape. Browser checks exercise both routing modes, worker completion/cancellation, charts, CSV downloads and mobile layout.

Generated measurements and their interpretation are recorded in the [benchmark report](benchmarks/README.md), including incomplete and unchanged outcomes.
