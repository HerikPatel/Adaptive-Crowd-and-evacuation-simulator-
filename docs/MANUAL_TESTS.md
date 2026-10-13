# Assignment 3 manual scenarios

Record the population, strategy, seed, browser/hardware, total time, peak density, exit counts, exit clear times, average time, route switches, FPS, and frame time for each run. Reset between comparisons.

## 1. Normal evacuation

1. Choose 100 agents and Congestion Aware. Reset and Start.
2. Watch agents follow the corridor and choose exits. Enable paths briefly to inspect route choices.
3. Confirm heatmap concentrations move with the crowd, agents remain on the floor, and amber rerouting is occasional rather than continuous.
4. Pause: positions and elapsed time must freeze. Start resumes.
5. Let the run complete: remaining = 0, A+B usage = 100, total and average times are populated.
6. Reset and repeat. With the same timed inputs, initial positions and results should match.
7. Repeat under Shortest Path and compare results. Congestion-aware routing need not improve every metric in every scenario.

## 2. Block Exit A after five seconds

1. Reset to 100 / Congestion Aware; Start.
2. At elapsed ~5 s, click Block Exit A.
3. A turns red. A-targeted agents stop following invalid paths, turn amber, then use B as their queue entries are processed.
4. Confirm no wall penetration, including during reversal out of A's branch. Continue to completion.
5. For this timing, all agents should leave through B. Total evacuated = 100, remaining = 0, route switches > 0.
6. Repeat, reopening A after several seconds. It becomes available, but agents should not all instantly switch back.

## 3. High congestion near A

1. Select 500 / Shortest Path. Start with paths visible and both exits open.
2. Observe concentrations near A's single-cell approach and note exit usage and completion time.
3. Reset with 500 / Congestion Aware. Observe congestion-dependent route changes and compare exit utilization, switches, and total time.
4. Agent groups should emerge from costs, not an enforced 50/50 split. A dense branch should remain colored briefly as smoothing catches up when agents move away.
5. The automated routing test separately sets a controlled high-density A branch and checks that its cost increases enough to choose B. The UI does not inject synthetic density.

## 4. 500-agent stress test

1. Use a production build (`npm run build`, `npm run preview`), foreground tab, fixed viewport, overlays off.
2. Run populations 100, 200, 500 separately from reset with Congestion Aware.
3. Record FPS/frame time at 5, 10, 15, and 20 simulation seconds, including the lowest sustained values.
4. Repeat with A blocked at five seconds, then with debug overlays enabled.
5. Compare against ≥30 FPS at 200 and ≥20 FPS at 500. Record browser, OS, CPU/GPU, viewport, and whether simulated time kept up with wall-clock time.
6. Verify the FPS readout stays visible and both high-count runs can finish. Do not infer browser FPS from headless unit-test execution time.

## Additional edge checks

- Block A before Start; only B should be selected.
- Block/reopen while paused; the clock must not advance.
- Change strategy/population mid-run; a clean paused reset should occur.
- Reset after completion or closure; exits, agent positions, metrics, heatmap, queue, and timer return to the baseline.
- Background the tab and return; simulation is paused, with no accumulated catch-up jump.
- At phone width, controls remain reachable and the page does not overflow horizontally.
