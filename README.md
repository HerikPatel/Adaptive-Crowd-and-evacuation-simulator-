# Adaptive Crowd and Evacuation Simulator

CS 549 · Assignment 3 MVP. A browser-based, deterministic experiment in evacuation routing, local crowd avoidance, and changing exit availability. The prototype demonstrates the engineering approach from Assignment 2; it is not a validated life-safety model.

## Run

Use Node.js 22.12+ (tested with Node 24) and npm.

```sh
npm install
npm run dev
```

Open the URL printed by Vite. Production build and local preview:

```sh
npm run build
npm run preview
```

## MVP and controls

- **Building layout:** the default **Distributed wings** map is 70×42 cells (1400×840 simulation pixels), with agents spread across four wings linked by a ring and central passages. Exit A faces west, while Exit B faces south. A has a narrow bottleneck and B has a wide approach; the cheaper route depends on an agent's location and congestion.
- The original **50×30 bottleneck** map remains available for Assignment 3 comparisons, with its shared start area and two east-facing exits. Changing layout resets the run and resizes the Canvas automatically.
- **Start / Pause / Reset** control the simulation. Reset restores seed 549, positions, speeds, exits, paths, density, queue, metrics, and timer. It retains the selected layout, population, and routing strategy. Positions are reproducible within each layout.
- **Routing strategy:** Shortest Path or Congestion Aware. Changing strategy resets the run for comparison.
- **Agent population:** 100 (default), 200, or 500. Changing population resets the run.
- **Block Exit A / Re-open Exit A** works during a run or while paused. Closing A invalidates its paths immediately and prioritizes affected agents for rerouting. Reopening makes A a candidate at the next cooldown; it does not force a switch.
- **Show paths / spatial hash / density values** provide optional debug overlays.
- An animated heatmap shows local congestion below agents. Amber agents have recently changed exits. A blocked exit is red with an × marker.
- FPS, frame time, remaining agents, elapsed time, evacuation totals, density, exit utilization, and route switches remain visible.
- Backgrounding the page automatically pauses the simulation; press Start to resume.

## Stack and architecture

Vite, strict TypeScript, HTML/CSS, and Canvas 2D. There are no runtime packages, physics engines, runtime AI, or external pathfinding dependencies. TypeScript/tsx and Playwright are development tools only.

```text
src/
  main.ts                    DOM shell, requestAnimationFrame, accumulator
  styles.css                 Responsive control panel and Canvas layout
  config/simulationConfig.ts Tunable constants and routing/exit types
  maps/mvpMap.ts             Original bottleneck floor plan
  maps/largeMap.ts           Larger building with west/south exits
  maps/maps.ts               Layout catalog, spawn areas, and labels
  simulation/
    Simulation.ts           Seeded spawn, fixed updates, prioritized route queue
    Agent.ts                Continuous agent state
    Grid.ts                 Immutable cell types plus separate density arrays
    SpatialHash.ts          Exact-radius nearby-agent queries
    Density.ts              Neighborhood density and temporal smoothing
    Metrics.ts              Evacuation records and aggregate measurements
  pathfinding/
    PriorityQueue.ts        Stable binary min-heap
    AStar.ts                Manual cardinal A* with Manhattan heuristic
    CongestionRouter.ts     Exit comparison, commitment, and hysteresis
  collision/
    CollisionSystem.ts      Soft separation, wall avoidance, swept local checks
  rendering/
    Renderer.ts             Map, exits, paths, agents, and debug overlays
    HeatmapRenderer.ts      Cached 10 Hz density layer
  ui/
    Controls.ts             Input bindings and metric readouts
    PerformanceStats.ts     Browser render cadence measurement
  utils/                    Vector helpers and seeded PRNG
tests/                      Unit tests, full-run scenarios, browser tests
```

## Routing

A* explores four cardinal neighbors and uses Manhattan distance to the nearest cell of the requested exit as its admissible heuristic. Each candidate exit is searched separately, and the lowest-cost reachable candidate wins. An exit may span multiple cells; Exit B has three exit cells for a wider opening.

Shortest Path assigns cost `1` per step. Congestion Aware uses:

```text
edgeCost = 1 + congestionWeight × normalizedDensity
```

The default congestion weight is 3. Agents follow cell-center waypoints in continuous pixel coordinates. Local lookahead skips a waypoint only when the agent circle can travel to the next waypoint without intersecting a wall. This avoids deadlocks caused by several agents trying to occupy exactly the same waypoint center.

### Congestion and heatmap

For display units, each 20 px grid cell represents 1 m². Each simulation step, spatial-hash queries count agents in each walkable cell's 3×3 neighborhood. Dividing by the number of walkable cells in that neighborhood gives local agents/m². Peak density is the maximum unsmoothed value observed during a run.

Density normalizes against 2.2 agents/m² and clamps to 0–1. At 10 Hz, both routing and heatmap use `previous × 0.8 + current × 0.2`. The Canvas heatmap is cached and rebuilt only when that snapshot changes. Congestion is separate from map cell types. Values describe this simplified model, not a calibrated real building.

