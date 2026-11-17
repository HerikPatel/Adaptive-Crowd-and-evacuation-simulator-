import { ALGORITHM_LABELS, PATH_ALGORITHMS, ROUTING_LABELS, MOVEMENT_LABELS, type PathAlgorithm, type RoutingMode } from "../config/simulationConfig";
import { MAPS } from "../maps/maps";
import type { Experiment } from "../simulation/Experiment";
import { serializeLayout } from "../simulation/LayoutFile";
import {
  comparisonCsv,
  comparisonVariants,
  validateRequest,
  type ComparisonMessage,
  type ComparisonRequest,
  type ComparisonResult,
} from "../simulation/BuildingComparison";

const MODES: RoutingMode[] = ["shortest", "congestion", "flow-field"];
const seconds = (n: number | null) => (n === null ? "—" : n.toFixed(1));

/** Side-by-side, matched-seed comparison of routing strategies on the current building layout. */
export class BuildingComparisonPanel {
  private worker?: Worker;
  private results: ComparisonResult[] = [];

  constructor(private root: HTMLElement, private experiment: Experiment) {
    root.innerHTML = `
      <details class="comparison-panel">
        <summary><strong>Compare strategies</strong> <span>same layout, same crowd, same seed</span></summary>
        <p class="field-help">Runs the current layout (including your edits), crowd size, exit scenario and local movement once for each combination you choose. Everyone starts in the same place (seed 549), so differences come from routing alone. Runs happen in the background; the live view pauses.</p>
        <form id="comparison-form"><fieldset id="comparison-fields" class="comparison-form">
          <fieldset class="checks"><legend>Routing strategies</legend>
            ${MODES.map((m) => `<label class="check"><input type="checkbox" name="comparison-mode" value="${m}"${m !== "flow-field" ? " checked" : ""}> ${ROUTING_LABELS[m]}</label>`).join("")}
          </fieldset>
          <fieldset class="checks"><legend>Path-planning algorithms</legend>
            ${PATH_ALGORITHMS.map((a) => `<label class="check"><input type="checkbox" name="comparison-algorithm" value="${a}"${a === "astar" || a === "thetastar" ? " checked" : ""}> ${ALGORITHM_LABELS[a]}</label>`).join("")}
          </fieldset>
          <div><label for="comparison-limit">Run limit (simulated seconds)</label><input id="comparison-limit" type="number" min="30" max="1800" step="1" value="300" required></div>
          <div class="comparison-submit"><button type="submit" class="primary">Run comparison</button></div>
        </fieldset></form>
        <p id="comparison-summary" class="field-help"></p>
        <div class="stadium-experiment-actions"><button type="button" id="comparison-cancel" disabled>Cancel</button><button type="button" id="comparison-export" disabled>Download results CSV</button></div>
        <p id="comparison-status" role="status">Choose strategies and algorithms, then run the comparison.</p>
        <p id="comparison-error" class="error" role="alert"></p>
        <progress id="comparison-progress" value="0" max="1" aria-label="Completed comparison runs"></progress>
        <div id="comparison-results" hidden>
          <h4>Total evacuation time <span class="field-help">shorter is faster · fastest highlighted</span></h4>
          <div id="comparison-bars"></div>
          <div class="stadium-table-scroll" tabindex="0" role="region" aria-label="Comparison results"><table>
            <thead><tr><th scope="col">Strategy</th><th scope="col">Status</th><th scope="col">Evacuated</th><th scope="col">Total (s)</th><th scope="col">Mean per person (s)</th><th scope="col">People per exit</th><th scope="col">Route switches</th><th scope="col">Exit A closed (s)</th></tr></thead>
            <tbody id="comparison-table"></tbody></table></div>
        </div>
      </details>`;
    root.querySelector("#comparison-form")!.addEventListener("submit", (event) => { event.preventDefault(); this.start(); });
    root.querySelector("#comparison-form")!.addEventListener("change", () => this.summarize());
    root.querySelector("details")!.addEventListener("toggle", () => this.summarize());
    root.querySelector("#comparison-cancel")!.addEventListener("click", () => this.cancel());
    root.querySelector("#comparison-export")!.addEventListener("click", () => this.download());
  }

  private checked(name: string) {
    return Array.from(this.root.querySelectorAll<HTMLInputElement>(`input[name="${name}"]:checked`), (i) => i.value);
  }

  /** Snapshot of the live experiment's settings, taken when the comparison starts. */
  private request(): ComparisonRequest {
    const s = this.experiment.simulation;
    return {
      mapId: s.mapId,
      layout: s.hasCustomLayout ? serializeLayout(s.layoutFor(), s.mapId) : null,
      population: s.agentCount,
      scenario: this.experiment.scenario,
      movement: s.movementMode,
      variants: comparisonVariants(this.checked("comparison-mode") as RoutingMode[], this.checked("comparison-algorithm") as PathAlgorithm[]),
      timeLimitSeconds: Number(this.root.querySelector<HTMLInputElement>("#comparison-limit")!.value),
    };
  }

