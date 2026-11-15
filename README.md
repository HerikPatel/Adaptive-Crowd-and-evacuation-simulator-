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
- **Start / Pause / Reset** control the simulation. Reset restores seed 549, positions, speeds, exits, paths, density, queue, metrics, and timer. It retains the selected layout, population, routing strategy and local movement mode. Positions are reproducible within each layout.
- **Routing strategy:** Shortest Path or Congestion Aware. Changing strategy resets the run for comparison.
- **Local movement:** Predictive steering (default) or ORCA for both building maps. Changing movement resets the crowd for a matched comparison; results label the mode. Both share the same routing and final collision checks. See the [ORCA implementation and limitations](docs/ORCA.md).
- **Agent population:** enter a whole number from 1 to the layout's capacity, capped at 1,000. Applying a new population resets the run.
- **Block Exit A / Re-open Exit A** works during a run or while paused. Closing A invalidates its paths immediately and prioritizes affected agents for rerouting. Reopening makes A a candidate at the next cooldown; it does not force a switch.
- **Show paths / spatial hash / density values** provide optional debug overlays.
- An animated heatmap shows local congestion below agents. Amber agents have recently changed exits. A blocked exit is red with an × marker.
- FPS, frame time, remaining agents, elapsed time, evacuation totals, density, exit utilization, and route switches remain visible.
- Backgrounding the page automatically pauses the simulation; press Start to resume.

## SHI Stadium map study

Choose **SHI Stadium · Schematic simulation** from the **Building layout** menu, then **Open stadium**. The same map choice in the building simulation controls pauses that run and opens the stadium. Switch between the lower bowl, separate upper decks, and concourse/gates; select a feature for source information; zoom and drag to inspect the map. The feature selector also works on mobile and with a keyboard.

Start with **100 spectators**, or choose 1–1,000 and a seating preset. **Start stadium run**, **Pause**, and **Reset crowd** control a deterministic run; playback supports 1×, 4× and 8×. Spectators follow assumed aisles, separate access walks, timed passages/ramps/stairs and the concourse to exterior gates. Transfers enforce entry rates and wait for available landing space. Live counts separate each surface, people in transit, and people outside. Changing the visible layer leaves every level advancing; leaving the stadium or hiding the tab pauses the run.

Choose a start section and destination gate to inspect a route independently of the crowd. Inspect a gate, connector, or lower section to close its connection or edit transfer assumptions. These changes pause movement. Existing travelers finish their current edge; subsequent entries use the new network, and routes are recalculated at nodes. Reopening restores routes to stranded spectators. **Reset crowd** preserves network settings; **Reset route assumptions** restores open connections and defaults.

**Crowd behavior** now offers a synthetic adult mix with individual walking speed, response delay and body size, or a uniform 1.2 m/s comparison using identical starting seats. Open **Inspect & edit an individual** or click a spectator to see their profile. Before starting, edit age, gender label, height, weight, response delay, pace factor or an explicit speed override. Reset restores seeded profiles. Gender labels do not impose a speed multiplier; the demographic speed formula is an illustrative assumption.

Movement checks swept circular bodies on each surface and transfer channel. **Local movement** selects predictive passing on sufficiently wide, long corridors or the queue baseline. Faster walkers can move into an outside lane, pass, and merge before a junction; narrow aisles and transfers retain queues. Lateral motion uses the person's walking-speed budget, and opposing lanes are never borrowed. A blocked landing retains the person in transit. See [individual behavior, collision algorithm and evidence](docs/AGENT_BEHAVIOR.md).

**Stadium routing** offers a fixed free-flow baseline and adaptive travel-time potentials using live corridor occupancy and transfer queues. Adaptive routing samples traffic every 2 seconds and uses committed itineraries, a cooldown and an improvement threshold to reduce route switching. Closed routes trigger recovery at nodes. The route inspector remains a free-flow reference.

**Stadium experiments**, below the map, compares routing modes, uniform/individual profiles, and open/east-gate-closure scenarios with identical seeds and starting seats. Choose populations, up to three seeds, and a run limit of 60–7,200 simulated seconds. Run a background batch, inspect charts, paired differences and variability across seeds, and download results/time-series/statistics CSVs. Incomplete runs remain explicit and never count as completed evacuation times. A headless equivalent is `npm run benchmark:stadium -- --populations=100,500,1000 --seeds=549`; add `--time-limit=3600` for longer runs and `--output=docs/benchmarks/my-comparison` to preserve previous measurements. See [algorithm, experimental protocol, metrics and limitations](docs/STADIUM_EXPERIMENTS.md).