### Oscillation and herding prevention

1. Each agent has a 750 ms minimum replan cooldown plus a seeded 0–450 ms individual offset.
2. Both routes are compared from the current position under the same smoothed density snapshot. An old whole-trip cost is never compared to a new shorter remaining trip.
3. Switching exits requires `newCost < currentCost × 0.85`. The selected exit remains committed otherwise. Same-exit reroutes also require meaningful improvement.
4. Blocked/unreachable paths bypass commitment and enter the urgent queue. Waiting agents stop rather than follow a stale blocked route.
5. At most five agents are replanned per fixed update; initial routing is batched too. No artificial equal-group assignment is used.

### Collision and determinism

Every fixed update rebuilds a 32 px spatial hash of active agents. Separation uses only nearby agents, with deterministic handling of coincident centers. Desired motion, separation, and wall repulsion combine into speed-capped velocity. Soft separation can slow an agent and reduce overlap; it does not guarantee zero overlap at high density.

Circle-versus-wall checks resolve candidate movement with X/Y sliding. Substeps prevent tunneling, and local lookahead checks circle clearance at corners. Movement decisions use a shared snapshot before positions are committed. If closing A would intersect an approaching circle, that circle is moved minimally onto the adjacent floor before replanning.

The fixed timestep is 1/60 s. Seeded initial positions, speed variation (0.9–1.1×), stable A* tie-breaking, and simulation-time cooldowns make identical fixed-step input sequences reproducible. Human clicks at different simulation times produce different runs. Frame deltas are capped at 100 ms to bound catch-up work; under sustained overload simulated time may lag real time. Five replans is a **fixed-update** budget: a catch-up render can include several updates. FPS is measured separately from the deterministic state.

## Metrics

Times are seconds from the first simulation update; paused wall-clock time is excluded. Evacuation is recorded when the agent center enters an active exit cell. Evacuated agents leave collision and route updates.

- **Total evacuation time:** time at which the final agent leaves; blank until completion.
- **Average evacuation time:** mean departure time of agents evacuated so far.
- **A/B last / final clear:** last observed departure through that exit while running; final time-to-clear once the complete run finishes. An unused exit shows “—”. This avoids claiming an exit has cleared while future agents could still select it.
- **Exit switches:** actual changes between A and B, excluding initial assignments and same-exit replans.
- **Peak density:** maximum unsmoothed local agents/m² across all steps and walkable cells.
- **FPS / frame time:** render cadence averaged over approximately 0.5 s. Frame time is the actual interval between rendered frames, not only update CPU cost.

## Tests

```sh
npm test
npm run test:browser
```

Unit/scenario tests cover cardinal wall-free A*, reachable exits, blocked routes, congestion costs, hysteresis, spatial-hash boundaries, circle-wall tunneling, soft separation, full 100/200/500-agent evacuation, five-second closure, and exact reset/re-run determinism.

Browser tests use locally installed Chrome (`channel: 'chrome'` in `playwright.config.ts`) and start/reuse Vite on port 5174. Install Chrome or change the channel to an installed browser. Tests exercise controls, pause, dynamic closure, completion, pixel-identical reset, responsive layout, and record stress-run FPS samples. Screenshots and performance attachments go to `test-results/`.

See [manual scenarios](docs/MANUAL_TESTS.md) for the assignment demo and hardware performance procedure, and [validation results](docs/VALIDATION.md) for the checks and measurements performed. Headless simulation timings do not establish browser FPS targets.

## Performance testing

Target ≥30 FPS with 200 agents and ≥20 FPS with 500 agents on a mid-range laptop. These are measurement targets, not guarantees across hardware.

Build and run `npm run preview`. Use a foreground browser tab at a fixed window size. Turn debug overlays off, run each population from reset, and record FPS/frame time during the crowded first 5–20 simulation seconds. Repeat with A blocked at five seconds. Record browser version, OS, CPU/GPU, window size, routing mode, and observed minimum/typical FPS. Repeat with overlays enabled separately. Use the always-visible stage readout in the demo recording. If simulated seconds lag wall time, report that alongside FPS.

## Known limitations

- Soft local avoidance reduces overlap but is not rigid-body collision resolution; very dense crowds can overlap temporarily.
- Simplified density, geometry, speeds, and crowd behavior are not validated for evacuation planning.
- No anticipation of hazards, disabilities, panic, stairs, or one-way flows. Nearby density may include agents separated by an adjacent wall.
- Local routes can still exhibit temporary crowd hesitation. Cooldowns/hysteresis reduce oscillation without mathematically guaranteeing none.
- Render catch-up work and debug overlays affect performance; results must be measured on the target laptop.
- The available floor plans and 500-agent maximum are fixed for the MVP.

## Future work

Calibrated crowd models, improved anticipatory avoidance, larger-map routing experiments, and hardware profiling. A building editor, replay/scrubbing, CSV export, and a 2.5D view are intentionally deferred beyond Assignment 3.
