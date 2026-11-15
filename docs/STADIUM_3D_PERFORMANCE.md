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

## Rendering boundaries

- Only the active 2D or 3D renderer is updated. The fixed-step simulation runs once and supplies a read-only frame to the active renderer.
- Three.js and `OrbitControls` are dynamically imported when 3D is first selected. The 2D application remains usable if WebGL or initialization fails.
- People use instanced procedural figures at close range and dots at distance. Seated poses use seat state; walking stride uses simulation distance, so waiting and paused runs freeze without an independent animation clock. Destination color remains visible while white/red rings and a small marker communicate waiting, blockage, selection, and rerouting.
- Transfer positions and elevations use the simulation's actual edge progress. Landing backpressure therefore stops the visible dot instead of starting an independent animation.
- Physical paths, seats, elevations and distance sampling live in `StadiumPhysicalGeometry.ts` and are shared by routing, movement, 2D, and 3D. `Stadium3DGeometry.ts` contains presentation-only stadium form helpers. Generated connector decks, stair treads, landings and rails follow the actual navigation paths. Dimensions remain illustrative assumptions, not surveyed stadium measurements.
- The default evacuation cutaway hides obstructing exterior architecture; Full architecture restores it. Person selection automatically frames/follows the live simulation position and returns to Overview when selection clears or evacuation completes.
- Day and stadium-light modes change presentation lighting only. They do not pause, advance, or alter the simulation.

The deterministic headless baseline script completed its 100-person, 1,000-person, closure, reopening and replay scenarios in 37.7 seconds of wall time on the same machine. That is simulation throughput and is intentionally reported separately from rendering FPS.
