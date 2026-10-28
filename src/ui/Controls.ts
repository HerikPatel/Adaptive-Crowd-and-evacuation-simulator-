import { Experiment } from "../simulation/Experiment";
import type { Grid } from "../simulation/Grid";
import type { ExitId, RoutingMode } from "../config/simulationConfig";
import type { RenderOptions } from "../rendering/Renderer";
import type { PerformanceStats } from "./PerformanceStats";
import { MAPS, type MapId } from "../maps/maps";

export class Controls {
  private values = new Map<string, HTMLElement>();
  private previousGrid: Grid | null = null;
  private exitSignature = "";
  constructor(private experiment: Experiment, options: RenderOptions) {
    document.querySelector("#controls")!.innerHTML = `
      <label for="map">Building layout</label><select id="map">${Object.entries(MAPS).map(([id, map]) => `<option value="${id}">${map.name}</option>`).join("")}</select>
      <p class="note" id="map-description"></p>
      <label for="routing">Routing strategy</label><select id="routing"><option value="shortest">Shortest Path</option><option value="congestion">Congestion Aware</option></select>
      <form id="population-form"><label for="population">Agent population</label><input id="population" type="number" min="1" step="1" required aria-describedby="population-help"><p class="field-help" id="population-help"></p><button type="submit" class="menu-button">Apply crowd size</button></form>
      <p class="error" id="control-error" role="alert"></p>
      <div class="buttons"><button id="start" class="primary">Start</button><button id="pause">Pause</button><button id="reset">Reset</button></div>
      <p class="field-help">Reset keeps your walls and exits, reopens all exits, and restarts the crowd. Changing size, layout, or strategy also resets the run.</p>
      <div id="exit-controls" aria-label="Exit controls"></div>
      <p id="exit-message" class="field-help" role="status"></p>
      <label class="check"><input type="checkbox" id="paths"> Show paths</label>
      <label class="check"><input type="checkbox" id="hash"> Show spatial hash</label>
      <label class="check"><input type="checkbox" id="density"> Show density values (agents/m²)</label>
      <p class="note">Amber agents have just switched exits. Close or reopen any exit to test rerouting. Keep an escape route from every area.</p>`;
    const s = experiment.simulation;
    this.syncSettings();
    document.querySelector("#routing")!.addEventListener("change", () => this.configure());
    document.querySelector("#map")!.addEventListener("change", () => this.configure());
    document.querySelector("#population-form")!.addEventListener("submit", (event) => {
      event.preventDefault();
      this.configure(Number(document.querySelector<HTMLInputElement>("#population")!.value));
    });
    for (const [id, key] of [["paths", "paths"], ["hash", "spatialHash"], ["density", "densityValues"]] as const)
      document.querySelector(`#${id}`)!.addEventListener("change", (event) => {
        options[key] = (event.target as HTMLInputElement).checked;
      });
    document.querySelector("#start")!.addEventListener("click", () => experiment.resume());
    document.querySelector("#pause")!.addEventListener("click", () => experiment.pause());
    document.querySelector("#reset")!.addEventListener("click", () => experiment.restart());
    document.querySelector("#exit-controls")!.addEventListener("click", (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-exit-id]");
      if (!button) return;
      const id = button.dataset.exitId as ExitId;
      const result = s.setExitBlocked(id, !s.grid.blockedExits.has(id));
      const message = document.querySelector<HTMLElement>("#exit-message")!;
      message.textContent = result.message;
      message.classList.toggle("error", !result.ok);
    });
    const fields = [
      ["fps", "FPS · render cadence"], ["frame", "Frame time"],
      ["elapsed", "Elapsed time"], ["remaining", "Agents remaining"],
      ["evacuated", "Agents evacuated"], ["peak", "Peak density · agents/m²"],
      ["average", "Average evacuation"], ["total", "Total evacuation"],
      ["switches", "Exit switches"], ["queue", "Replan queue"],
    ];
    document.querySelector("#metrics")!.innerHTML = fields.map(([id, label]) =>
      `<div class="metric"><span>${label}</span><strong id="metric-${id}">—</strong></div>`).join("");
    for (const [id] of fields) this.values.set(id, document.querySelector<HTMLElement>(`#metric-${id}`)!);
  }
  private syncSettings() {
    const s = this.experiment.simulation;
    document.querySelector<HTMLSelectElement>("#map")!.value = s.mapId;
    document.querySelector<HTMLSelectElement>("#routing")!.value = s.mode;
    document.querySelector<HTMLInputElement>("#population")!.value = String(s.agentCount);
  }
  private configure(count = this.experiment.simulation.agentCount) {
    const message = document.querySelector("#control-error")!;
    try {
      this.experiment.begin(count,
        document.querySelector<HTMLSelectElement>("#routing")!.value as RoutingMode,
        this.experiment.scenario,
        document.querySelector<HTMLSelectElement>("#map")!.value as MapId, false);
      message.textContent = "";
    } catch (error) {
      message.textContent = (error as Error).message;
    }
    this.syncSettings();
  }
  update(performance: PerformanceStats) {
    const s = this.experiment.simulation, m = s.metrics;
    if (this.previousGrid !== s.grid) {
      this.previousGrid = s.grid;
      const limit = s.populationLimit();
      document.querySelector<HTMLInputElement>("#population")!.max = String(limit);
      document.querySelector("#population-help")!.textContent = `Enter 1–${limit} agents. Capacity depends on the layout's available spawn space.`;
      document.querySelector("#exit-message")!.textContent = "";
      document.querySelector("#map-description")!.textContent = s.mapId === "large"
        ? "Agents start across four wings. The original exits face west and south."
        : "Bottleneck experiment with a shared start area.";
    }
    const ids = s.grid.exitIds, signature = ids.join(",");
    if (signature !== this.exitSignature) {
      this.exitSignature = signature;
      document.querySelector("#exit-controls")!.innerHTML = ids.map((id) =>
        `<button id="${id === "A" ? "block" : `block-${id}`}" data-exit-id="${id}" class="block">Block Exit ${id}</button>`).join("");
      document.querySelector("#exit-metrics")!.innerHTML = ids.map((id) =>
        `<div class="metric"><span>Exit ${id} evacuated</span><strong id="metric-exit${id}">0</strong></div><div class="metric"><span>${id} last / final clear</span><strong id="metric-clear${id}">—</strong></div>`).join("");
    }
    const seconds = (value: number | null) => value === null ? "—" : `${value.toFixed(1)} s`;
    for (const id of ids) {
      const button = document.querySelector<HTMLButtonElement>(`[data-exit-id="${id}"]`)!;
      button.textContent = `${s.grid.blockedExits.has(id) ? "Re-open" : "Block"} Exit ${id}`;
      button.setAttribute("aria-pressed", String(s.grid.blockedExits.has(id)));
      const record = m.byExit.get(id)!;
      document.querySelector(`#metric-exit${id}`)!.textContent = String(record.count);
      document.querySelector(`#metric-clear${id}`)!.textContent = seconds(record.last);
    }
    document.querySelector("#status")!.textContent = s.running ? "Running" : m.remainingAgents === 0 ? "Complete" : s.time ? "Paused" : "Ready";
    const entries: Record<string, string> = {
      fps: performance.fps ? performance.fps.toFixed(0) : "—",
      frame: performance.frameTime ? `${performance.frameTime.toFixed(1)} ms` : "—",
      elapsed: seconds(m.simulationElapsedTime), remaining: String(m.remainingAgents),
      evacuated: String(m.evacuatedCount), peak: m.peakDensity.toFixed(2),
      average: m.evacuatedCount ? seconds(m.averageEvacuationTime) : "—",
      total: seconds(m.totalEvacuationTime), switches: String(m.routeSwitchCount),
      queue: String(s.replanQueue.filter((a) => !a.evacuated).length),
    };
    for (const [id, value] of Object.entries(entries)) this.values.get(id)!.textContent = value;
    document.querySelector<HTMLButtonElement>("#start")!.disabled = s.running || m.remainingAgents === 0;
    document.querySelector<HTMLButtonElement>("#pause")!.disabled = !s.running;
    document.querySelector("#performance")!.textContent = `${performance.fps.toFixed(0)} FPS / ${performance.frameTime.toFixed(1)} ms / ${m.remainingAgents} active`;
    const progress = document.querySelector<HTMLProgressElement>("#evacuation-progress")!;
    progress.max = s.agentCount;
    progress.value = m.evacuatedCount;
    document.querySelector("#progress-label")!.textContent = `${m.evacuatedCount} / ${s.agentCount}`;
    document.querySelector("#scenario-status")!.textContent = this.experiment.scenario === "open"
      ? "Open-exit experiment · Control any exit manually"
      : this.experiment.closureTriggered
        ? this.experiment.closureMessage
          ? `Scheduled closure skipped: ${this.experiment.closureMessage}`
          : `Scheduled closure applied · Exit A is ${s.grid.exitABlocked ? "blocked" : "reopened"}`
        : `Exit A closes in ${Math.max(0, 5 - s.time).toFixed(1)} simulation seconds`;
  }
}
