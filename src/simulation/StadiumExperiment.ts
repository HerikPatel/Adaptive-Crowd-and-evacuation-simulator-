import { STADIUM } from "../maps/stadium";
import type { StadiumRoutingMode } from "../pathfinding/StadiumRouter";
import type { CrowdProfile } from "./PersonProfile";
import { StadiumSimulation, STADIUM_STEP, type StadiumMovement } from "./StadiumSimulation";

export const STADIUM_EXPERIMENT_VERSION = "stadium-movement-v2";
export type StadiumScenario = "open" | "east-closure";
export interface ExperimentJob { population: number; seed: number; profile: CrowdProfile; routing: StadiumRoutingMode; scenario: StadiumScenario; movementMode?: StadiumMovement }
export interface ExperimentSample { time: number; evacuated: number; waiting: number; stranded: number }
export interface ExperimentResult extends ExperimentJob {
  version: string; status: "complete" | "blocked" | "timeout";
  timeLimitSeconds: number;
  movementMode: StadiumMovement; completedPasses: number; passAttempts: number;
  elapsedSeconds: number; totalEvacuationSeconds: number | null; meanExitSeconds: number | null;
  evacuated: number; meanWaitingSeconds: number; peakWaiting: number;
  routeSwitches: number; forcedReroutes: number; routingSearches: number;
  computeMs: number; steps: number; maxStepMs: number;
  exits: Record<string, number>; samples: ExperimentSample[];
}
export interface ExperimentRequest { populations: number[]; seeds: number[]; timeLimitSeconds?: number; movementMode?: StadiumMovement }
export function experimentTimeLimit(request: Pick<ExperimentRequest, "timeLimitSeconds">): number {
  const seconds = request.timeLimitSeconds ?? 1800;
  if (!Number.isInteger(seconds) || seconds < 60 || seconds > 7200)
    throw new Error("Choose a whole-number run limit between 60 and 7200 simulated seconds.");
  return seconds;
}
export function experimentJobs(request: ExperimentRequest): ExperimentJob[] {
  experimentTimeLimit(request);
  if (request.movementMode !== undefined && request.movementMode !== "queue" && request.movementMode !== "passing") throw new Error("Choose a valid local movement mode.");
  const valid = (values: number[], min: number, max: number) => values.length >= 1 && values.length <= 3 && new Set(values).size === values.length && values.every(n => Number.isInteger(n) && n >= min && n <= max);
  if (!valid(request.populations, 1, 1000)) throw new Error("Choose 1–3 different whole-number populations between 1 and 1000.");
  if (!valid(request.seeds, 0, 2147483647)) throw new Error("Choose 1–3 different whole-number seeds between 0 and 2147483647.");
  return request.populations.flatMap(population => request.seeds.flatMap(seed =>
    (["uniform", "mixed"] as CrowdProfile[]).flatMap(profile => (["open", "east-closure"] as StadiumScenario[]).flatMap(scenario =>
      (["free-flow", "adaptive"] as StadiumRoutingMode[]).map(routing => ({ population, seed, profile, scenario, routing, movementMode: request.movementMode ?? "passing" }))))));
}

