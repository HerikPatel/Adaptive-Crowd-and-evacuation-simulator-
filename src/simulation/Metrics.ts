import type { ExitId } from "../config/simulationConfig";
export interface ExitMetrics { count: number; last: number | null; clear: number | null; }
export class Metrics {
  /** Times are seconds on the deterministic simulation clock, not wall-clock dates. */
  simulationStartTime: number | null = null;
  simulationElapsedTime = 0;
  evacuatedCount = 0;
  remainingAgents: number;
  totalEvacuationTime: number | null = null;
  peakDensity = 0;
  readonly byExit = new Map<ExitId, ExitMetrics>();
  get exitAEvacuatedCount() { return this.byExit.get("A")?.count ?? 0; }
  get exitBEvacuatedCount() { return this.byExit.get("B")?.count ?? 0; }
  get timeToClearExitA() { return this.byExit.get("A")?.clear ?? null; }
  get timeToClearExitB() { return this.byExit.get("B")?.clear ?? null; }
  get lastEvacuationA() { return this.byExit.get("A")?.last ?? null; }
  get lastEvacuationB() { return this.byExit.get("B")?.last ?? null; }
  averageEvacuationTime = 0;
  routeSwitchCount = 0;
  private evacuationTimeSum = 0;
  constructor(public totalAgents: number, exits: ExitId[] = ["A", "B"]) {
    this.remainingAgents = totalAgents;
    for (const id of exits) this.addExit(id);
  }
  addExit(id: ExitId) {
    if (!this.byExit.has(id)) this.byExit.set(id, { count: 0, last: null, clear: null });
  }
  recordEvacuation(exit: ExitId, time: number) {
    this.evacuatedCount++;
    this.remainingAgents--;
    this.evacuationTimeSum += time;
    this.averageEvacuationTime = this.evacuationTimeSum / this.evacuatedCount;
    this.addExit(exit);
    const record = this.byExit.get(exit)!;
    record.count++;
    record.last = time;
    if (this.remainingAgents === 0) {
      this.totalEvacuationTime = time;
      for (const record of this.byExit.values()) record.clear = record.last;
    }
  }
  update(time: number, peakDensity: number, routeSwitches: number) {
    if (this.simulationStartTime === null) this.simulationStartTime = 0;
    this.simulationElapsedTime = time;
    this.peakDensity = Math.max(this.peakDensity, peakDensity);
    this.routeSwitchCount = routeSwitches;
  }
}
