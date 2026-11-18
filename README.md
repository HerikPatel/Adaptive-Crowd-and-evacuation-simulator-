# Adaptive Crowd and Evacuation Simulator

An interactive crowd evacuation simulator for Rutgers University CS 549. Explore how building layouts, crowd composition, congestion, and exit closures affect evacuation using editable building maps and a multi-level schematic of SHI Stadium.

The project's two computer graphics pillars are **Pathfinding & Navigation** (shortest-path and congestion-aware routing, with replanning when routes change) and **Collision Detection** (agent-agent and agent-wall checks with avoidance responses). Reproducible experiments support comparisons between routing and movement algorithms. This is an educational model; its geometry and behavior assumptions are not validated for real evacuation planning.

## Current features

| Capability | Building maps | SHI Stadium |
| --- | --- | --- |
| Maps | Original bottleneck and Distributed wings | Lower bowl, separate upper decks, and concourse/gates |
| Crowd size | 1–1,000, limited by available spawn space | 1–1,000 spectators with seating presets |
| Routing | A* Shortest Path, Congestion Aware, or **Shared Flow Field** | Free-flow Dijkstra or adaptive travel-time potentials |
| Local movement | Predictive steering (default) or **ORCA** | Predictive passing or queue baseline; ORCA is future work |
| Individual behavior | Seeded 0.9–1.1× speed variation | Synthetic adult profiles, response delays, body sizes, and individual overrides |
| Editing | Draw/erase walls, add/widen up to eight exits, undo | Close connections and edit transfer assumptions |
| Results | Evacuation times, exit use, route switches, density, and render performance | Live crowd metrics, background comparisons, charts, and CSV/statistics exports |

The stadium uses a separate surface graph with explicit stairs, ramps, and transfers. Its levels advance together; selecting a layer changes the view. It is not a full 3D model.

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

## Building experiments and controls

- **Building layout:** the default **Distributed wings** map is 70×42 cells (1400×840 simulation pixels), with agents spread across four wings linked by a ring and central passages. Exit A faces west, while Exit B faces south. A has a narrow bottleneck and B has a wide approach; the cheaper route depends on an agent's location and congestion.
- **Campus building layouts:** five more presets, each with three or four exits so closures force real rerouting:
  - **Lecture hall · 60×40:** seat rows with side and centre aisles, a single front-left door (A), a double front-right door (B) and two rear doors (C, D).
  - **Classroom corridor · 70×32:** ten classrooms on a 4 m corridor, a narrow west stair (A), a wide east stair (B) and a south lobby (C).
  - **Open-plan office · 64×40:** desk islands, two meeting rooms and a central lift/restroom core that is not used for evacuation, with three stair exits.
  - **Dining hall · 66×42:** table grid and serving counter, a 10 m main entrance (B), a narrow west door (A) and an east patio door (C).
  - **Library stacks · 64×40:** long shelving rows, a main aisle and a reading room, with a main entrance (A), a fire exit (B) and a staff door (C).

  These are schematic building types, not surveyed Rutgers floor plans. Every layout keeps all floor connected to an open exit when Exit A closes, so the closure scenario works on all of them. Every layout works with every algorithm, in 2D and in 3D, and with the layout editor.