/** Headless fixed-step run. No UI state, wall-clock timing, or rendering affects decisions. */
export class StadiumExperimentRun {
  readonly simulation: StadiumSimulation;
  readonly samples: ExperimentSample[] = [];
  private closureApplied = false;
  private nextSample = 5;
  private computeMs = 0;
  private maxStepMs = 0;
  private steps = 0;
  constructor(readonly job: ExperimentJob, readonly timeLimit = 1800) {
    if (!Number.isFinite(timeLimit) || timeLimit <= 0) throw new Error("Time limit must be positive.");
    this.simulation = new StadiumSimulation(undefined, { count: job.population, seed: job.seed, profileMode: job.profile, routingMode: job.routing, movementMode: job.movementMode });
    this.capture(); this.simulation.start();
  }
  get done() { return !this.simulation.running || this.simulation.time >= this.timeLimit - 1e-8; }
  step() {
    if (this.done) return;
    const started = performance.now(), s = this.simulation;
    // Apply on the first fixed boundary at 35 s, before any subsequent movement/admission.
    if (this.job.scenario === "east-closure" && !this.closureApplied && s.time >= 35 - 1e-8) {
      s.router.setClosed("gate-east", true); this.closureApplied = true;
    }
    s.update(Math.min(STADIUM_STEP, this.timeLimit - s.time)); this.steps++;
    const ms = performance.now() - started; this.computeMs += ms; this.maxStepMs = Math.max(this.maxStepMs, ms);
    if (s.time >= this.nextSample - 1e-8 || this.done) { this.capture(); this.nextSample += 5; }
  }
  private capture() {
    const s = this.simulation.snapshot();
    this.samples.push({ time: s.time, evacuated: s.evacuated, waiting: s.waiting, stranded: s.stranded });
  }
  result(): ExperimentResult {
    if (!this.done) throw new Error("Experiment is still running.");
    const s = this.simulation, m = s.snapshot();
    return { ...this.job, version: STADIUM_EXPERIMENT_VERSION, status: s.complete ? "complete" : s.blocked ? "blocked" : "timeout",
      movementMode: s.movementMode, completedPasses: m.completedPasses, passAttempts: m.passAttempts,
      timeLimitSeconds: this.timeLimit, elapsedSeconds: s.time, totalEvacuationSeconds: s.complete ? s.time : null, meanExitSeconds: m.averageEvacuationSeconds,
      evacuated: m.evacuated, meanWaitingSeconds: m.meanWaitingSeconds, peakWaiting: m.peakWaiting,
      routeSwitches: m.routeSwitches, forcedReroutes: m.forcedReroutes, routingSearches: m.routingSearches,
      computeMs: this.computeMs, steps: this.steps, maxStepMs: this.maxStepMs, exits: m.exits, samples: this.samples };
  }
}

function csv(rows: (string | number | null)[][]): string {
  return rows.map(row => row.map(value => `"${String(value ?? "").replaceAll('"', '""')}"`).join(",")).join("\r\n") + "\r\n";
}
export function resultsCsv(results: ExperimentResult[]): string {
  return csv([["model_version", "population", "seed", "profile", "routing", "scenario", "closure_at_seconds", "time_limit_seconds", "status", "evacuated", "elapsed_seconds", "total_evacuation_seconds", "mean_exit_seconds_evacuated_only", "mean_waiting_seconds_all_people", "peak_waiting_after_response", "voluntary_route_switches", "forced_reroutes", "potential_searches", "compute_ms", "steps", "mean_step_ms", "max_step_ms", ...STADIUM.gates.map(g => g.id), "movement_mode", "completed_passes", "pass_attempts"],
    ...results.map(r => [r.version, r.population, r.seed, r.profile, r.routing, r.scenario, r.scenario === "east-closure" ? 35 : null, r.timeLimitSeconds, r.status, r.evacuated, r.elapsedSeconds, r.totalEvacuationSeconds, r.meanExitSeconds, r.meanWaitingSeconds, r.peakWaiting, r.routeSwitches, r.forcedReroutes, r.routingSearches, r.computeMs, r.steps, r.steps ? r.computeMs / r.steps : 0, r.maxStepMs, ...STADIUM.gates.map(g => r.exits[g.id]), r.movementMode, r.completedPasses, r.passAttempts])]);
}
export function samplesCsv(results: ExperimentResult[]): string {
  return csv([["model_version", "population", "seed", "profile", "routing", "scenario", "time_seconds", "evacuated", "waiting_including_response", "stranded", "movement_mode", "time_limit_seconds"],
    ...results.flatMap(r => r.samples.map(s => [r.version, r.population, r.seed, r.profile, r.routing, r.scenario, s.time, s.evacuated, s.waiting, s.stranded, r.movementMode, r.timeLimitSeconds]))]);
}
export interface ExperimentProgress { type: "progress"; completed: number; total: number; job: ExperimentJob; time: number; result?: ExperimentResult }
export type ExperimentMessage = ExperimentProgress | { type: "done" } | { type: "error"; message: string };
