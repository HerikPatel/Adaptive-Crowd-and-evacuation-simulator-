import { Simulation } from "../simulation/Simulation";
import type { RenderOptions } from "../rendering/Renderer";
import type { PerformanceStats } from "./PerformanceStats";
export class Controls {
  private values = new Map<string, HTMLElement>();
  constructor(
    private simulation: Simulation,
    options: RenderOptions,
  ) {
    document.querySelector("#controls")!.innerHTML =
      `<label for="routing">Routing strategy</label><select id="routing"><option value="shortest">Shortest Path</option><option value="congestion" selected>Congestion Aware</option></select><div class="buttons"><button id="start" class="primary">Start</button><button id="pause">Pause</button><button id="reset">Reset</button></div><button id="block" class="block">Block Exit A</button><p class="note">Close Exit A during the run to test dynamic rerouting. Changing strategy resets the experiment to the same seed.</p>`;
    document.querySelector("#routing")!.addEventListener("change", (e) => {
      simulation.mode = (e.target as HTMLSelectElement).value as
        "shortest" | "congestion";
      simulation.reset();
    });
    const population = document.createElement("div");
    population.innerHTML = `<label for="population">Agent population</label><select id="population"><option value="100">100 agents · Default</option><option value="200">200 agents · Target ≥30 FPS</option><option value="500">500 agents · Target ≥20 FPS</option></select>`;
    document.querySelector("#routing")!.after(population);
    document.querySelector("#population")!.addEventListener("change", (e) => {
      simulation.agentCount = Number((e.target as HTMLSelectElement).value);
      simulation.reset();
    });
    const debug = document.createElement("div");
    debug.innerHTML = `<label class="check"><input type="checkbox" id="paths"> Show paths</label><label class="check"><input type="checkbox" id="hash"> Show spatial hash</label><label class="check"><input type="checkbox" id="density"> Show density values (agents/m²)</label><p class="note">Amber agents have just switched exits. Exit A has the shorter, narrow route; B has a wider approach.</p>`;
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
      if (!simulation.agents.every((a) => a.evacuated))
        simulation.running = true;
    });
    document
      .querySelector("#pause")!
      .addEventListener("click", () => (simulation.running = false));
    document
      .querySelector("#reset")!
      .addEventListener("click", () => simulation.reset());
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
    const s = this.simulation,
      m = s.metrics;
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
  }
}
