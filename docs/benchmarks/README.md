# Stadium comparison results

The November 13–14, 2026 batch contains **24 runs / 12 matched pairs** of model version `stadium-traffic-v1`, all with seed 549. Adaptive routing reduced completion time in the six completed 500- and 1,000-person pairs, left total completion time unchanged in the four 100-person pairs, and evacuated more people within the time limit in the two incomplete pairs. These are single-seed results from a schematic model, not predictions for an actual SHI Stadium evacuation.

The [follow-up report](FOLLOW_UP.md) adds repeated seeds and a longer limit for the 1,000-person runs. The original CSVs below retain their original 1,800-second protocol.

## Reproduce and inspect

These artifacts are historical v1 measurements. The current code uses `stadium-movement-v2`; running the same scenario parameters now produces new results and cannot reproduce the v1 trajectories. Keep new measurements in a separate directory and select the movement mode explicitly:

```powershell
npm run benchmark:stadium -- --populations=100,500,1000 --seeds=549 --movement=passing --output=docs/benchmarks/movement-v2-passing
```

Use `--movement=queue` with a different output directory for the current queue baseline. See the [experiment protocol](../STADIUM_EXPERIMENTS.md) for the algorithms, metrics, and browser controls. Historical raw artifacts:

- [Summary CSV](stadium-summary.csv): status, completion time, waiting, routing counters, gate counts, and update timings.
- [Time-series CSV](stadium-time-series.csv): evacuation, waiting, and stranded counts at five-second intervals, plus initial/final states.
- [Environment JSON](stadium-environment.json): model version, host, runtime, and measurement provenance.

Every case uses the default multi-level stadium network and all modeled seating sections. Populations are 100, 500, and 1,000. Each population has both uniform and mixed profiles, both routing policies, and both scenarios: all exits open, or the east gate closed at 35 simulated seconds. Initial seats are matched across policies and profiles. Updates use a fixed 1/30-second step with a 1,800-second limit. Both policies share the same movement and collision rules, including the aisle/stair conflict fix.

## Completed pairs

Times and mean waits are simulated seconds, rounded to one decimal. Reduction is `(baseline - adaptive) / baseline`, calculated from unrounded completion times. Mean wait is per initial person, after response delay; it is not time spent walking slowly.

| People | Profile | Scenario | Baseline completion | Adaptive completion | Reduction | Baseline mean wait | Adaptive mean wait |
| ---: | --- | --- | ---: | ---: | ---: | ---: | ---: |
| 100 | Uniform | Open | 165.5 | 165.5 | 0.0% | 4.6 | 4.6 |
| 100 | Uniform | East closed at 35 s | 250.5 | 250.5 | 0.0% | 23.2 | 22.4 |
| 100 | Mixed | Open | 202.1 | 202.1 | 0.0% | 7.6 | 7.2 |
| 100 | Mixed | East closed at 35 s | 240.5 | 240.5 | 0.0% | 19.9 | 19.3 |
| 500 | Uniform | Open | 548.7 | 515.1 | 6.1% | 172.4 | 162.8 |
| 500 | Uniform | East closed at 35 s | 1,099.9 | 1,004.5 | 8.7% | 331.9 | 287.4 |
| 500 | Mixed | Open | 527.4 | 494.7 | 6.2% | 159.2 | 154.0 |
| 500 | Mixed | East closed at 35 s | 1,051.1 | 954.7 | 9.2% | 311.9 | 273.1 |
| 1,000 | Uniform | Open | 1,066.9 | 1,000.2 | 6.3% | 396.5 | 367.2 |
| 1,000 | Mixed | Open | 1,025.5 | 985.3 | 3.9% | 379.1 | 360.2 |

## Incomplete pairs

All four 1,000-person east-closure runs reached the 1,800-second cap before everyone exited. Their completion times are **unknown**, recorded as blank in the CSV. Compare evacuated counts at the common horizon instead:

| People | Profile | Baseline evacuated | Adaptive evacuated | Additional people out | Baseline mean wait through cap | Adaptive mean wait through cap |
| ---: | --- | ---: | ---: | ---: | ---: | ---: |
| 1,000 | Uniform | 901 (90.1%) | 972 (97.2%) | 71 | 716.4 s | 619.7 s |
| 1,000 | Mixed | 918 (91.8%) | 989 (98.9%) | 71 | 695.6 s | 599.0 s |

The final samples show increasing exit counts and zero stranded people in all four cases. They were still progressing at the cap; these observations do not establish when the remaining people would finish. Waiting totals for these runs include only time accumulated through the cap. Mean exit time in the raw CSV covers only those who exited and must not be treated as the whole crowd's average.

## Interpretation and limits

At 500 people, adaptive routing reduced completion time by 6.1–9.2% in these four pairs. At 1,000 people with open exits, reductions were 3.9–6.3%. The unchanged completion times at 100 people show that a route change or a small reduction in mean waiting does not necessarily improve the last person's exit time.

Gate counts show redistribution: for 1,000 uniform people with open exits, west-gate usage increased from 140 to 199 while north-gate usage decreased from 294 to 235. This is consistent with shifting demand away from a busy route. It is not proof that the delay heuristic is optimal.

The comparison changes both congestion feedback and preferred-speed awareness. Uniform versus mixed profiles changes speed, body size, and response delay together. Neither comparison isolates every contributing factor. Geometry, capacities, queue-delay coefficients, and profile distributions remain modeling assumptions. The conservative reservations at corridor conflicts can constrain throughput.

Repeat with additional seeds, for example `--seeds=549,550,551`, before claiming a general improvement or estimating variability. A longer cap is also needed to measure complete evacuation of the 1,000-person closure cases. No learned controller, ORCA solver, or real stadium validation is claimed.

## Performance and validation

Timings use Node 24.13.1 on Windows with an AMD Ryzen 7 8840HS; full details are in the environment file. For the 1,000-person uniform open case, mean update duration was 2.08 ms for baseline and 2.21 ms for adaptive. These elapsed update measurements include simulation and routing but exclude rendering and construction. They are sensitive to host scheduling and pauses, and do not establish browser FPS or CPU utilization.

The initial 1,000-person mixed baseline closure run was interrupted during a host/session pause, inflating its maximum update interval beyond 14 hours. That case alone was repeated; every non-timing summary field and every time-series sample matched exactly. Its three timing fields were replaced with the repeated measurements (mean 1.29 ms, maximum 23.75 ms). The environment file records this correction.

The implementation passed the production build, 70 unit/simulation tests, and 14 browser tests against the production preview. Artifact checks confirmed 24 results and 12 matched pairs, gate totals equal to evacuated counts, blank completion times for incomplete runs, monotonic time and evacuation counts, and agreement between final samples and summaries. See [validation details](../VALIDATION.md).
