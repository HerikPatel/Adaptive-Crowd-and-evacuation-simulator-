import type { ExperimentResult } from "./StadiumExperiment";

export interface SampleStatistics { n: number; mean: number | null; sd: number | null; min: number | null; max: number | null }
export interface RoutingPair { baseline?: ExperimentResult; adaptive?: ExperimentResult }
export interface RoutingSummary {
  version: string; population: number; profile: ExperimentResult["profile"]; scenario: ExperimentResult["scenario"]; timeLimitSeconds: number;
  movementMode: ExperimentResult["movementMode"];
  seeds: number[]; pairs: number; unmatchedSeeds: number; completedPairs: number;
  baselineComplete: number; adaptiveComplete: number; baselineTimeout: number; adaptiveTimeout: number; baselineBlocked: number; adaptiveBlocked: number;
  completionReductionSeconds: SampleStatistics; completionReductionPercent: SampleStatistics;
  baselineCompletionSeconds: SampleStatistics; adaptiveCompletionSeconds: SampleStatistics;
  evacuatedDifference: SampleStatistics; baselineEvacuated: SampleStatistics; adaptiveEvacuated: SampleStatistics;
}

function statistics(values: number[]): SampleStatistics {
  if (!values.length) return { n: 0, mean: null, sd: null, min: null, max: null };
  const mean = values.reduce((sum, n) => sum + n, 0) / values.length;
  return { n: values.length, mean, sd: values.length > 1 ? Math.sqrt(values.reduce((sum, n) => sum + (n - mean) ** 2, 0) / (values.length - 1)) : null,
    min: Math.min(...values), max: Math.max(...values) };
}

/** Pair by seed inside identical model/protocol groups. Never substitute a timeout for completion. */
export function routingSummaries(results: ExperimentResult[]): RoutingSummary[] {
  const groups = new Map<string, { first: ExperimentResult; seeds: Map<number, RoutingPair> }>();
  for (const r of results) {
    const key = JSON.stringify([r.version, r.population, r.profile, r.scenario, r.timeLimitSeconds, r.movementMode]);
    const group = groups.get(key) ?? { first: r, seeds: new Map<number, RoutingPair>() };
    const pair = group.seeds.get(r.seed) ?? {};
    const policy = r.routing === "free-flow" ? "baseline" : "adaptive";
    if (pair[policy]) throw new Error(`Duplicate result for seed ${r.seed}, ${r.routing}, ${r.population} people, ${r.profile}, ${r.scenario}.`);
    pair[policy] = r; group.seeds.set(r.seed, pair); groups.set(key, group);
  }
  return [...groups.values()].map(({ first, seeds }) => {
    const pairs = [...seeds.values()].filter((p): p is Required<RoutingPair> => !!p.baseline && !!p.adaptive);
    const complete = pairs.filter(p => p.baseline.status === "complete" && p.adaptive.status === "complete" &&
      p.baseline.totalEvacuationSeconds !== null && p.adaptive.totalEvacuationSeconds !== null);
    const baselineTimes = complete.map(p => p.baseline.totalEvacuationSeconds!), adaptiveTimes = complete.map(p => p.adaptive.totalEvacuationSeconds!);
    const reductions = complete.map((_, i) => baselineTimes[i] - adaptiveTimes[i]);
    return {
      version: first.version, population: first.population, profile: first.profile, scenario: first.scenario, timeLimitSeconds: first.timeLimitSeconds,
      movementMode: first.movementMode,
      seeds: [...seeds.keys()].sort((a, b) => a - b), pairs: pairs.length, unmatchedSeeds: seeds.size - pairs.length, completedPairs: complete.length,
      baselineComplete: pairs.filter(p => p.baseline.status === "complete").length, adaptiveComplete: pairs.filter(p => p.adaptive.status === "complete").length,
      baselineTimeout: pairs.filter(p => p.baseline.status === "timeout").length, adaptiveTimeout: pairs.filter(p => p.adaptive.status === "timeout").length,
      baselineBlocked: pairs.filter(p => p.baseline.status === "blocked").length, adaptiveBlocked: pairs.filter(p => p.adaptive.status === "blocked").length,
      baselineCompletionSeconds: statistics(baselineTimes), adaptiveCompletionSeconds: statistics(adaptiveTimes),
      completionReductionSeconds: statistics(reductions),
      completionReductionPercent: statistics(reductions.map((n, i) => 100 * n / baselineTimes[i])),
      // Counts describe outcomes at each run's stopping point, not completion-time estimates.
      evacuatedDifference: statistics(pairs.map(p => p.adaptive.evacuated - p.baseline.evacuated)),
      baselineEvacuated: statistics(pairs.map(p => p.baseline.evacuated)), adaptiveEvacuated: statistics(pairs.map(p => p.adaptive.evacuated)),
    };
  });
}

export function statisticsCsv(results: ExperimentResult[]): string {
  const names = ["baselineCompletionSeconds", "adaptiveCompletionSeconds", "completionReductionSeconds", "completionReductionPercent", "baselineEvacuated", "adaptiveEvacuated", "evacuatedDifference"] as const;
  const columns = ["baseline_completion_seconds_complete_pairs", "adaptive_completion_seconds_complete_pairs", "completion_reduction_seconds_complete_pairs", "completion_reduction_percent_complete_pairs", "baseline_evacuated_at_stop", "adaptive_evacuated_at_stop", "evacuated_difference_at_stop"];
  const measures = ["n", "mean", "sd", "min", "max"] as const;
  const rows = [
    ["model_version", "population", "profile", "scenario", "time_limit_seconds", "seeds", "matched_pairs", "unmatched_seeds", "completed_pairs", "baseline_complete", "adaptive_complete", "baseline_timeout", "adaptive_timeout", "baseline_blocked", "adaptive_blocked", ...columns.flatMap(c => measures.map(m => `${c}_${m}`)), "movement_mode"],
    ...routingSummaries(results).map(s => [s.version, s.population, s.profile, s.scenario, s.timeLimitSeconds, s.seeds.join(";"), s.pairs, s.unmatchedSeeds, s.completedPairs,
      s.baselineComplete, s.adaptiveComplete, s.baselineTimeout, s.adaptiveTimeout, s.baselineBlocked, s.adaptiveBlocked, ...names.flatMap(name => measures.map(m => s[name][m])), s.movementMode]),
  ];
  return rows.map(row => row.map(value => `"${String(value ?? "").replaceAll('"', '""')}"`).join(",")).join("\r\n") + "\r\n";
}
