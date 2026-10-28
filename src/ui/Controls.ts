import { Experiment } from "../simulation/Experiment";
import type { RenderOptions } from "../rendering/Renderer";
import type { PerformanceStats } from "./PerformanceStats";
import { MAPS, type MapId } from "../maps/maps";
export class Controls {
  private values = new Map<string, HTMLElement>();
  constructor(
    private experiment: Experiment,
    options: RenderOptions,
  ) {
    const simulation = experiment.simulation;
    document.querySelector("#controls")!.innerHTML =
      `<label for="routing">Routing strategy</label><select id="routing"><option value="shortest">Shortest Path</option><option value="congestion" selected>Congestion Aware</option></select><div class="buttons"><button id="start" class="primary">Start</button><button id="pause">Pause</button><button id="reset">Reset</button></div><button id="block" class="block">Block Exit A</button><p class="note">Close Exit A during the run to test dynamic rerouting. Changing strategy resets the experiment to the same seed.</p>`;
    document.querySelector("#routing")!.addEventListener("change", (e) => {
      simulation.mode = (e.target as HTMLSelectElement).value as
        "shortest" | "congestion";
      experiment.restart();
    });
    const mapControl = document.createElement("div");
    mapControl.innerHTML = `<label for="map">Building layout</label><select id="map">${Object.entries(
      MAPS,
    )
      .map(([id, map]) => `<option value="${id}">${map.name}</option>`)
      .join("")}</select><p class="note" id="map-description"></p>`;
    document.querySelector("#controls")!.prepend(mapControl);
    const mapSelect = document.querySelector<HTMLSelectElement>("#map")!;
    mapSelect.value = simulation.mapId;
    mapSelect.addEventListener("change", () => {
      simulation.mapId = mapSelect.value as MapId;
      experiment.restart();
    });
    const population = document.createElement("div");
    population.innerHTML = `<label for="population">Agent population</label><select id="population"><option value="100">100 agents · Default</option><option value="200">200 agents · Target ≥30 FPS</option><option value="500">500 agents · Target ≥20 FPS</option></select>`;
    document.querySelector("#routing")!.after(population);
    document.querySelector("#population")!.addEventListener("change", (e) => {
      simulation.agentCount = Number((e.target as HTMLSelectElement).value);
      experiment.restart();
    });
    const debug = document.createElement("div");
    debug.innerHTML = `<label class="check"><input type="checkbox" id="paths"> Show paths</label><label class="check"><input type="checkbox" id="hash"> Show spatial hash</label><label class="check"><input type="checkbox" id="density"> Show density values (agents/m²)</label><p class="note">Amber agents have just switched exits. Exit A has a narrow bottleneck; B has a wider approach.</p>`;
    document.querySelector("#controls")!.append(debug);
    for (const [id, key] of [
      ["paths", "paths"],
      ["hash", "spatialHash"],
      ["density", "densityValues"],
    ] as const)
      document
        .querySelector(`#${id}`)!
        .addEventListener(
          "change",
          (e) => (options[key] = (e.target as HTMLInputElement).checked),
        );
    document.querySelector("#start")!.addEventListener("click", () => {
      experiment.resume();
    });
    document
      .querySelector("#pause")!
      .addEventListener("click", () => experiment.pause());
    document
      .querySelector("#reset")!
      .addEventListener("click", () => experiment.restart());
    document
      .querySelector("#block")!
      .addEventListener("click", () =>
        simulation.setExitABlocked(!simulation.grid.exitABlocked),
      );
    const fields = [
      ["fps", "FPS · render cadence"],
      ["frame", "Frame time"],
      ["elapsed", "Elapsed time"],
      ["remaining", "Agents remaining"],
      ["evacuated", "Agents evacuated"],
      ["peak", "Peak density · agents/m²"],
      ["exitA", "Exit A evacuated"],
      ["exitB", "Exit B evacuated"],
      ["clearA", "A last / final clear"],
      ["clearB", "B last / final clear"],
      ["average", "Average evacuation"],
      ["total", "Total evacuation"],
      ["switches", "Exit switches"],
      ["queue", "Replan queue"],
    ];
    document.querySelector("#metrics")!.innerHTML = fields
      .map(
        ([id, label]) =>
          `<div class="metric"><span>${label}</span><strong id="metric-${id}">—</strong></div>`,
      )
      .join("");
    for (const [id] of fields)
      this.values.set(
        id,
        document.querySelector<HTMLElement>(`#metric-${id}`)!,
      );
  }
  update(performance: PerformanceStats) {
    const s = this.experiment.simulation,
      m = s.metrics;
    document.querySelector("#map-description")!.textContent =
      s.mapId === "large"
        ? "Agents start across four wings. Exit A faces west; Exit B faces south. Changing layout resets the run."
        : "Original bottleneck experiment with a shared start area. Changing layout resets the run.";
    document.querySelector("#block")!.textContent = s.grid.exitABlocked
      ? "Re-open Exit A"
      : "Block Exit A";
    document.querySelector("#status")!.textContent = s.running
      ? "Running"
      : s.agents.every((a) => a.evacuated)
        ? "Complete"
        : s.time
          ? "Paused"
          : "Ready";
    const seconds = (value: number | null) =>
      value === null ? "—" : `${value.toFixed(1)} s`;
    const entries: Record<string, string> = {
      fps: performance.fps ? performance.fps.toFixed(0) : "—",
      frame: performance.frameTime
        ? `${performance.frameTime.toFixed(1)} ms`
        : "—",
      elapsed: seconds(m.simulationElapsedTime),
      remaining: String(m.remainingAgents),
      evacuated: String(m.evacuatedCount),
      peak: m.peakDensity.toFixed(2),
      exitA: String(m.exitAEvacuatedCount),
      exitB: String(m.exitBEvacuatedCount),
      clearA: seconds(m.lastEvacuationA),
      clearB: seconds(m.lastEvacuationB),
      average: m.evacuatedCount ? seconds(m.averageEvacuationTime) : "—",
      total: seconds(m.totalEvacuationTime),
      switches: String(m.routeSwitchCount),
      queue: String(s.replanQueue.filter((a) => !a.evacuated).length),
    };
    for (const [id, value] of Object.entries(entries))
      this.values.get(id)!.textContent = value;
    (document.querySelector("#start") as HTMLButtonElement).disabled =
      s.running || m.remainingAgents === 0;
    (document.querySelector("#pause") as HTMLButtonElement).disabled =
      !s.running;
    document.querySelector("#performance")!.textContent =
      `${performance.fps.toFixed(0)} FPS / ${performance.frameTime.toFixed(1)} ms / ${m.remainingAgents} active`;
    const progress = document.querySelector<HTMLProgressElement>("#evacuation-progress")!;
    progress.max = s.agentCount;
    progress.value = m.evacuatedCount;
    document.querySelector("#progress-label")!.textContent = `${m.evacuatedCount} / ${s.agentCount}`;
    document.querySelector("#scenario-status")!.textContent = this.experiment.scenario === "open"
      ? "Open-exit experiment · Exit A can be changed manually"
      : this.experiment.closureTriggered
        ? `Scheduled closure applied · Exit A is ${s.grid.exitABlocked ? "blocked" : "reopened"}`
        : `Exit A closes in ${Math.max(0, 5 - s.time).toFixed(1)} simulation seconds`;
  }
}
