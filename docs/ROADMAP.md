# Project status and proposed remaining work

Updated November 15, 2026. These are recommended priorities, not additional assignment requirements. The intended final deadline is the first week of December; confirm the exact date from the course before scheduling submission.

## Implemented

- Two building presets with customizable population, wall drawing/erasing, up to eight exits, connectivity validation, and undo.
- Multi-level schematic SHI Stadium with sections, explicit surface connections, timed/capacity-limited transfers, gates, closures, and route inspection.
- Individual stadium profiles with reproducible speed, response delay and body size; a uniform comparison and pre-run individual overrides.
- Stadium swept-body clearance and junction reservations, plus adaptive graph routing using observed traffic and stable route switching.
- Grid predictive steering, joint contact resolution and hard simultaneous sweep checks; stadium passing on eligible wide corridors with a selectable queue baseline.
- Background comparisons, charts, CSV exports, configurable run limits, and matched-seed summary statistics. See the [experiment protocol](STADIUM_EXPERIMENTS.md) and [recorded follow-up](benchmarks/FOLLOW_UP.md).

## Movement quality (priority 1, completed)

Building agents now resolve nearby movements together, then check complete simultaneous body sweeps before committing positions. This permits dense queues to advance while enforcing clearance. Predictive steering runs at staggered intervals; hard checks run every fixed step. Door closures reject unsafe body relocation atomically.

Stadium movement now models corridor width explicitly, permits bounded lateral passing, and merges walkers before junction ownership. Narrow aisles and transfers retain queues. The queue baseline remains selectable in live runs and experiment batches; CSV and statistics include movement mode. Existing v1 benchmarks remain historical rather than measurements of the v2 passing model.

Regression coverage includes head-on encounters, touching queues, faster followers, merging, oncoming traffic, narrow passages, blocked landings, closures and maximum-population completion. See [validation evidence](VALIDATION.md) and [algorithm assumptions](AGENT_BEHAVIOR.md). These are deterministic heuristic solvers, not ORCA or learned controllers; arbitrary edited layouts can still create conservative waits.

Priorities 2–4 below are saved in [FUTURE_TODO.txt](../FUTURE_TODO.txt).

## Editor and configuration persistence

Save/load custom building layouts and experiment settings, with a versioned file format and validation on import. Then add spawn-area editing and redo. Additional presets can share the same format. The existing map choices are the original bottleneck, distributed wings, and the separate stadium view; an office/classroom/auditorium preset library is not implemented.

## Calibration and stronger evidence

Stadium geometry, widths, capacities, demographic distributions and speed effects remain assumptions. A permitted circulation plan, site observations, or defensible measurements would support calibration. Gender is currently a profile label, not a speed multiplier.

The repeated-seed summaries improve reproducibility but do not establish realism. Run new matched-seed queue/passing comparisons for `stadium-movement-v2`; the saved v1 results do not measure passing. Further experiments can vary congestion coefficients, gate/transfer capacities, crowd composition and seed count, and separate the effects of speed awareness from congestion feedback. Document unchanged, worse and incomplete outcomes alongside improvements.

## Presentation and delivery

Profile the production build on the actual presentation laptop, including 1,000-person stadium cases and mobile controls. Record render cadence and whether simulated time keeps pace with wall time; headless update timings do not answer that.

Prepare a short repeatable demo, a report covering assumptions and measured comparisons, and at most four slides centered on the navigation and collision-detection pillars. After the code push, check the GitHub-linked Vercel deployment and its experiment worker/CSV downloads.

Stress/panic models, group behavior, accessible egress, full 3D rendering, and machine-learned policies are optional extensions. They should not displace validation and delivery work merely to increase the feature count.