- The original **50×30 bottleneck** map remains available for Assignment 3 comparisons, with its shared start area and two east-facing exits. Changing layout resets the run and resizes the Canvas automatically.
- **Start / Pause / Reset** control the simulation. Reset restores seed 549, positions, speeds, exits, paths, density, queue, metrics, and timer. It retains the selected layout, population, routing strategy and local movement mode. Positions are reproducible within each layout.
- **Routing strategy:** Shortest Path, Congestion Aware, or Shared Flow Field. Shared fields reuse congestion-aware cost/direction maps across agents. Changing strategy resets the run for comparison.
- **Path-planning algorithm:** A* (default), Theta* / T* (any-angle), Dijkstra, Greedy best-first, or Breadth-first search. Used by Shortest Path and Congestion Aware routing (Shared Flow Field builds its own per-exit fields); changing it resets the run. See [Path-planning algorithms](#path-planning-algorithms).
- **2D plan / 3D view:** the toggle above the map switches between the Canvas floor plan and a three.js 3D view of the same run. Drag to orbit, scroll to zoom, right-drag to pan; **Reset camera**, **Top-down** and **Full-height walls** sit on the 3D view. Walls default to 1.1 m cutaway height so the crowd stays visible. The heatmap, exits, blocked doors, rerouting colors and **Show paths** all appear in 3D. Choosing a drawing tool switches back to 2D for editing.
- **Local movement:** Predictive steering (default) or ORCA for both building maps. Changing movement resets the crowd for a matched comparison; results label the mode. Both share the same routing and final collision checks. See the [ORCA implementation and limitations](docs/ORCA.md).
- **Agent population:** enter a whole number from 1 to the layout's capacity, capped at 1,000. Applying a new population resets the run.
- **Exit scenario:** start with all exits open, or schedule Exit A to close at five simulation seconds. Each configured exit also has its own **Block / Re-open** button for manual experiments. Closures invalidate affected paths and prioritize rerouting; reopening makes an exit eligible at the next cooldown. A closure is rejected if it would trap a floor area or require an unsafe body relocation.
- **Show paths / spatial hash / density values** provide optional debug overlays.
- An animated heatmap shows local congestion below agents. Amber agents have recently changed exits. A blocked exit is red with an × marker.
- FPS, frame time, remaining agents, elapsed time, evacuation totals, density, exit utilization, and route switches remain visible.
- Backgrounding the page automatically pauses the simulation; press Start to resume.

### Edit walls and exits

Choose **Edit layout first** in setup, or choose a drawing tool during a run to pause it. Click or drag with **Draw wall**, **Erase wall**, or **Add exit**; release to apply the stroke. Select **New exit** to add an opening or an existing exit to widen it. The map supports up to eight exit labels, A–H, each with independent controls and metrics.

**Place furniture** adds tables, desks or shelves: they block walking like walls, every planner routes around them, and the 3D view draws them as table-height blocks. **Erase wall** also removes furniture. **Paint start zone** marks where people start: once any zone exists, the crowd starts only inside start zones instead of the map's preset areas, and **Erase start zone** removes zone cells (erasing all of them returns to the presets). Zones go on open floor only. A zone change resets the crowd into the zones; if the zones hold fewer people than the crowd size you chose, the crowd shrinks to fit and grows back as you paint more zone.

**Fire scenario.** Choose **Fire spreads from the middle at 5 seconds** as the scenario. At 5 s a fire starts on the floor cell nearest the middle of the building and grows by one ring of floor cells every 1.5 s, up to 70 cells. Burning cells cannot be walked through. Smoke spreads up to 4 cells from the fire through open floor (not through walls), slows walkers to as little as 55% of their speed, and adds route cost for every strategy, so people prefer routes away from it. Anyone whose route the fire just blocked replans immediately. The fire never traps anyone: it skips cells where a person is standing and cells whose loss would cut someone off from every open exit (if the start cell is occupied, it starts on the nearest free cell, a moment later). Fire is run state, like a blocked exit: it is never saved in layouts and clears on reset. Both views show the fire and the smoke; the status line shows when it started and how many cells are burning.

**Mixed crowds.** In setup or the controls panel, choose a share of **slower walkers** (10%, 20% or 30%) and turn on **groups that stay together**. Slower walkers, for example people with a mobility impairment, walk at 55% of normal speed and are drawn in purple. With groups on, about 60% of people form groups of 2 to 4 who start near each other; each group uses its leader's exit (members follow if the leader switches) and walks at its slowest member's pace, with whoever is furthest ahead waiting when the group stretches out by more than 3 m. Thin lines link group members in the 2D plan. The results screen shows mean evacuation time for slower walkers and everyone else, and how many groups there were. The mix uses its own seeded random stream, so a crowd without slower walkers or groups is identical to earlier versions. A group can split only when an exit closes after some members are already out.

**Compare strategies** (below the map) runs the current layout, including edits, once for each chosen routing strategy and path-planning algorithm, with the same crowd size, exit scenario, local movement and starting positions (seed 549), so differences come from routing alone. Shared Flow Field runs once, since it does no per-person search. Runs happen in a background worker with a progress bar and Cancel; results appear as fastest-first bars and a table (evacuated, total and mean time, people per exit, route switches, when Exit A actually closed), and **Download results CSV** saves one row per run.

**Save layout** downloads the current layout as a small JSON file (`evacuation-lab-<map>-layout.json`, one text row per grid row: `#` wall, `.` floor, `o` furniture, `A`–`H` exits, plus a `startZones` grid with `S` cells when zones are painted). **Load layout** opens a saved file, switches to its map if needed and resets the crowd on it. Files are checked before use: wrong map size, unknown cells, floor on the outer edge, split exits, cut-off areas or no spawn space are rejected with a message, and the current layout is left unchanged.

Edits must stay inside the map boundary, preserve sufficient spawn space, and leave every floor area connected to an open exit. New walls and exits cannot overlap agents. A rejected stroke changes nothing. **Undo edit** reverses a recent stroke while paused; resuming clears undo history. **Restore original layout** restores the preset and resets the crowd. Keyboard editing uses arrow keys and Space/Enter with the canvas focused; Escape cancels a stroke.

Edited layouts survive resets and map switches during the current visit. Reloading the page restores the presets. Save/load, spawn-area editing, and redo remain planned work.

### Try shared flow fields

Select **Routing strategy → Shared Flow Field** with either local movement mode. One reverse Dijkstra field per open exit serves the whole crowd. Fields refresh from congestion every 0.5 simulation seconds and invalidate immediately for layout or exit changes. Agents retain their exit-switching cooldown and improvement threshold. **Route requests** and **Routing searches / field builds** show how much search work is shared; compare against Congestion Aware with the same map, population, movement, and closures. See [algorithm, cache behavior, and limitations](docs/SHARED_FLOW_FIELD.md).

### Compare ORCA with predictive steering

1. Choose a building map, population, routing strategy, and exit scenario. Run with **Local movement → Predictive steering** and record the results.
2. Repeat with **Local movement → ORCA**, keeping the other settings identical. Changing movement resets the crowd with the same seed, initial positions, and speeds. Repeat any manual closures at the same simulation times.
3. Compare evacuation time, exit use, congestion, and render performance. The results screen identifies the movement mode.

ORCA (Optimal Reciprocal Collision Avoidance) chooses local velocities; the selected A* or shared-field strategy still chooses routes. Both movement modes retain independent body, wall, and speed checks. In the recorded Congestion Aware A* comparison, ORCA's three matched dense-map cases completed more slowly than predictive steering. For example, 500 agents on Distributed wings with all exits open finished in **54.650 s with ORCA versus 40.167 s with predictive steering** (seed 549). These are simulated evacuation times, not browser performance measurements. See [implementation and attribution](docs/ORCA.md) and [validation results](docs/VALIDATION.md).

## SHI Stadium simulation

Choose **SHI Stadium · Schematic simulation** from the **Building layout** menu, then **Open stadium**. The same map choice in the building simulation controls pauses that run and opens the stadium. Switch between the lower bowl, separate upper decks, and concourse/gates; select a feature for source information; zoom and drag to inspect the map. The feature selector also works on mobile and with a keyboard.

Start with **100 spectators**, or choose 1–1,000 and a seating preset. **Start stadium run**, **Pause**, and **Reset crowd** control a deterministic run; playback supports 1×, 4× and 8×. Spectators follow assumed aisles, separate access walks, timed passages/ramps/stairs and the concourse to exterior gates. Transfers enforce entry rates and wait for available landing space. Live counts separate each surface, people in transit, and people outside. Changing the visible layer leaves every level advancing; leaving the stadium or hiding the tab pauses the run.

Choose a start section and destination gate to inspect a route independently of the crowd. Inspect a gate, connector, or lower section to close its connection or edit transfer assumptions. These changes pause movement. Existing travelers finish their current edge; subsequent entries use the new network, and routes are recalculated at nodes. Reopening restores routes to stranded spectators. **Reset crowd** preserves network settings; **Reset route assumptions** restores open connections and defaults.

**Crowd behavior** now offers a synthetic adult mix with individual walking speed, response delay and body size, or a uniform 1.2 m/s comparison using identical starting seats. Open **Inspect & edit an individual** or click a spectator to see their profile. Before starting, edit age, gender label, height, weight, response delay, pace factor or an explicit speed override. Reset restores seeded profiles. Gender labels do not impose a speed multiplier; the demographic speed formula is an illustrative assumption.

Movement checks swept circular bodies on each surface and transfer channel. **Local movement** selects predictive passing on sufficiently wide, long corridors or the queue baseline. Faster walkers can move into an outside lane, pass, and merge before a junction; narrow aisles and transfers retain queues. Lateral motion uses the person's walking-speed budget, and opposing lanes are never borrowed. A blocked landing retains the person in transit. See [individual behavior, collision algorithm and evidence](docs/AGENT_BEHAVIOR.md).

**Stadium routing** offers a fixed free-flow baseline and adaptive travel-time potentials using live corridor occupancy and transfer queues. Adaptive routing samples traffic every 2 seconds and uses committed itineraries, a cooldown and an improvement threshold to reduce route switching. Closed routes trigger recovery at nodes. The route inspector remains a free-flow reference.

**Stadium experiments**, below the map, compares routing modes, uniform/individual profiles, and open/east-gate-closure scenarios with identical seeds and starting seats. Choose up to three populations, up to three seeds, a movement mode, and a run limit of 60–7,200 simulated seconds. Each population/seed combination produces eight cases. Run a background batch, inspect charts, paired differences and variability across seeds, and download results/time-series/statistics CSVs. Incomplete runs remain explicit and never count as completed evacuation times.

The same comparison is available from the command line. Use separate output directories to retain each batch:

```sh
npm run benchmark:stadium -- --populations=100,500 --seeds=549,550,551 --movement=passing --time-limit=3600 --output=docs/benchmarks/passing-v2
npm run benchmark:stadium -- --populations=100,500 --seeds=549,550,551 --movement=queue --time-limit=3600 --output=docs/benchmarks/queue-v2
```

Current exports identify `stadium-movement-v2` and the selected movement mode. Existing `stadium-traffic-v1` benchmark reports are historical; they do not measure the new passing model. See [algorithm, experimental protocol, metrics and limitations](docs/STADIUM_EXPERIMENTS.md).

Geometry, scale, widths, profile distributions, speeds, and transfer settings remain experimental assumptions. Route-inspection times use the reference speed without queues; live times include individual speeds, response delays and waiting. See the [map study and implementation sequence](docs/SHI_STADIUM_MAP_PLAN.md) for sources and map assumptions.

## Stack and architecture

Vite, strict TypeScript, HTML/CSS, Canvas 2D for buildings, three.js for the optional building 3D view (loaded only when 3D is opened), and SVG for the stadium. Simulation and routing run locally in the browser; stadium experiment batches use a Web Worker. There is no backend or trained machine-learning model. three.js is the only npm runtime dependency. ORCA's agent constraints and linear programs are adapted from RVO2, with [Apache-2.0 licensing](public/third-party/rvo2/LICENSE.txt) and [attribution](public/third-party/rvo2/README.txt) included in public build assets.

```text
src/
  main.ts                    DOM shell, requestAnimationFrame, accumulator
  styles.css                 Responsive control panel and Canvas layout
  config/simulationConfig.ts Tunable constants and routing/movement/exit types
  maps/mvpMap.ts             Original bottleneck floor plan
  maps/largeMap.ts           Larger building with west/south exits
  maps/maps.ts               Layout catalog, spawn areas, and labels
  maps/campusMaps.ts         Lecture hall, classroom corridor, office, dining hall, library
  maps/stadium.ts            Schematic stadium surfaces, sections, gates, evidence
  maps/stadiumNavigation.ts  Assumed corridors, explicit transfers, geometry validation
  simulation/
    Simulation.ts           Seeded spawn, fixed updates, prioritized route queue
    Experiment.ts           Setup, timed closures, reset, and results lifecycle
    LayoutEditor.ts         Transactional wall/exit/furniture/start-zone edits, validation, and undo
    LayoutFile.ts           Save/load format for custom layouts, with validation
    FireSpread.ts           Fire scenario: ignition, spread, smoke, never trapping anyone
    BuildingComparison.ts   Matched-seed strategy comparisons and CSV export for building maps
    buildingComparison.worker.ts  Runs comparisons off the main thread
    Agent.ts                Continuous agent state
    Grid.ts                 Layout cells, exit state, and separate density arrays
    SpatialHash.ts          Exact-radius nearby-agent queries
    Density.ts              Neighborhood density and temporal smoothing
    Metrics.ts              Evacuation records and aggregate measurements
    PersonProfile.ts        Seeded stadium profiles and walking-speed assumptions
    StadiumSimulation.ts    Surface movement, passing, transfers, and queues
    StadiumExperiment.ts    Reproducible batch cases, results, and CSV output
    StadiumStatistics.ts    Matched comparisons and variation across seeds
    stadiumExperiment.worker.ts Background batch execution
  pathfinding/
    PriorityQueue.ts        Stable binary min-heap
    AStar.ts                Manual cardinal A* with Manhattan heuristic
    algorithms.ts           Theta*, Dijkstra, greedy best-first, BFS, line of sight
    CongestionRouter.ts     Exit comparison, commitment, and hysteresis
    SharedFlowField.ts      Shared reverse Dijkstra costs and successor directions
    StadiumRouter.ts        Surface-aware Dijkstra, closures, connectivity inspection
    StadiumTrafficRouter.ts Adaptive travel-time potentials and route commitment
  collision/
    CollisionSystem.ts      Predictive steering, joint contact solver, sweep checks
    OrcaSolver.ts           Optional reciprocal velocity constraints and linear programs
    PredictiveMotion.ts     Continuous relative-motion clearance
    StadiumCorridor.ts      Corridor width and continuous passing lanes
    StadiumJunctions.ts     Conflict detection for nearby schematic corridors
    DiscReservations.ts     Stadium swept-body clearance checks
  rendering/
    Renderer.ts             Map, exits, paths, agents, and debug overlays
    Renderer3D.ts           three.js view: extruded walls, floor heatmap, agents
    HeatmapRenderer.ts      Cached 10 Hz density layer
  ui/
    Controls.ts             Input bindings and metric readouts
    Screens.ts              Building setup, simulation, and results screens
    Editor.ts               Pointer and keyboard layout editing
    PerformanceStats.ts     Browser render cadence measurement
    StadiumViewer.ts        Interactive SVG stadium layers and feature inspection
    StadiumRoutes.ts        Route overlay, transfer settings, connectivity status
    StadiumCrowd.ts         Crowd controls and individual profile editing
    StadiumExperiments.ts   Batch controls, charts, and downloads
  utils/                    Vector helpers and seeded PRNG
scripts/stadium-benchmark.ts Headless stadium batch runner
tests/                      Unit tests, full-run scenarios, browser tests
```

## Building algorithms

### Routing

A* explores four cardinal neighbors and uses Manhattan distance to the nearest cell of the requested exit as its admissible heuristic. Each candidate exit is searched separately, and the lowest-cost reachable candidate wins. An exit may span multiple contiguous cells; the editor can widen existing openings and add new exits.

### Path-planning algorithms

The selected algorithm searches from the agent's cell to each open exit; the cheapest reachable exit wins. Every algorithm uses the same cost model (below) and the same commitment/hysteresis rules, so runs can be compared directly.

| Algorithm | Neighbors | Priority | Optimal? | Notes |
|---|---|---|---|---|
| A* | 4-way | g + Manhattan h | Yes | Original planner; paths follow cell edges. |
| Theta* / T* | 8-way, any angle | g + Euclidean h | Near-optimal any-angle | Lazy Theta*: a node may link straight to its grandparent when a person-sized circle (agent radius + 1 px) has clear line of sight. Exact capsule-vs-wall test, cached per layout revision. Diagonals never cut corners. Segment cost = length × (1 + w × mean density along the segment). |
| Dijkstra | 4-way | g | Yes | A* with h = 0; same costs as A*, explores more cells. |
| Greedy best-first | 4-way | Manhattan h | No | Fastest search; can choose longer or more crowded routes. |
| Breadth-first search | 4-way | FIFO | Fewest steps | Ignores congestion while searching; the found route is still costed with it for exit comparison. |

On the 70 × 42 map, one plan across both exits takes about 0.2 ms (greedy), 0.5 ms (A*), 0.7 ms (BFS), 1 ms (Dijkstra) and 2 ms (Theta*) in Node. Theta* routes are never longer than A* on either map (checked from every cell to every exit in `tests/algorithms.test.ts`).

Shortest Path assigns cost `1` per step. Congestion Aware uses:

```text
edgeCost = 1 + congestionWeight × normalizedDensity
```

The default congestion weight is 3. Agents follow cell-center waypoints in continuous pixel coordinates. Local lookahead skips a waypoint only when the agent circle can travel to the next waypoint without intersecting a wall. This avoids deadlocks caused by several agents trying to occupy exactly the same waypoint center.

Shared Flow Field uses the same weighted objective with reverse Dijkstra, caching one integration/successor field per exit. Accepted routes follow these shared successors into the existing waypoint controller. It avoids per-agent graph searches while retaining separate exit commitment. Weighted costs agree with A* for an identical snapshot; tie choices and the slower density refresh can produce different trajectories.

### Congestion and heatmap

For display units, each 20 px grid cell represents 1 m². Each simulation step, spatial-hash queries count agents in each walkable cell's 3×3 neighborhood. Dividing by the number of walkable cells in that neighborhood gives local agents/m². Peak density is the maximum unsmoothed value observed during a run.

Density normalizes against 2.2 agents/m² and clamps to 0–1. At 10 Hz, the density snapshot uses `previous × 0.8 + current × 0.2`. A* and the heatmap use that snapshot directly; shared flow fields capture it at most every 0.5 simulation seconds unless topology changes. The Canvas heatmap is cached and rebuilt only when the density snapshot changes. Congestion is separate from map cell types. Values describe this simplified model, not a calibrated real building.

### Oscillation and herding prevention

1. Each agent has a 750 ms minimum replan cooldown plus a seeded 0–450 ms individual offset.
2. Candidate exit routes are compared from the current position under the same smoothed density snapshot. An old whole-trip cost is never compared to a new shorter remaining trip.
3. Switching exits requires `newCost < currentCost × 0.85`. The selected exit remains committed otherwise. Same-exit reroutes also require meaningful improvement.
4. Blocked/unreachable paths bypass commitment and enter the urgent queue. Waiting agents stop rather than follow a stale blocked route.
5. At most five agents are replanned per fixed update; initial routing is batched too. No artificial equal-group assignment is used.

### Collision and determinism

Every fixed update rebuilds a 32 px spatial hash of active agents. In the default predictive mode, desired motion, separation, and wall repulsion produce a preferred velocity. A deterministic velocity sampler anticipates the eight nearest neighbors, with a right-side preference for head-on encounters. Expensive predictions are staggered at 10 Hz and refreshed early when the desired heading changes. Agents that remain stopped increasingly favor resuming motion; hard clearance is enforced separately at every 60 Hz step.

Optional ORCA computes reciprocal agent-agent constraints and solves for a preferred velocity within each person's speed limit at 60 Hz. It uses up to 16 neighbors, a 0.8-second agent horizon, and conservative grid-wall supporting planes over 0.2 seconds. Both modes produce proposals from a shared snapshot before the same independent contact stage. See [ORCA details and third-party attribution](docs/ORCA.md).

The joint contact solver projects nearby agents' proposed displacements together, so touching queues can advance without treating each follower as a stationary obstacle. Up to 48 deterministic passes enforce contact, speed and wall-normal constraints, including rounded doorway corners. An independent check of complete simultaneous relative-motion sweeps shortens unresolved motions by a shared fraction within each contact group before committing positions. The hard checks include every nearby body, beyond either predictor's neighbor limit. ORCA proposals that already pass every body, wall and speed check skip the corrective iterations; otherwise the common correction stage may change their velocities. The predictive baseline retains its original contact behavior.

Circle-versus-wall checks use X/Y sliding and small movement substeps; path lookahead checks body clearance at corners. Door closures prepare body-clear relocations atomically and reject the edit if an affected person cannot fit on adjacent floor. They never force overlapping placement.

The fixed timestep is 1/60 s. Seeded initial positions, speed variation (0.9–1.1×), stable A* tie-breaking, and simulation-time cooldowns make identical fixed-step input sequences reproducible. Human clicks at different simulation times produce different runs. Frame deltas are capped at 100 ms to bound catch-up work; under sustained overload simulated time may lag real time. Five replans is a **fixed-update** budget: a catch-up render can include several updates. FPS is measured separately from the deterministic state.

## Building metrics

Times are seconds from the first simulation update; paused wall-clock time is excluded. Evacuation is recorded when the agent center enters an active exit cell. Evacuated agents leave collision and route updates.

- **Total evacuation time:** time at which the final agent leaves; blank until completion.
- **Average evacuation time:** mean departure time of agents evacuated so far.
- **Per-exit evacuated / last / final clear:** departure count and last observed departure through each configured exit while running; final time-to-clear once the complete run finishes. An unused exit shows “—” for its time. This avoids claiming an exit has cleared while future agents could still select it.
- **Exit switches:** actual changes between exits, excluding initial assignments and same-exit replans.
- **Route requests / routing searches:** agent planning decisions versus per-exit A* searches or shared field builds. Field builds cover the reachable grid, so counts alone do not measure CPU time.
- **Peak density:** maximum unsmoothed local agents/m² across all steps and walkable cells.
- **FPS / frame time:** render cadence averaged over approximately 0.5 s. Frame time is the actual interval between rendered frames, not only update CPU cost.

## Tests and validation

```sh
npm test
npm run build
npm run test:browser
```

The latest recorded validation on **November 16, 2026** passed **108 unit/simulation tests**, the TypeScript/Vite production build, and **22 Chrome browser tests against the production preview**. See [validation results](docs/VALIDATION.md) for scenarios, measured outcomes, and limitations.

Unit/scenario tests cover routing, shared-field cost equivalence and cache invalidation, hysteresis, spatial queries, ORCA velocity constraints, simultaneous body sweeps, wall clearance, head-on encounters, touching queues, dense evacuation, live closures, deterministic reset, stadium passing/merging, queue baselines, and experiment statistics. Large-map runs check body and wall clearance and speed budgets at every fixed step, including people exiting during that step.

Browser tests use locally installed Chrome (`channel: 'chrome'` in `playwright.config.ts`) and start/reuse Vite on port 5174. Install Chrome or change the channel to an installed browser. Tests exercise controls, pause, dynamic closure, completion, pixel-identical reset, responsive layout, and record stress-run FPS samples. Screenshots and performance attachments go to `test-results/`.

For a local production-browser check, build first, start `npm run preview -- --port 5174 --strictPort` in one terminal, and run `npm run test:browser` in another. Ensure port 5174 is serving that preview; the tests reuse an existing server outside CI. Without a running server, Playwright starts the development server.

See [manual scenarios](docs/MANUAL_TESTS.md) for the assignment demo and hardware performance procedure. Headless simulation timings do not establish browser FPS targets.

## Performance testing

Target ≥30 FPS with 200 agents and ≥20 FPS with 500 agents on a mid-range laptop. These are measurement targets, not guarantees across hardware.

The latest shared-field browser samples reached 37–42 FPS at 200 agents with either movement mode. At 500, predictive steering sampled 60 FPS (37 FPS in the subsequent screenshot), while ORCA sampled 9–15 FPS, below the target. A separate build of the previous commit reproduced low A* cadence on the same host. See [validation details](docs/VALIDATION.md); these short samples are not sustained minimums.

Build and run `npm run preview`. Use a foreground browser tab at a fixed window size. Turn debug overlays off, run each population from reset, and record FPS/frame time during the crowded first 5–20 simulation seconds. Repeat with A blocked at five seconds. Record browser version, OS, CPU/GPU, window size, routing and movement modes, and observed minimum/typical FPS. Repeat with overlays enabled separately. Use the always-visible stage readout in the demo recording. If simulated seconds lag wall time, report that alongside FPS. Profile stadium rendering separately from the building maps.

## Known limitations

- Grid movement requires separated starting bodies and can conservatively stop when contact constraints cannot be resolved. Stadium passing requires sufficient assumed corridor width and room to merge. Neither solver guarantees completion for arbitrary edited layouts; see the agent behavior notes.
- Simplified density, geometry, speeds, and crowd behavior are not validated for evacuation planning.
- No validated modeling of hazards, disabilities or panic. The stadium has explicit stairs and directed transfers; original-grid density may include agents separated by an adjacent wall.
- Local routes can still exhibit temporary crowd hesitation. Cooldowns/hysteresis reduce oscillation without mathematically guaranteeing none.
- Render catch-up work and debug overlays affect performance; results must be measured on the target laptop.
- Crowd size is capped at 1,000 and limited by available spawn space. The stadium is a schematic, not a full-attendance model.

## Remaining work and documentation

Layout save/load, furniture and start-zone editing are done. The next implementation priority is saving experiment settings and adding redo. Remaining validation and delivery work includes evidence for stadium geometry and behavior assumptions, matched-seed movement comparisons, presentation-laptop profiling, the final report/demo/slides, and checks of the GitHub-linked Vercel deployment and its worker/CSV flows. ORCA on stadium concourses, accessible egress, group behavior, and full 3D are further extensions.

- [Future TODO](FUTURE_TODO.txt) — current priorities and unfinished work.
- [Roadmap](docs/ROADMAP.md) — implemented features and completion criteria.
- [ORCA](docs/ORCA.md) — velocity solver, integration choices, and attribution.
- [Shared flow fields](docs/SHARED_FLOW_FIELD.md) — shared routing, refresh rules, and comparison guidance.
- [Agent behavior](docs/AGENT_BEHAVIOR.md) — individual profiles and collision handling.
- [SHI Stadium map plan](docs/SHI_STADIUM_MAP_PLAN.md) — sources, layers, and assumptions.
- [Stadium experiments](docs/STADIUM_EXPERIMENTS.md) — comparison protocol and exported metrics.
- [Validation](docs/VALIDATION.md) — dated test results and performance evidence.
- [Manual tests](docs/MANUAL_TESTS.md) — repeatable demo and performance checks.
