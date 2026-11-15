# Shared physical stadium implementation checklist

This checklist tracks the implementation of the shared, simulation-owned SHI Stadium-inspired physical model. A checked item is complete and verified, not merely drafted.

## 0. Baseline and design lock

- [x] Confirm north-up SHI Stadium-inspired layout and four paired gate destinations.
- [x] Confirm deterministic seeded seating, nearest-side-aisle access, and seated occupancy behavior.
- [x] Confirm automatic person focus/follow, selection clearing, cutaway, and lighting behavior.
- [x] Record current 100-person seeded individual-profile outcome.
- [x] Record current 1,000-person uniform-profile outcome.
- [x] Record current A/B timed-closure outcome.
- [x] Record current upper-deck disconnection/reopening behavior.
- [x] Record current deterministic reset/replay outcome.

## 1. Shared physical geometry and sampling

- [x] Add simulation-owned physical types expressed in meters.
- [x] Define north-up surfaces, sections, seating terraces, aisles, corridors, connectors, landings, gates, widths, and elevations.
- [x] Add cumulative-distance path sampling for position, direction, elevation, and normalized progress.
- [x] Validate unequal-segment sampling and the east-ramp bend.
- [x] Validate continuous path endpoints and surface transitions.
- [x] Generate the 2D projection from shared geometry.
- [x] Generate 3D walking surfaces from shared geometry.

## 2. Physical routing and movement

- [x] Route with physical path length and personal preferred speed.
- [x] Share one profile-adjusted transfer-duration function between routing and movement.
- [x] Capture transfer duration at admission while preserving rate limits and landing backpressure.
- [x] Extend the immutable render frame with path progress, orientation, radius, and height.
- [x] Preserve committed routes and closure/reopening behavior.
- [x] Preserve four gate groups and existing connection topology without floor shortcuts.

## 3. Seating access and clearance

- [x] Generate deterministic seats and rows inside every section.
- [x] Spread seeded assignments across rows and sections reproducibly.
- [x] Move each departing spectator along the row to the nearest side aisle and section opening.
- [x] Keep waiting spectators seated beside, rather than inside, the walking lane.
- [x] Enforce clearance at rows, aisle merges, turns, connectors, landings, and gates.
- [x] Allow overlapping projections on vertically separated floors.
- [x] Verify populations through 1,000 fit and reset identically.

## 4. Readable 2D and 3D evacuation

- [x] Show rows, seats, and aisles in 2D only when zoomed or selected.
- [x] Replace connector cylinders with generated ramp decks, stair treads, landings, and railings.
- [x] Keep decorative architecture outside physical walking areas.
- [x] Add close-range instanced procedural people and distance-based dot LOD.
- [x] Add seated poses and distance-driven walking animation with pause/wait freezing.
- [x] Add destination clothing colors and preserve status/selection markers.
- [x] Add default evacuation cutaway and full-architecture restoration.
- [x] Improve night lighting along circulation paths, connectors, and gate approaches.
- [x] Cache selected-route geometry until route or progress changes.

## 5. Selection, cameras, and workspace

- [x] Remove the manual Follow button.
- [x] Auto-frame a selected seated person before the run.
- [x] Auto-follow a selected person after the run starts, including dropdown selection.
- [x] Clear selection and return to Overview on repeated person click, empty-space click, feature selection, or evacuation.
- [x] Temporarily hide camera-obstructing structures during follow.
- [x] Frame selected sections and their distinct committed routes.
- [x] Reset the 3D camera when leaving 3D while preserving shared selection.
- [x] Reset cutaway on 3D entry and preserve lighting choice across view switches.
- [x] Keep a compact playback/status bar above the prominent viewport.
- [x] Separate collapsed configuration/profile editing from visible journey information.

## 6. Verification and documentation

- [x] Geometry and path-sampling unit tests pass.
- [x] Seating access and deterministic assignment tests pass.
- [x] Physical travel-time and minimum-duration tests pass.
- [x] Closure, occupied-segment, unrelated-route, disconnection, and reopening tests pass.
- [x] Complete-run clearance and population-conservation tests pass.
- [x] 2D/3D position, selection, cutaway, color, pause, and camera browser tests pass.
- [x] Day/night screenshots and movement recordings are inspected.
- [x] View switching produces identical outcomes.
- [x] 100- and 1,000-person M1 rendering benchmarks meet 30 FPS at 1×.
- [x] Simulation throughput is recorded separately from rendering FPS.
- [x] Production build passes.
- [x] Complete unit/scenario suite passes.
- [x] Complete browser suite passes.
- [x] README, behavior notes, and performance documentation are updated.
- [x] Final implementation is committed and pushed to `new-version-3d`.
