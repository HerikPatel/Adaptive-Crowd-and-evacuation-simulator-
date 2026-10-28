import type { RoutingMode } from "../config/simulationConfig";
import { Experiment, type Scenario, type Screen } from "../simulation/Experiment";
import { MAPS, type MapId } from "../maps/maps";

export class Screens {
  private previous: Screen | null = null;
  constructor(private experiment: Experiment) {
    document.querySelector("#setup-form")!.addEventListener("submit", (event) => {
      event.preventDefault();
      const count = Number(document.querySelector<HTMLSelectElement>("#setup-population")!.value);
      const mode = document.querySelector<HTMLSelectElement>("#setup-routing")!.value as RoutingMode;
      const scenario = document.querySelector<HTMLSelectElement>("#setup-scenario")!.value as Scenario;
      const mapId = document.querySelector<HTMLSelectElement>("#setup-map")!.value as MapId;
      experiment.begin(count, mode, scenario, mapId);
      this.update();
    });
    document.querySelector("#run-again")!.addEventListener("click", () => {
      experiment.restart(true);
      this.update();
    });
    for (const button of Array.from(document.querySelectorAll("[data-menu]")))
      button.addEventListener("click", () => {
        experiment.showMenu();
        this.update();
      });
  }

  update() {
    const e = this.experiment, s = e.simulation;
    if (this.previous === e.screen) return;
    this.previous = e.screen;
    for (const screen of ["menu", "simulation", "results"] as const)
      document.querySelector<HTMLElement>(`#${screen}-screen`)!.hidden = screen !== e.screen;

    if (e.screen === "menu") {
      document.querySelector<HTMLSelectElement>("#setup-map")!.value = s.mapId;
      document.querySelector<HTMLSelectElement>("#setup-population")!.value = String(s.agentCount);
      document.querySelector<HTMLSelectElement>("#setup-routing")!.value = s.mode;
      document.querySelector<HTMLSelectElement>("#setup-scenario")!.value = e.scenario;
    } else if (e.screen === "simulation") {
      document.querySelector<HTMLSelectElement>("#map")!.value = s.mapId;
      document.querySelector<HTMLSelectElement>("#population")!.value = String(s.agentCount);
      document.querySelector<HTMLSelectElement>("#routing")!.value = s.mode;
    } else {
      const m = s.metrics;
      const seconds = (value: number | null) => value === null ? "Unused" : `${value.toFixed(2)} s`;
      document.querySelector("#result-context")!.textContent =
        `${MAPS[s.mapId].name} · ${s.agentCount} agents · ${s.mode === "congestion" ? "Congestion Aware" : "Shortest Path"} · ${e.scenario === "closure" ? "Exit A closes at 5 s" : "Both exits initially open"}`;
      const results: Record<string, string> = {
        evacuated: `${m.evacuatedCount} / ${s.agentCount}`,
        total: seconds(m.totalEvacuationTime),
        average: seconds(m.averageEvacuationTime),
        peak: `${m.peakDensity.toFixed(2)} agents/m²`,
        exitA: String(m.exitAEvacuatedCount),
        exitB: String(m.exitBEvacuatedCount),
        clearA: seconds(m.timeToClearExitA),
        clearB: seconds(m.timeToClearExitB),
        switches: String(m.routeSwitchCount),
      };
      for (const [key, value] of Object.entries(results))
        document.querySelector(`#result-${key}`)!.textContent = value;
    }
    document.querySelector<HTMLElement>(`#${e.screen}-heading`)!.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }
}
