# Stadium outcome baseline before shared physical geometry

Captured on 2026-11-14 from commit `5d62479`, before replacing drawing-unit movement with shared physical paths. Seed: 549. These values are comparison evidence, not acceptance targets: physical geometry is expected to change distances, seat positions, gate choices, and evacuation times.

| Scenario | Completion | Average exit time | A/B | C/D | E | G/H | Replacements |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 100 mixed profiles | 202.067 s | 82.121 s | 20 | 28 | 37 | 15 | 0 |
| 1,000 uniform profiles | 1,066.933 s | 477.217 s | 140 | 294 | 356 | 210 | 0 |
| 100 mixed; A/B closes at 5 s | 202.067 s | 94.739 s | 0 | 38 | 37 | 25 | 20 |
| 20 uniform; east upper ramp reopens | 140.333 s | 96.735 s | 0 | 0 | 20 | 0 | 20 |

Closing the east upper ramp before starting stranded all 20 east-upper spectators and stopped the run. Reopening restored connectivity without moving them, and all 20 subsequently evacuated. Repeating the 100-person scenario reproduced the complete result exactly, including time and gate totals.

Re-run the preserved baseline capture with:

```sh
npx tsx scripts/capture-stadium-baseline.ts
```

## Shared-physical-model result — 2026-11-15

The same deterministic script was rerun after the shared physical geometry, row access, personal transfer duration, and directional walking lanes were implemented.

| Scenario | Completion | Average exit time | A/B | C/D | E | G/H | Replacements |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 100 mixed profiles | 227.667 s | 88.647 s | 20 | 28 | 37 | 15 | 0 |
| 1,000 uniform profiles | 1,064.367 s | 456.945 s | 140 | 294 | 356 | 210 | 0 |
| 100 mixed; A/B closes at 5 s | 227.667 s | 99.507 s | 0 | 38 | 37 | 25 | 20 |
| 20 uniform; east upper ramp reopens | 180.667 s | 112.077 s | 0 | 0 | 20 | 0 | 20 |

The disconnected east-upper scenario stranded all 20 people until reopening. The 100-person replay reproduced time, gate totals, replacements, and clearance results exactly. All four scenarios reported zero body-overlap waits after graph-lane and merge ordering were applied; the dedicated clearance test additionally checks every fixed step.
