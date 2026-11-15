# ORCA building-map comparison

Choose **Local movement → ORCA** in building setup or the live controls. Predictive steering remains the default baseline. Changing movement resets the run with the same seed, positions, speeds, routing strategy and edited layout; reset retains the selected movement mode. Results identify the mode. The stadium retains its separate queue/passing model.

## Algorithm and integration

`src/collision/OrcaSolver.ts` implements agent-agent Optimal Reciprocal Collision Avoidance. For each nearby pair, it constructs a velocity-obstacle boundary over a 0.8-second horizon and assigns each walker half of the relative-velocity correction. A two-dimensional linear program selects the velocity closest to the route's preferred velocity, inside the individual's speed circle and the feasible half-planes. When constraints conflict, the projected fallback minimizes violations while preserving feasible static constraints.

The pair construction and linear programs are adapted from the [RVO2 reference implementation](https://github.com/snape/RVO2/blob/main/src/Agent.cc). The source retains attribution and modification notices; its [Apache-2.0 license](../public/third-party/rvo2/LICENSE.txt) and [attribution](../public/third-party/rvo2/README.txt) are included in the deployed public assets. Algorithm reference: [van den Berg et al., Reciprocal n-body Collision Avoidance](https://gamma-web.iacs.umd.edu/ORCA/).

Integration choices:

- All active agents compute velocities from the same positions and previous actual velocities, at every 1/60-second fixed step. Positions are committed together afterward.
- A spatial hash supplies up to 16 nearest neighbors, with deterministic ID ordering for equal distances. Neighbor range accounts for both agents' maximum speeds. Limiting neighbors can make responsibility asymmetric; actual contacts are independently checked against every nearby body.
- Nearby grid walls add conservative supporting half-planes with a 0.2-second horizon. These use the closest point on each blocked rectangle and the person's body radius. This is a project-specific wall approximation, not RVO2's polygon-obstacle solver. Grid edits and closures are read on the next solve without a stale wall cache.
- A small right-hand preference (0.03 lateral/forward ratio) is added to the preferred direction for head-on traffic. It breaks symmetric stand-offs without modifying ORCA's constraints. Each person's original preferred speed remains the upper bound.
- Desired movement is zero while awaiting a path or advancing a reached waypoint, but those people still participate in avoidance.
- Both movement modes feed wall sliding and complete simultaneous body-sweep checks. For ORCA, the contact stage first checks every possible body pair, walls and speed bounds. If the whole proposal is clear, it accepts it directly; otherwise it runs the existing joint contact correction and safe-prefix fallback. The predictive baseline retains its original contact behavior, including its extra soft spacing margin. This avoids unnecessary iterations on already clear ORCA steps. Corrections may alter an ORCA proposal, so the combined system does not inherit an unconditional ORCA collision-free or deadlock-free guarantee.
- `simulation.orca.solves` and `simulation.orca.infeasible` count individual velocity solves and final constraint-infeasible proposals before contact correction. They reset with the crowd. An infeasible proposal is not an observed overlap.

## What comparisons establish

ORCA is local avoidance, not a replacement for A* or the congestion-aware exit chooser. Keep map, crowd, routing, closures, and seed identical when comparing movement modes. Record total/average evacuation time, exit use, stalls, body clearance and render performance. This compares complete movement pipelines: ORCA also uses the verified-clear shortcut described above. Changing local movement can change later density and route decisions even with the same routing policy.

`tests/orca.test.ts` checks the velocity solver analytically, reciprocal constraints, continuous head-on clearance without contact projection, wall response, deterministic reset and full building scenarios. Browser coverage checks mode selection, reset, preserved settings, result labels and mobile layout. See [validation results](VALIDATION.md) for completed runs.

A faster evacuation is not assumed. Conservative wall constraints, dense infeasible neighborhoods, or symmetry can slow movement. Full stadium integration, calibrated horizons, sustained target-laptop profiling and broader matched-seed performance comparisons remain follow-up work. No machine-learning model is trained by this implementation.
