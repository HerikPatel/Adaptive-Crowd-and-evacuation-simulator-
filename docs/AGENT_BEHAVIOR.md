# Stadium individual behavior and collision handling

Implemented for the stadium surface graph. The original building-grid experiments keep their existing movement model.

## Individual profiles

The default **Individual profiles** mode creates reproducible synthetic adults. **Uniform comparison** uses 1.2 m/s, zero response delay, and the same body size for everyone. Both modes use identical starting seats. Profile randomness has a separate per-person seed so adding profile fields cannot change seat placement.

The synthetic scenario uses these assumptions, not a census or Rutgers attendance estimate:

| Input | Distribution / constraint |
| --- | --- |
| Age | 30% ages 18–29, 30% ages 30–44, 25% ages 45–64, 15% ages 65–85; uniform within each band |
| Gender label | 49% woman, 49% man, 2% unspecified; descriptive only |
| Height | Normal mean 170 cm, SD 9 cm, clipped to 145–200 cm |
| Body mass | Sample BMI with mean 26, SD 4, clipped to 18–38, then multiply by height in meters squared; final mass clipped to 40–150 kg |
| Individual pace | Normal mean 1, SD 0.12, clipped to 0.65–1.35 |
| Response delay | Uniform 0.5–5 seconds, rounded to 0.1 s |

Clipping limits extreme draws; it is not a mathematically truncated normal distribution. Age-band shares are sampling probabilities, not guaranteed exact percentages in a small crowd. Height/mass and gender are not modeled as correlated. Children, mobility aids, group/family behavior, fatigue and emergency reactions are not calibrated in this milestone.

The **assumed** speed model is:

```
ageBaseline = 1.34 (18–44), 1.26 (45–64), 1.12 (65–74), 1.00 (75–85) m/s
heightFactor = clamp(sqrt(heightCm / 170), 0.92, 1.08)
BMI = weightKg / (heightCm / 100)^2
massFactor = clamp(1 - max(0, BMI - 30) * 0.006, 0.85, 1)
preferredSpeed = clamp(ageBaseline * heightFactor * massFactor * paceFactor, 0.45, 1.8)
bodyRadius = clamp(0.26 + (weightKg - 70)*0.0008 + (heightCm - 170)*0.0003, 0.22, 0.32) m
```

These coefficients and body-size approximations are designed for sensitivity experiments, not fitted from a dataset. Gender identity is not treated as biological sex or assigned a speed multiplier. A manual speed override bypasses the speed formula. Users can edit age, gender label, height, mass, response delay, pace factor and speed override before a run. Reset restores seeded profiles and clears individual edits; network closures and transfer assumptions persist.

Preferred speed controls walking and section approach motion. Transfer duration at entry is `configured minimum * max(1, 1.2 / preferredSpeed)`: slower people take longer, and faster people still respect the configured minimum. Queues and busy landings may add time. Admission rates remain separate capacity limits. Response delay is elapsed simulation time before leaving the seat; pause does not consume it.

## Evidence and limits

[Bohannon (1997), *Comfortable and maximum walking speed of adults aged 20–79 years*](https://pubmed.ncbi.nlm.nih.gov/9143432/) measured 230 healthy volunteers over a short indoor walkway and reported associations with age, height and muscle strength. This motivates individual variation; it does **not** establish the coefficients above or predict an individual's evacuation behavior.

[Samson et al. (2001), *Differences in gait parameters at a preferred walking speed in healthy subjects due to age, height and body weight*](https://pubmed.ncbi.nlm.nih.gov/11292147/) reports associations and considerable unexplained variation. Demographic inputs should therefore be compared against an independently measured speed or varied in sensitivity tests, rather than treated as a precise personal prediction. The current synthetic population is not representative of Rutgers, and indoor walking results are not validated stadium evacuation speeds.

## Collision algorithm

This milestone implements **continuous swept-disc motion reservations**, not ORCA or a learned AI controller:

1. Build a spatial index of circular bodies using meters. Each walking surface and each transfer channel has its own namespace; a projected overlap between floors is not a collision.
2. Process lane leaders before followers. Sweep each proposed movement against reserved body positions and shorten it to the first contact. Moves are subdivided along curved polylines to avoid skipping a bend. Updated positions immediately replace their old reservations.
3. Keep 1.1 m lane headway through walking turns and 1.6 m through the sharper schematic transfer bends. A faster person can wait behind a slower one without overtaking or penetrating their body.
4. Group walking nodes connected by segments shorter than 2.2 m into one junction reservation. One person retains that reservation until clear of every node in the group. Short segments never shrink a body's required clearance. In-region segments have no lateral lane offset.
5. Preserve clear section aisles and circulation walks in the spawn layout. Seated bodies cannot occupy either directional walking lane. Release ready spectators with a clear seat-to-aisle path; nearer seats are considered first. This is coarse seat access, not surveyed rows.
6. Admit a transfer arrival onto the destination surface only when its body fits and it owns the landing reservation. Count evacuation only at the exterior gate destination.

The filter is conservative and order-dependent. It can reduce throughput; the configured transfer admission rate is an upper bound, not guaranteed achieved flow. There is no lateral overtaking or free 2D maneuvering. Gate widths and true route geometry remain unknown. Tests establish non-penetration and completion for the included scenarios, not a general deadlock-free proof for arbitrary future graphs.

[Van den Berg et al., ORCA](https://gamma-web.iacs.umd.edu/ORCA/) is a relevant future comparison: it shares avoidance responsibility between agents and solves local velocity constraints. Implementing it faithfully would require a suitable continuous navigation region and obstacle model. The current reservation filter keeps the existing graph route constraints and should not be described as ORCA, reinforcement learning, or an AI pathfinder.

## Validation

Tests cover deterministic and bounded profile sampling, gender-neutral speed calculation, invalid input atomicity, identical comparison seats, response delays, manual speed overrides, slower isolated evacuation, fast-motion tunneling, separate-floor reservations, and same-surface body clearance throughout a mixed 100-person run. Existing stadium tests cover closure/reopening, transfer rates and minimum duration, blocked landings, population conservation and 1,000-person completion. Browser checks cover profile inspection/editing, comparison mode, reset, pause and mobile layout.
