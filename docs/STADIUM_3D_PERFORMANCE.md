# Stadium 3D rendering performance

The architectural view is an unbranded SHI Stadium-inspired schematic, not a measured digital twin. It uses Three.js `InstancedMesh` objects for distance-switched crowd dots, procedural torsos, heads, legs, status rings, and rerouting markers. Instancing reduces draw calls while allowing each person to retain an individual transform and destination color. See the [Three.js InstancedMesh documentation](https://threejs.org/docs/pages/InstancedMesh.html).

The model follows the published seating/gate arrangement and publicly documented expansion features: an open football bowl, distinct sideline upper decks, the enclosed south end, an exterior façade, and a large south-end video board. A [CC BY 4.0 photograph by Ajay Suresh](https://commons.wikimedia.org/wiki/File:Shi_Stadium_-_Rutgers_Football_(55140894287).jpg) was used as visual reference and is not redistributed by the project. Official marks and sponsor branding are omitted.

## Benchmark method

- Hardware: Apple M1 MacBook Pro (`MacBookPro17,1`), 8 CPU cores, 8 GB memory
- Browser harness: Playwright 1.64.0 Chromium
- Three.js: 0.187.0
- View: architectural 3D Overview
- Playback: 1×
- Population modes: 100 and 1,000 uniform-profile spectators
- Measurement: active-view animation frames over repeated one-second windows
- `render FPS` measures browser presentation frames while 3D is active.
- `render ms` measures the 3D frame preparation plus Three.js render call. It does not report simulation throughput or wall-clock evacuation speed.

Run the benchmark with:

```bash
npm run test:browser -- tests/browser/stadium-3d-performance.spec.ts
```

## Recorded result — 2026-11-15

| Spectators | Render FPS | Mean 3D render work |
| ---: | ---: | ---: |
| 100 | 60.0 | 3.87 ms/frame |
| 1,000 | 60.0 | 4.34 ms/frame |

Both cases met the Phase 2 target of at least 30 rendering FPS at 1× on the tested M1 Mac. These are short local measurements, not a guarantee for every browser, thermal state, display refresh rate, or GPU. The browser test asserts that measurements are produced; it intentionally does not fail slower CI machines against the M1-specific target.

## Clarity-update verification — 2026-11-18

The camera, bowl geometry, upper-deck alignment, cutaway layers, field detail, and lighting were revised without changing simulation or routing behavior. A fresh local Chrome run produced:

| Spectators | Render FPS | Mean 3D render work |
| ---: | ---: | ---: |
| 100 | 60.0 | 3.79 ms/frame |
| 1,000 | 59.9 | 4.37 ms/frame |

Both remain above the documented 30 FPS target. The browser harness records `stadium-3d-overview.png`, `stadium-3d-top-down.png`, `stadium-3d-full-architecture.png`, `stadium-3d-night.png`, `stadium-3d-linked.png`, and `stadium-3d-transfer-progress.png` in the Playwright test output.

## Rendering boundaries

- Only the active 2D or 3D renderer is updated. The fixed-step simulation runs once and supplies a read-only frame to the active renderer.
- Three.js and `OrbitControls` are dynamically imported when 3D is first selected. The 2D application remains usable if WebGL or initialization fails.
- People use instanced procedural figures at close range and dots at distance. Seated poses use seat state; walking stride uses simulation distance, so waiting and paused runs freeze without an independent animation clock. Destination color remains visible while white/red rings and a small marker communicate waiting, blockage, selection, and rerouting.
- Transfer positions and elevations use the simulation's actual edge progress. Landing backpressure therefore stops the visible dot instead of starting an independent animation.
- Physical paths, seats, elevations and distance sampling live in `StadiumPhysicalGeometry.ts` and are shared by routing, movement, 2D, and 3D. `Stadium3DGeometry.ts` contains presentation-only stadium form helpers. Generated connector decks, stair treads, landings and rails follow the actual navigation paths. Dimensions remain illustrative assumptions, not surveyed stadium measurements.
- The default evacuation cutaway hides the façade and light towers while retaining the south video board, people, gates, connectors, and selected routes; Full architecture restores the exterior shell and light towers.
- Camera exploration is free by default. Selection never moves the camera. Following is explicit, manual interaction or any preset stops it, evacuation preserves the final viewpoint, and switching between 2D and 3D preserves camera and cutaway state.
- Day and stadium-light modes change presentation lighting only. They do not pause, advance, or alter the simulation.

## Presentation update — 2026-11-19

The lower bowl now has open aisle breaks between bench rows. Concourse and transfer decks use the same path-aligned mesh helper, and a compact 3D overlay reports seated, walking, in-connection, waiting, and outside counts. A manual preset loads 1,000 spectators across all seating levels without starting the run. The south video board remains visible in the default cutaway.

The focused Chromium benchmark measured 60.0 FPS / 3.80 ms for 100 spectators and 60.0 FPS / 4.50 ms for 1,000 spectators on the same M1 test laptop. Both exceed the 30 FPS target.

## Architecture and camera update — 2026-11-19

The lower-bowl aisles now have walkable-width surfaces, the upper-deck supports sit below the seating, and the exterior gate approaches have visible paved entries. The 3D status display separates seated spectators from people waiting in the circulation network. A Free camera control adds drag-to-look and keyboard flight while keeping the orbit presets available. The stadium-light setting uses a brighter ambient fill and softer floodlights for more even visibility.

The focused Chromium benchmark measured 60.0 FPS / 4.31 ms for 100 spectators and 59.9 FPS / 4.75 ms for 1,000 spectators on the same M1 test laptop. Both remain above the 30 FPS target.

The deterministic headless baseline script completed its 100-person, 1,000-person, closure, reopening and replay scenarios in 37.7 seconds of wall time on the same machine. That is simulation throughput and is intentionally reported separately from rendering FPS.
