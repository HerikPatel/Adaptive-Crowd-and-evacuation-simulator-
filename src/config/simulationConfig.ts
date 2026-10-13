export const CONFIG = {
  cellSize: 20,
  gridWidth: 50,
  gridHeight: 30,
  seed: 549,
  fixedDt: 1 / 60,
  baseSpeed: 48,
  agentRadius: 4.3,
  spatialCellSize: 32,
  congestionWeight: 3,
  replanInterval: 0.75,
  replanJitter: 0.45,
  switchRatio: 0.85,
  maxReplansPerStep: 5,
  densityInterval: 0.1,
  densitySmoothing: 0.2,
  densitySaturation: 2.2,
  separationWeight: 1.6,
  wallWeight: 0.35,
  waypointThreshold: 5,
  maxFrameDelta: 0.1,
} as const;
export type RoutingMode = "shortest" | "congestion";
export type ExitId = "A" | "B";
