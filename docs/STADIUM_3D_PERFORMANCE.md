# Stadium 3D rendering performance

The architectural view is an unbranded SHI Stadium-inspired visual model, not a measured digital twin. It uses Three.js `InstancedMesh` objects for repeated crowd dots, status rings, and rerouting markers. Instancing reduces draw calls while allowing each person to retain an individual transform and destination color. See the [Three.js InstancedMesh documentation](https://threejs.org/docs/pages/InstancedMesh.html).

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

## Recorded result — 2026-11-14

| Spectators | Render FPS | Mean 3D render work |
| ---: | ---: | ---: |
| 100 | 60.0 | 2.68 ms/frame |
| 1,000 | 60.0 | 2.89 ms/frame |

Both cases met the Phase 2 target of at least 30 rendering FPS at 1× on the tested M1 Mac. These are short local measurements, not a guarantee for every browser, thermal state, display refresh rate, or GPU. The browser test asserts that measurements are produced; it intentionally does not fail slower CI machines against the M1-specific target.

## Rendering boundaries

- Only the active 2D or 3D renderer is updated. The fixed-step simulation runs once and supplies a read-only frame to the active renderer.
- Three.js and `OrbitControls` are dynamically imported when 3D is first selected. The 2D application remains usable if WebGL or initialization fails.
- People use instanced dots. Destination color remains visible while white/red rings and a small marker communicate waiting, blockage, selection, and rerouting.
- Transfer positions and elevations use the simulation's actual edge progress. Landing backpressure therefore stops the visible dot instead of starting an independent animation.
- The visual projection is centralized in `Stadium3DGeometry.ts`. It maps unchanged 2D navigation points onto a sloped lower bowl, elevated upper decks, concourse, façade, and entrance plazas. These dimensions are illustrative assumptions, not surveyed stadium measurements.
- Day and stadium-light modes change presentation lighting only. They do not pause, advance, or alter the simulation.