Geometry, scale, widths, profile distributions, speeds, and transfer settings remain experimental assumptions. Route-inspection times use the reference speed without queues; live times include individual speeds, response delays and waiting. See the [map study and implementation sequence](docs/SHI_STADIUM_MAP_PLAN.md) for sources and map assumptions.

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
  maps/stadium.ts            Schematic stadium surfaces, sections, gates, evidence
  maps/stadiumNavigation.ts  Assumed corridors, explicit transfers, geometry validation
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
    StadiumRouter.ts        Surface-aware Dijkstra, closures, connectivity inspection
  collision/
    CollisionSystem.ts      Predictive steering, joint contact solver, sweep checks
    OrcaSolver.ts           Optional reciprocal velocity constraints and linear programs
    PredictiveMotion.ts     Continuous relative-motion clearance
    StadiumCorridor.ts      Corridor width and continuous passing lanes
  rendering/
    Renderer.ts             Map, exits, paths, agents, and debug overlays
    HeatmapRenderer.ts      Cached 10 Hz density layer
  ui/
    Controls.ts             Input bindings and metric readouts
    PerformanceStats.ts     Browser render cadence measurement
    StadiumViewer.ts        Interactive SVG stadium layers and feature inspection
    StadiumRoutes.ts        Route overlay, transfer settings, connectivity status
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

Every fixed update rebuilds a 32 px spatial hash of active agents. In the default predictive mode, desired motion, separation, and wall repulsion produce a preferred velocity. A deterministic velocity sampler anticipates the eight nearest neighbors, with a right-side preference for head-on encounters. Expensive predictions are staggered at 10 Hz and refreshed early when the desired heading changes. Agents that remain stopped increasingly favor resuming motion; hard clearance is enforced separately at every 60 Hz step.

Optional ORCA computes reciprocal agent-agent constraints and solves for a preferred velocity within each person's speed limit at 60 Hz. It uses up to 16 neighbors, a 0.8-second agent horizon, and conservative grid-wall supporting planes over 0.2 seconds. Both modes produce proposals from a shared snapshot before the same independent contact stage. See [ORCA details and third-party attribution](docs/ORCA.md).

The joint contact solver projects nearby agents' proposed displacements together, so touching queues can advance without treating each follower as a stationary obstacle. Up to 48 deterministic passes enforce contact, speed and wall-normal constraints, including rounded doorway corners. An independent check of complete simultaneous relative-motion sweeps shortens unresolved motions by a shared fraction within each contact group before committing positions. The hard checks include every nearby body, beyond either predictor's neighbor limit. ORCA proposals that already pass every body, wall and speed check skip the corrective iterations; otherwise the common correction stage may change their velocities. The predictive baseline retains its original contact behavior.

Circle-versus-wall checks use X/Y sliding and small movement substeps; path lookahead checks body clearance at corners. Door closures prepare body-clear relocations atomically and reject the edit if an affected person cannot fit on adjacent floor. They never force overlapping placement.

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

Unit/scenario tests cover routing, hysteresis, spatial queries, simultaneous body sweeps, wall clearance, head-on encounters, touching queues, dense evacuation, live closures, deterministic reset, stadium passing/merging, and queue baselines. Large-map runs check body and wall clearance and speed budgets at every fixed step, including people exiting during that step.

Browser tests use locally installed Chrome (`channel: 'chrome'` in `playwright.config.ts`) and start/reuse Vite on port 5174. Install Chrome or change the channel to an installed browser. Tests exercise controls, pause, dynamic closure, completion, pixel-identical reset, responsive layout, and record stress-run FPS samples. Screenshots and performance attachments go to `test-results/`.

See [manual scenarios](docs/MANUAL_TESTS.md) for the assignment demo and hardware performance procedure, and [validation results](docs/VALIDATION.md) for the checks and measurements performed. Headless simulation timings do not establish browser FPS targets.

## Performance testing

Target ≥30 FPS with 200 agents and ≥20 FPS with 500 agents on a mid-range laptop. These are measurement targets, not guarantees across hardware.

Build and run `npm run preview`. Use a foreground browser tab at a fixed window size. Turn debug overlays off, run each population from reset, and record FPS/frame time during the crowded first 5–20 simulation seconds. Repeat with A blocked at five seconds. Record browser version, OS, CPU/GPU, window size, routing mode, and observed minimum/typical FPS. Repeat with overlays enabled separately. Use the always-visible stage readout in the demo recording. If simulated seconds lag wall time, report that alongside FPS.

## Known limitations

- Grid movement requires separated starting bodies and can conservatively stop when contact constraints cannot be resolved. Stadium passing requires sufficient assumed corridor width and room to merge. Neither solver guarantees completion for arbitrary edited layouts; see the agent behavior notes.
- Simplified density, geometry, speeds, and crowd behavior are not validated for evacuation planning.
- No validated modeling of hazards, disabilities or panic. The stadium has explicit stairs and directed transfers; original-grid density may include agents separated by an adjacent wall.
- Local routes can still exhibit temporary crowd hesitation. Cooldowns/hysteresis reduce oscillation without mathematically guaranteeing none.
- Render catch-up work and debug overlays affect performance; results must be measured on the target laptop.
- Crowd size is capped at 1,000 and limited by available spawn space. The stadium is a schematic, not a full-attendance model.

## Future work

Calibrated crowd models, improved anticipatory avoidance, accessible egress, and presentation-laptop profiling remain future work. The building editor and stadium comparison/CSV tools are implemented; general layout import/export and full 3D rendering remain separate extensions. See the [current status and proposed remaining work](docs/ROADMAP.md) for concrete next tasks and completion checks.
