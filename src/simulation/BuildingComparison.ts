import {
  ALGORITHM_LABELS,
  CONFIG,
  PATH_ALGORITHMS,
  ROUTING_LABELS,
  type ExitId,
  type MovementMode,
  type PathAlgorithm,
  type RoutingMode,
} from "../config/simulationConfig";
import { MAPS, type MapId } from "../maps/maps";
import { Experiment, SCENARIO_LABELS, type Scenario } from "./Experiment";
import { parseLayout } from "./LayoutFile";

/**
 * Matched-seed comparisons on the building maps: every variant runs the same
 * layout, crowd, start positions (seed 549), exit scenario and local movement;
 * only the routing strategy and path-planning algorithm change.
 */
export interface ComparisonVariant { mode: RoutingMode; algorithm: PathAlgorithm | null; }

export interface ComparisonRequest {
  mapId: MapId;
  /** Saved layout file text for an edited layout; null runs the preset map. */
  layout: string | null;
  population: number;
  scenario: Scenario;
  movement: MovementMode;
  variants: ComparisonVariant[];
  timeLimitSeconds: number;
}

export interface ComparisonResult {
  map: string;
  layout: "preset" | "edited";
  routing: RoutingMode;
  algorithm: PathAlgorithm | null;
  label: string;
  movement: MovementMode;
  scenario: Scenario;
  population: number;
  seed: number;
  status: "complete" | "timed out";
  evacuated: number;
  totalEvacuationSeconds: number | null;
  meanEvacuationSeconds: number | null;
  elapsedSeconds: number;
  /** When Exit A actually closed in the closure scenario (null if it never did). */
  exitAClosedSeconds: number | null;
  byExit: Partial<Record<ExitId, number>>;
  routeSwitches: number;
  peakDensity: number;
  computeMilliseconds: number;
}

export type ComparisonMessage =
  | { type: "progress"; completed: number; total: number; label: string; time: number; result?: ComparisonResult }
  | { type: "done" }
  | { type: "error"; message: string };

export const MAX_COMPARISON_VARIANTS = 16;

export function variantLabel(v: ComparisonVariant) {
  return v.mode === "flow-field" || !v.algorithm ? ROUTING_LABELS[v.mode] : `${ROUTING_LABELS[v.mode]} · ${ALGORITHM_LABELS[v.algorithm]}`;
}

/** Every chosen strategy × algorithm; Shared Flow Field runs once because it does no per-person search. */
export function comparisonVariants(modes: RoutingMode[], algorithms: PathAlgorithm[]): ComparisonVariant[] {
  const variants: ComparisonVariant[] = [];
  for (const mode of modes) {
    if (mode === "flow-field") variants.push({ mode, algorithm: null });
    else for (const algorithm of algorithms) variants.push({ mode, algorithm });
  }
  return variants;
}

export function validateRequest(r: ComparisonRequest) {
  if (!Object.hasOwn(MAPS, r.mapId)) throw new Error("Unknown building layout.");
  if (!r.variants.length) throw new Error("Choose at least one routing strategy, and at least one algorithm for search-based strategies.");
  if (r.variants.length > MAX_COMPARISON_VARIANTS) throw new Error(`Choose at most ${MAX_COMPARISON_VARIANTS} combinations per comparison.`);
  for (const v of r.variants) {
    if (!["shortest", "congestion", "flow-field"].includes(v.mode)) throw new Error("Unknown routing strategy.");
    if (v.mode !== "flow-field" && (!v.algorithm || !PATH_ALGORITHMS.includes(v.algorithm))) throw new Error("Unknown path-planning algorithm.");
  }
  if (!Number.isInteger(r.timeLimitSeconds) || r.timeLimitSeconds < 30 || r.timeLimitSeconds > 1800)
    throw new Error("Choose a run limit from 30 to 1,800 simulated seconds.");
}

/** One variant, advanced in small steps so a worker can report progress and be cancelled. */
export class ComparisonRun {
  readonly experiment = new Experiment();
  private compute = 0;
  constructor(private request: ComparisonRequest, readonly variant: ComparisonVariant) {
    const e = this.experiment, s = e.simulation;
    if (request.layout) {
      const loaded = parseLayout(request.layout);
      if (loaded.mapId !== request.mapId) throw new Error("The edited layout belongs to a different map.");
      s.mapId = request.mapId;
      s.loadCustomLayout(loaded.grid);
    }
    e.begin(request.population, variant.mode, request.scenario, request.mapId, true, request.movement, variant.algorithm ?? "astar");
  }
  get done() {
    const s = this.experiment.simulation;
    return s.metrics.remainingAgents === 0 || s.time >= this.request.timeLimitSeconds;
  }
  /** Advances up to `steps` fixed simulation steps. */
  step(steps = 30) {
    const t = performance.now();
    for (let i = 0; i < steps && !this.done; i++) this.experiment.update(CONFIG.fixedDt);
    this.compute += performance.now() - t;
  }
  result(): ComparisonResult {
    const s = this.experiment.simulation, m = s.metrics, complete = m.remainingAgents === 0;
    const byExit: Partial<Record<ExitId, number>> = {};
    for (const [id, record] of m.byExit) byExit[id] = record.count;
    return {
      map: MAPS[this.request.mapId].name,
      layout: this.request.layout ? "edited" : "preset",
      routing: this.variant.mode,
      algorithm: this.variant.algorithm,
      label: variantLabel(this.variant),
      movement: this.request.movement,
      scenario: this.request.scenario,
      population: this.request.population,
      seed: CONFIG.seed,
      status: complete ? "complete" : "timed out",
      evacuated: m.evacuatedCount,
      totalEvacuationSeconds: complete ? m.totalEvacuationTime : null,
      meanEvacuationSeconds: m.evacuatedCount ? m.averageEvacuationTime : null,
      elapsedSeconds: s.time,
      exitAClosedSeconds: this.experiment.closureTime,
      byExit,
      routeSwitches: s.routeSwitchCount,
      peakDensity: m.peakDensity,
      computeMilliseconds: this.compute,
    };
  }
}

const csvCell = (value: unknown) => {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};
const round = (n: number | null, digits = 2) => (n === null ? null : Number(n.toFixed(digits)));

export function comparisonCsv(results: ComparisonResult[]): string {
  const exits = [...new Set(results.flatMap((r) => Object.keys(r.byExit)))].sort() as ExitId[];
  const header = ["map", "layout", "routing_strategy", "algorithm", "local_movement", "scenario", "population", "seed", "status",
    "evacuated", "total_evacuation_s", "mean_evacuation_s", "elapsed_s", "exit_A_closed_s", ...exits.map((id) => `exit_${id}_count`),
    "route_switches", "peak_density", "compute_ms"];
  const rows = results.map((r) => [r.map, r.layout, ROUTING_LABELS[r.routing], r.algorithm ? ALGORITHM_LABELS[r.algorithm] : "n/a (flow field)",
    r.movement, SCENARIO_LABELS[r.scenario], r.population, r.seed, r.status,
    r.evacuated, round(r.totalEvacuationSeconds), round(r.meanEvacuationSeconds), round(r.elapsedSeconds), round(r.exitAClosedSeconds),
    ...exits.map((id) => r.byExit[id] ?? 0), r.routeSwitches, round(r.peakDensity, 3), Math.round(r.computeMilliseconds)]);
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
}
