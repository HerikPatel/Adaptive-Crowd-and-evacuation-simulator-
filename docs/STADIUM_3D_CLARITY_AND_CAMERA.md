# Stadium 3D clarity and camera improvements

This work uses the simpler building renderer as a restraint and interaction reference while preserving the stadium simulation, routing graph, queueing, closures, and measurements.

## Completed checkpoints

- [x] **Camera control:** free exploration is the default; Follow selected person is explicit; Reset, Top-down, Connectors, and Gates presets are available; manual interaction and presets stop following; selection, evacuation, and 2D/3D switching preserve the viewpoint.
- [x] **Geometry alignment:** the bowl perimeter is continuous and phase-aligned, lower-bowl proportions follow the shared physical envelope, east/west decks match their physical seat sides and elevations, and connectors remain generated from simulation-owned paths.
- [x] **Simplified default:** evacuation cutaway keeps people, gates, connectors, and selected routes while façade, scoreboard, and light-tower detail stays behind Full architecture mode. Day and stadium-light modes use restrained materials and lighting.
- [x] **Stadium polish:** the bowl uses coherent elliptical ends, upper decks include section aisles and parapets, supports and railings share one material language, and the field includes boundaries, hashes, and unbranded goal structures.
- [x] **Verification:** camera, selection, switching, cutaway, connector isolation, pause, and WebGL fallback browser checks pass. Overview, top-down, full-architecture, night, linked-view, and transfer screenshots are captured by the browser harness. The production build passes and the 100/1,000-person measurements remain above 30 FPS.

## Verification snapshot — 2026-11-18

| Population | Render FPS | Mean render work |
| ---: | ---: | ---: |
| 100 | 60.0 | 3.79 ms/frame |
| 1,000 | 59.9 | 4.37 ms/frame |

The geometry regression samples 720 points around the bowl and rejects discontinuities or cross-ring phase loss. Routing and simulation logic were not changed by this visual pass.
