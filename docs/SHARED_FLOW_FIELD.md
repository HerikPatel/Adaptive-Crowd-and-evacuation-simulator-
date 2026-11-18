# Shared flow-field routing

Choose **Routing strategy → Shared Flow Field** on either building map. Choose predictive steering or ORCA independently under **Local movement**. Changing routing resets the crowd with the same positions, speeds, edited layout, and seed; results name the selected strategy. The default remains Congestion Aware A*.

## How it works

`src/pathfinding/SharedFlowField.ts` builds a cost-to-exit field using reverse Dijkstra. Every cell of a given open exit starts at zero cost, so wide exits have multiple sources. Each reachable floor cell stores its remaining cost and a cardinal successor toward that exit. All agents share these arrays. Separate fields for each exit let the existing router compare alternatives while preserving individual exit commitment.

Forward movement from cell `u` to `v` costs `1 + 3 × density[v]`, matching the Congestion Aware A* objective. Reverse relaxation therefore adds the entry cost of `v`, not `u`. Each successor strictly decreases the integration cost; walls and unreachable cells retain infinite cost. Stable heap ordering and fixed neighbor order make ties reproducible. Equivalent-cost paths can differ from A* because the searches proceed in opposite directions.

For each route request, the router looks up the cost at the agent's current cell in each open exit's field. Only an accepted route is traced into waypoints by following successor pointers; there is no per-agent graph search in this mode. The existing waypoint lookahead, movement speed limits, predictive steering/ORCA, and complete body/wall sweep checks still control physical motion. This integration retains per-agent waypoint arrays rather than replacing the movement controller with interpolated vectors.

The general approach follows the goal-directed shared fields described by [Amit Patel, Flow Field Pathfinding for Tower Defense](https://www.redblobgames.com/pathfinding/tower-defense/) and the cost/integration/direction separation in [Elijah Emerson, Crowd Pathfinding and Steering Using Flow Field Tiles](https://www.gameaipro.com/GameAIPro/GameAIPro_Chapter23_Crowd_Pathfinding_and_Steering_Using_Flow_Field_Tiles.pdf). This project uses whole-grid weighted Dijkstra, without a tiled hierarchy or Eikonal solver. No external implementation code or new runtime dependency was added.

## Refresh and route stability

- Fields share a frozen density snapshot for up to **0.5 simulation seconds**. On the next routing request after that interval, the latest smoothed density is captured and fields are rebuilt lazily, once per requested exit. Heatmap and A* density still update at 10 Hz.
- Wall edits, added/widened exits, undo, restored presets, and map changes replace the grid. Exit closures/reopenings increment its layout revision. Either change invalidates the cache before the next route request, without waiting for the density interval. Direct programmatic cell edits must replace the grid or increment `layoutRevision`.
- All candidate and remaining-route costs in one decision use the same frozen snapshot. Voluntary exit switches still require more than a 15% improvement, with the existing 750 ms plus seeded jitter cooldown. Invalid routes bypass commitment.
- At most five agent requests are processed per fixed step, as with A*. A shared field reduces search work; this change does not remove the initial route queue. Closed-exit paths are cleared immediately while affected agents await rerouting.
- Reset creates a fresh router, clears fields and counters, and reproduces the same fixed-step input sequence. Paused time does not advance the refresh clock.

## Evidence and tradeoffs

The live **Route requests** counter counts agent planning decisions. **Routing searches / field builds** counts individual A* searches in the old modes or reverse field builds in shared mode. One field serves many requests. Counts are not equivalent CPU units: a reverse field explores the whole reachable region, while A* can stop when it finds a goal.

`tests/flow-field.test.ts` compares weighted costs with A* for every cell in a test layout and all eight exits; checks wide exits, unreachable areas, closure/reopening, cache reuse, refresh timing, commitment, edits and deterministic reset; and runs complete building scenarios with both movement modes and continuous clearance checks. A static 1,000-person planning comparison checks two shared fields against 2,000 A* searches with the same minimum costs and exit choices. See [dated validation results](VALIDATION.md) for measured outcomes.

With `E` exits and `V` cells, shared field storage is O(EV), and a grid rebuild is O(EV log V); route choice uses O(E) cost lookups plus O(path length) when accepting a new route. For small crowds, field construction may cost more than a few A* searches. Density can lag by half a second, and shared directions can concentrate agents at bottlenecks. Lower search counts do not guarantee faster evacuation, higher browser FPS, or deadlock-free movement. Repeat matched layout/crowd/closure tests with the same local movement mode before comparing results.

The stadium already uses shared reverse graph potentials, cached by walking-speed band in `StadiumTrafficRouter.ts`. Its graph has explicit transfers and surface boundaries; this building-grid option does not change stadium routing or add stadium ORCA.
