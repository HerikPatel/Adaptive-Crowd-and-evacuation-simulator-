import type { ExitId } from "../config/simulationConfig";
export class Metrics {
  /** Times are seconds on the deterministic simulation clock, not wall-clock dates. */
  simulationStartTime: number | null = null;
  simulationElapsedTime = 0;
  evacuatedCount = 0;
  remainingAgents: number;
  totalEvacuationTime: number | null = null;
  peakDensity = 0;
  exitAEvacuatedCount = 0;
  exitBEvacuatedCount = 0;
  timeToClearExitA: number | null = null;
  timeToClearExitB: number | null = null;
  lastEvacuationA: number | null = null;
  lastEvacuationB: number | null = null;
  averageEvacuationTime = 0;
  routeSwitchCount = 0;
  private evacuationTimeSum = 0;
  constructor(public totalAgents: number) {
    this.remainingAgents = totalAgents;
  }
  recordEvacuation(exit: ExitId, time: number) {
    this.evacuatedCount++;
    this.remainingAgents--;
    this.evacuationTimeSum += time;
    this.averageEvacuationTime = this.evacuationTimeSum / this.evacuatedCount;
    if (exit === "A") {
      this.exitAEvacuatedCount++;
      this.lastEvacuationA = time;
    } else {
      this.exitBEvacuatedCount++;
      this.lastEvacuationB = time;
    }
    if (this.remainingAgents === 0) {
      this.totalEvacuationTime = time;
      this.timeToClearExitA = this.lastEvacuationA;
      this.timeToClearExitB = this.lastEvacuationB;
    }
  }
  update(time: number, peakDensity: number, routeSwitches: number) {
    if (this.simulationStartTime === null) this.simulationStartTime = 0;
    this.simulationElapsedTime = time;
    this.peakDensity = Math.max(this.peakDensity, peakDensity);
    this.routeSwitchCount = routeSwitches;
  }
}
