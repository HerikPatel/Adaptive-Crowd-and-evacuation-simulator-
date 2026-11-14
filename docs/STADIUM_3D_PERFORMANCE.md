# Stadium 3D rendering performance

The architectural view is schematic and uses Three.js `InstancedMesh` objects for repeated crowd heads, bodies, status rings, and rerouting markers. Instancing reduces draw calls while allowing each person to retain an individual transform and destination color. See the [Three.js InstancedMesh documentation](https://threejs.org/docs/pages/InstancedMesh.html).

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
| 100 | 60.0 | 1.53 ms/frame |
| 1,000 | 60.0 | 1.66 ms/frame |

Both cases met the Phase 2 target of at least 30 rendering FPS at 1× on the tested M1 Mac. These are short local measurements, not a guarantee for every browser, thermal state, display refresh rate, or GPU. The browser test asserts that measurements are produced; it intentionally does not fail slower CI machines against the M1-specific target.

## Rendering boundaries

- Only the active 2D or 3D renderer is updated. The fixed-step simulation runs once and supplies a read-only frame to the active renderer.
- Three.js and `OrbitControls` are dynamically imported when 3D is first selected. The 2D application remains usable if WebGL or initialization fails.
- People use instanced low-detail heads and bodies. Movement bobbing uses simulation time, so waiting and paused people freeze.
- Transfer positions and elevations use the simulation's actual edge progress. Landing backpressure therefore stops the visible figure instead of starting an independent animation.
- Illustrative elevations are centralized in `StadiumVisuals.ts`: field/exterior 0 m, concourse 1.2 m, lower bowl 4.2 m, and upper decks 10.5 m. They are visual assumptions, not surveyed stadium measurements.
