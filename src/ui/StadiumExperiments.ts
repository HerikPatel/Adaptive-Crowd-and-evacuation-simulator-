import { experimentJobs, resultsCsv, samplesCsv, type ExperimentMessage, type ExperimentResult } from "../simulation/StadiumExperiment";
import { routingSummaries, statisticsCsv, type SampleStatistics } from "../simulation/StadiumStatistics";
import type { StadiumMovement } from "../simulation/StadiumSimulation";

const label = (r: ExperimentResult) => `${r.population} people · seed ${r.seed} · ${r.profile} · ${r.scenario} · ${r.routing} · ${r.movementMode}`;
const seconds = (n: number | null) => n === null ? "—" : n.toFixed(1);
const spread = (s: SampleStatistics) => s.mean === null ? "—" : `${s.mean.toFixed(1)}${s.sd === null ? " (one pair)" : ` ± ${s.sd.toFixed(1)}`}`;
export class StadiumExperiments {
  private worker?: Worker;
  private results: ExperimentResult[] = [];
  constructor(private root: HTMLElement, private pauseLive: () => void) {
    root.innerHTML = `<span class="eyebrow">COMPARE & MEASURE</span><h3>Stadium experiments</h3>
      <p>Compare free-flow and adaptive routing with identical seeds and starting seats. Each population/seed runs eight cases: both routing modes, uniform and individual profiles, and all gates open or the east gate closing at 35 seconds.</p>
      <form id="stadium-experiment-form"><fieldset id="stadium-experiment-fields" class="stadium-experiment-form">
        <div><label for="experiment-populations">Comparison populations</label><input id="experiment-populations" value="100" required aria-describedby="experiment-help"></div>
        <div><label for="experiment-seeds">Comparison seeds</label><input id="experiment-seeds" value="549" required aria-describedby="experiment-help"></div>
        <div><label for="experiment-time-limit">Run limit (simulated seconds)</label><input id="experiment-time-limit" type="number" min="60" max="7200" step="1" value="1800" required aria-describedby="experiment-help"></div>
        <div><label for="experiment-movement">Comparison local movement</label><select id="experiment-movement"><option value="passing">Predictive passing</option><option value="queue">Queue baseline</option></select></div>
        <button type="submit" class="primary">Run comparisons</button></fieldset></form>
      <p id="experiment-help" class="field-help">Enter up to three comma-separated values, e.g. populations 100, 500, 1000 and seeds 549, 550, 551. Choose a run limit from 60 to 7,200 simulated seconds; try 3,600 for large closure scenarios. Longer runs and larger batches take more time. Runs use all seating levels and default map settings; live map edits and individual overrides are excluded.</p>
      <div class="stadium-experiment-actions"><button type="button" id="experiment-cancel" disabled>Cancel comparisons</button><button type="button" id="experiment-export" disabled>Download results CSV</button><button type="button" id="experiment-export-series" disabled>Download time series CSV</button><button type="button" id="experiment-export-statistics" disabled>Download statistics CSV</button></div>
      <p id="experiment-status" role="status">Ready to compare. Results stay here until a new batch or page reload.</p><p id="experiment-error" class="error" role="alert"></p>
      <progress id="experiment-progress" value="0" max="8" aria-label="Completed comparison runs"></progress>
      <div id="experiment-results" hidden>
        <h4>Evacuation time by run</h4><p class="field-help">Completed runs only; shorter bars mean faster evacuation. Incomplete runs remain in the table and CSV with an explicit status.</p><div id="experiment-bars"></div>
        <h4>Paired routing comparison</h4><div id="experiment-pairs"></div>
        <h4>Summary across seeds</h4><p class="field-help">Mean ± sample standard deviation across matched seeds, not a confidence interval. Positive reduction means adaptive is faster. Completion-time statistics use only pairs where both runs finished; check the completed counts before comparing. One seed cannot establish variability.</p>
        <div class="stadium-table-scroll" tabindex="0" role="region" aria-label="Statistics across seeds"><table><caption>Matched routing results · same population, profile, scenario and run limit</caption><thead><tr><th scope="col">Comparison</th><th scope="col">Matched / recorded seeds</th><th scope="col">Complete runs baseline / adaptive</th><th scope="col">Both complete</th><th scope="col">Time reduction (s)</th><th scope="col">Time reduction (%)</th><th scope="col">Mean outside at stop baseline → adaptive</th></tr></thead><tbody id="experiment-statistics"></tbody></table></div>
        <p class="field-help">Cancelled batches may have unmatched seeds; these contribute to neither paired averages nor complete-run counts above. Outside counts include completed, timed-out and blocked results at their respective stopping times. Full statuses and run limits are retained in the CSVs; missing completion times are never replaced by the time limit.</p>
        <div class="stadium-experiment-form"><div><label for="experiment-chart-run">Chart run</label><select id="experiment-chart-run"></select></div><div><label for="experiment-chart-measure">Chart measure</label><select id="experiment-chart-measure"><option value="evacuated">People evacuated</option><option value="waiting">People waiting (includes response delay)</option></select></div></div>
        <svg id="experiment-chart" viewBox="0 0 760 270" role="img" aria-label="Selected run over simulation time"></svg>
        <div class="stadium-table-scroll" tabindex="0" role="region" aria-label="Comparison measurements"><table><caption>All runs · times in seconds</caption><thead><tr><th scope="col">Run</th><th scope="col">Status</th><th scope="col">Outside</th><th scope="col">Total</th><th scope="col">Mean exit*</th><th scope="col">Mean wait†</th><th scope="col">Peak wait†</th><th scope="col">Switches</th><th scope="col">Compute ms/step</th></tr></thead><tbody id="experiment-table"></tbody></table></div>
        <p class="field-help">* Mean exit time includes evacuated people only. † Stopped waiting after response delay; mean uses the whole starting population. This excludes time stranded without a route. Compute time measures simulation work in this browser, not rendering FPS, and varies with hardware/load. CSV includes per-gate totals, forced reroutes, and peak step time.</p>
      </div>`;
    root.querySelector("#stadium-experiment-form")!.addEventListener("submit", event => { event.preventDefault(); this.start(); });
    root.querySelector("#experiment-cancel")!.addEventListener("click", () => this.cancel());
    root.querySelector("#experiment-export")!.addEventListener("click", () => this.download("stadium-comparisons.csv", resultsCsv(this.results)));
    root.querySelector("#experiment-export-series")!.addEventListener("click", () => this.download("stadium-time-series.csv", samplesCsv(this.results)));
    root.querySelector("#experiment-export-statistics")!.addEventListener("click", () => this.download("stadium-statistics.csv", statisticsCsv(this.results)));
    for (const id of ["experiment-chart-run", "experiment-chart-measure"]) root.querySelector(`#${id}`)!.addEventListener("change", () => this.chart());
  }
  private start() {
    if (this.worker) return;
    try {
      const numbers = (id: string) => this.root.querySelector<HTMLInputElement>(`#${id}`)!.value.split(",").map(s => s.trim() ? Number(s) : NaN);
      const request = { populations: numbers("experiment-populations"), seeds: numbers("experiment-seeds"), timeLimitSeconds: Number(this.root.querySelector<HTMLInputElement>("#experiment-time-limit")!.value), movementMode: this.root.querySelector<HTMLSelectElement>("#experiment-movement")!.value as StadiumMovement }, jobs = experimentJobs(request);
      const worker = new Worker(new URL("../simulation/stadiumExperiment.worker.ts", import.meta.url), { type: "module" });
      this.pauseLive(); this.worker = worker; this.results = []; this.render(); this.busy(true);
      this.root.querySelector("#experiment-error")!.textContent = "";
      this.root.querySelector("#experiment-status")!.textContent = `Starting ${jobs.length} comparison runs · ${request.timeLimitSeconds} s limit…`;
      const progress = this.root.querySelector<HTMLProgressElement>("#experiment-progress")!; progress.value = 0; progress.max = jobs.length;
      worker.onmessage = (event: MessageEvent<ExperimentMessage>) => {
        if (this.worker !== worker) return;
        const m = event.data;
        if (m.type === "progress") {
          if (m.result) { this.results.push(m.result); this.render(); }
          progress.value = m.completed;
          this.root.querySelector("#experiment-status")!.textContent = `${m.completed} / ${m.total} finished · ${m.job.population} people · seed ${m.job.seed} · ${m.job.profile} · ${m.job.scenario} · ${m.job.routing} · ${m.time.toFixed(0)} / ${request.timeLimitSeconds} simulated seconds`;
        } else if (m.type === "done") {
          this.stop(); this.root.querySelector("#experiment-status")!.textContent = `Comparison finished · ${this.results.length} runs recorded · ${request.timeLimitSeconds} s limit. Download the CSV files to keep these results.`;
        } else this.fail(m.message);
      };
      worker.onerror = () => this.fail("The comparison worker failed. Completed runs are retained; try a smaller batch or reload the page.");
      worker.postMessage(request);
    } catch (error) { this.fail((error as Error).message); }
  }
  private busy(value: boolean) {
    this.root.querySelector<HTMLFieldSetElement>("#stadium-experiment-fields")!.disabled = value;
    this.root.querySelector<HTMLButtonElement>("#experiment-cancel")!.disabled = !value;
  }
  private stop() { this.worker?.terminate(); this.worker = undefined; this.busy(false); }
  private fail(message: string) { this.stop(); this.root.querySelector("#experiment-error")!.textContent = message; }
  cancel() {
    if (!this.worker) return;
    this.stop(); this.root.querySelector("#experiment-status")!.textContent = `Cancelled · ${this.results.length} finished runs retained. The interrupted run is excluded.`;
  }
  private render() {
    this.root.querySelector<HTMLElement>("#experiment-results")!.hidden = !this.results.length;
    for (const id of ["experiment-export", "experiment-export-series", "experiment-export-statistics"]) this.root.querySelector<HTMLButtonElement>(`#${id}`)!.disabled = !this.results.length;
    const maximum = Math.max(1, ...this.results.map(r => r.totalEvacuationSeconds ?? 0));
    this.root.querySelector("#experiment-bars")!.innerHTML = this.results.filter(r => r.status === "complete").map(r =>
      `<div class="stadium-result-bar"><span>${label(r)}</span><div><i class="${r.routing}" style="width:${100 * r.totalEvacuationSeconds! / maximum}%"></i><strong>${seconds(r.totalEvacuationSeconds)} s</strong></div></div>`).join("");
    this.root.querySelector("#experiment-table")!.innerHTML = this.results.map(r => `<tr><th scope="row">${label(r)}</th><td>${r.status}</td><td>${r.evacuated}/${r.population}</td><td>${seconds(r.totalEvacuationSeconds)}</td><td>${seconds(r.meanExitSeconds)}</td><td>${seconds(r.meanWaitingSeconds)}</td><td>${r.peakWaiting}</td><td>${r.routeSwitches}</td><td>${(r.computeMs / Math.max(1, r.steps)).toFixed(3)}</td></tr>`).join("");
    const pairs = this.results.filter(r => r.routing === "adaptive").map(a => {
      const b = this.results.find(b => b.routing === "free-flow" && b.population === a.population && b.seed === a.seed && b.profile === a.profile && b.scenario === a.scenario && b.version === a.version && b.timeLimitSeconds === a.timeLimitSeconds && b.movementMode === a.movementMode);
      const heading = `${a.population} people · seed ${a.seed} · ${a.profile} · ${a.scenario}`;
      if (!b) return `<p>${heading}: waiting for the matching baseline.</p>`;
      if (a.totalEvacuationSeconds === null || b.totalEvacuationSeconds === null) return `<p>${heading}: completion-time comparison unavailable. Baseline ${b.status}: ${b.evacuated}/${b.population} outside at ${seconds(b.elapsedSeconds)} s; adaptive ${a.status}: ${a.evacuated}/${a.population} outside at ${seconds(a.elapsedSeconds)} s (limit ${a.timeLimitSeconds} s).</p>`;
      const delta = b.totalEvacuationSeconds - a.totalEvacuationSeconds;
      const change = Math.abs(delta) < 0.05 ? "unchanged at 0.1 s precision" : `${Math.abs(delta).toFixed(1)} s (${(100 * Math.abs(delta) / b.totalEvacuationSeconds).toFixed(1)}%) ${delta > 0 ? "faster" : "slower"}`;
      return `<p>${heading}: adaptive ${change}; mean wait ${seconds(b.meanWaitingSeconds)} → ${seconds(a.meanWaitingSeconds)} s.</p>`;
    });
    this.root.querySelector("#experiment-pairs")!.innerHTML = pairs.join("") || "<p>Waiting for a matched routing pair.</p>";
    this.root.querySelector("#experiment-statistics")!.innerHTML = routingSummaries(this.results).map(s => `<tr><th scope="row">${s.population} people · ${s.profile} · ${s.scenario} · ${s.movementMode} · ${s.timeLimitSeconds} s limit<br>Seeds: ${s.seeds.join(", ")}</th><td>${s.pairs} / ${s.seeds.length}</td><td>${s.baselineComplete} / ${s.adaptiveComplete}</td><td>${s.completedPairs} / ${s.pairs}</td><td>${spread(s.completionReductionSeconds)}</td><td>${spread(s.completionReductionPercent)}</td><td>${seconds(s.baselineEvacuated.mean)} → ${seconds(s.adaptiveEvacuated.mean)}</td></tr>`).join("");
    const select = this.root.querySelector<HTMLSelectElement>("#experiment-chart-run")!, selected = select.value;
    select.innerHTML = this.results.map((r, i) => `<option value="${i}">${label(r)}</option>`).join("");
    if (selected) select.value = selected; this.chart();
  }
  private chart() {
    const r = this.results[Number(this.root.querySelector<HTMLSelectElement>("#experiment-chart-run")!.value)];
    if (!r) return;
    const measure = this.root.querySelector<HTMLSelectElement>("#experiment-chart-measure")!.value as "evacuated" | "waiting";
    const x = (time: number) => 52 + time / Math.max(1, r.elapsedSeconds) * 680;
    const y = (people: number) => 222 - people / r.population * 185;
    const svg = this.root.querySelector("#experiment-chart")!;
    svg.innerHTML = `<title>${measure === "evacuated" ? "Evacuated people" : "Waiting people"} · ${label(r)}</title>
      ${[0, 0.5, 1].map(f => `<path class="chart-grid" d="M52 ${y(f * r.population)}H732"/><text x="44" y="${y(f * r.population) + 4}" text-anchor="end">${Math.round(f * r.population)}</text>`).join("")}
      <path class="chart-axis" d="M52 30V222H732"/><text x="52" y="244">0</text><text x="732" y="244" text-anchor="end">${r.elapsedSeconds.toFixed(0)} s</text><text x="380" y="263" text-anchor="middle">Simulation time (seconds)</text><text x="52" y="19">${measure === "evacuated" ? "Evacuated people" : "Waiting people (including response)"}</text>
      <polyline class="chart-line" points="${r.samples.map(s => `${x(s.time).toFixed(2)},${y(s[measure]).toFixed(2)}`).join(" ")}"/>
      ${r.scenario === "east-closure" && r.elapsedSeconds >= 35 ? `<path class="chart-closure" d="M${x(35)} 32V222"/><text x="${Math.min(620, x(35) + 4)}" y="44">East closes: 35 s</text>` : ""}`;
  }
  private download(name: string, contents: string) {
    const url = URL.createObjectURL(new Blob([contents], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = name; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