  summarize() {
    const r = this.request();
    const runs = r.variants.length;
    this.root.querySelector("#comparison-summary")!.textContent = runs
      ? `${runs} run${runs === 1 ? "" : "s"} · ${r.population} people · ${MAPS[r.mapId].name}${r.layout ? " (edited)" : ""} · ${r.scenario === "closure" ? "Exit A closes at 5 s" : "All exits open"} · ${MOVEMENT_LABELS[r.movement]}`
      : "Choose at least one strategy, and an algorithm for Shortest Path or Congestion Aware.";
  }

  private start() {
    if (this.worker) return;
    this.root.querySelector("#comparison-error")!.textContent = "";
    let request: ComparisonRequest;
    try {
      request = this.request();
      validateRequest(request);
    } catch (error) { this.fail((error as Error).message); return; }
    this.experiment.pause();
    this.results = [];
    this.render();
    this.busy(true);
    const progress = this.root.querySelector<HTMLProgressElement>("#comparison-progress")!;
    progress.max = request.variants.length;
    progress.value = 0;
    this.root.querySelector("#comparison-status")!.textContent = `Starting ${request.variants.length} runs…`;
    try {
      const worker = new Worker(new URL("../simulation/buildingComparison.worker.ts", import.meta.url), { type: "module" });
      this.worker = worker;
      worker.onmessage = (event: MessageEvent<ComparisonMessage>) => {
        const m = event.data;
        if (m.type === "progress") {
          if (m.result) { this.results.push(m.result); this.render(); }
          progress.value = m.completed;
          this.root.querySelector("#comparison-status")!.textContent = m.completed === m.total
            ? "Finishing…" : `Run ${m.completed + 1} of ${m.total}: ${m.label} · ${m.time.toFixed(0)} s simulated`;
        } else if (m.type === "done") {
          this.stop();
          const best = this.fastest();
          this.root.querySelector("#comparison-status")!.textContent = `Comparison finished · ${this.results.length} runs${best ? ` · fastest: ${best.label} (${seconds(best.totalEvacuationSeconds)} s)` : ""}. Download the CSV to keep these results.`;
        } else this.fail(m.message);
      };
      worker.onerror = () => this.fail("The comparison stopped unexpectedly. Finished runs are kept; try fewer combinations.");
      worker.postMessage(request);
    } catch (error) { this.fail((error as Error).message); }
  }

  private fastest() {
    return this.results.filter((r) => r.totalEvacuationSeconds !== null)
      .sort((a, b) => a.totalEvacuationSeconds! - b.totalEvacuationSeconds!)[0];
  }
  private busy(value: boolean) {
    this.root.querySelector<HTMLFieldSetElement>("#comparison-fields")!.disabled = value;
    this.root.querySelector<HTMLButtonElement>("#comparison-cancel")!.disabled = !value;
  }
  private stop() { this.worker?.terminate(); this.worker = undefined; this.busy(false); }
  private fail(message: string) { this.stop(); this.root.querySelector("#comparison-error")!.textContent = message; }
  cancel() {
    if (!this.worker) return;
    this.stop();
    this.root.querySelector("#comparison-status")!.textContent = `Cancelled · ${this.results.length} finished runs kept.`;
  }

  private render() {
    this.root.querySelector<HTMLElement>("#comparison-results")!.hidden = !this.results.length;
    this.root.querySelector<HTMLButtonElement>("#comparison-export")!.disabled = !this.results.length;
    const best = this.fastest();
    const maximum = Math.max(1, ...this.results.map((r) => r.totalEvacuationSeconds ?? r.elapsedSeconds));
    const ordered = [...this.results].sort((a, b) => (a.totalEvacuationSeconds ?? Infinity) - (b.totalEvacuationSeconds ?? Infinity));
    this.root.querySelector("#comparison-bars")!.innerHTML = ordered.map((r) => {
      const value = r.totalEvacuationSeconds ?? r.elapsedSeconds;
      const text = r.totalEvacuationSeconds === null ? `timed out · ${r.evacuated}/${r.population} out` : `${seconds(value)} s`;
      return `<div class="stadium-result-bar"><span>${r.label}</span><div><i class="${r === best ? "best" : r.totalEvacuationSeconds === null ? "timeout" : ""}" style="width:${(100 * value) / maximum}%"></i><strong>${text}</strong></div></div>`;
    }).join("");
    this.root.querySelector("#comparison-table")!.innerHTML = this.results.map((r) => `<tr><th scope="row">${r.label}</th><td>${r.status}</td><td>${r.evacuated}/${r.population}</td><td>${seconds(r.totalEvacuationSeconds)}</td><td>${seconds(r.meanEvacuationSeconds)}</td><td>${Object.entries(r.byExit).map(([id, n]) => `${id}: ${n}`).join(" · ")}</td><td>${r.routeSwitches}</td><td>${r.scenario === "closure" ? seconds(r.exitAClosedSeconds) : "—"}</td></tr>`).join("");
  }

  private download() {
    const s = this.experiment.simulation;
    const url = URL.createObjectURL(new Blob([comparisonCsv(this.results)], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `evacuation-lab-${s.mapId}-comparison.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
