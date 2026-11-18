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
  flowFieldInterval: 0.5,
  densitySmoothing: 0.2,
  densitySaturation: 2.2,
  separationWeight: 1.6,
  wallWeight: 0.35,
  waypointThreshold: 5,
  maxFrameDelta: 0.1,
  maxPopulation: 1000,
} as const;
/** Fire scenario: ignition time, spread rate and limits, smoke reach and effects. */
export const FIRE = {
  startSeconds: 5,
  spreadIntervalSeconds: 1.5,
  maxCells: 70,
  smokeRangeCells: 4,
  /** Walking speed in the thickest smoke, as a fraction of normal speed. */
  smokeSpeedFactor: 0.55,
  /** Extra route cost per cell of full smoke, for every routing strategy. */
  smokeRouteCost: 6,
} as const;
export type RoutingMode = "shortest" | "congestion" | "flow-field";
export const ROUTING_LABELS: Record<RoutingMode, string> = {
  shortest: "Shortest Path", congestion: "Congestion Aware", "flow-field": "Shared Flow Field",
};
export const ROUTING_HELP: Record<RoutingMode, string> = {
  shortest: "Shortest Path: everyone takes the shortest route to the nearest exit and ignores crowding.",
  congestion: "Congestion Aware: people avoid crowded corridors and may switch to a less busy exit.",
  "flow-field": "Shared Flow Field: one congestion-aware route map per exit, shared by the whole crowd.",
};
export type MovementMode = "predictive" | "orca";
export const MOVEMENT_LABELS: Record<MovementMode, string> = { predictive: "Predictive steering", orca: "ORCA" };
export const EXIT_IDS = ["A", "B", "C", "D", "E", "F", "G", "H"] as const;
export type ExitId = (typeof EXIT_IDS)[number];
export type PathAlgorithm = "astar" | "thetastar" | "dijkstra" | "greedy" | "bfs";
export const PATH_ALGORITHMS: PathAlgorithm[] = ["astar", "thetastar", "dijkstra", "greedy", "bfs"];
export const ALGORITHM_LABELS: Record<PathAlgorithm, string> = {
  astar: "A* (4-way grid)",
  thetastar: "Theta* / T* (any-angle)",
  dijkstra: "Dijkstra",
  greedy: "Greedy best-first",
  bfs: "Breadth-first search",
};
export const ALGORITHM_HELP: Record<PathAlgorithm, string> = {
  astar: "Optimal 4-way grid search guided by Manhattan distance. Paths follow cell edges.",
  thetastar: "Any-angle A*: skips cells when a person-sized body has line of sight, giving straight diagonal routes.",
  dijkstra: "Optimal uniform-cost search with no heuristic. Same routes as A*, more cells explored.",
  greedy: "Heads toward the nearest exit cell first. Fast but can choose longer routes.",
  bfs: "Fewest grid steps. Ignores congestion while searching; the chosen route is still costed with it.",
};
