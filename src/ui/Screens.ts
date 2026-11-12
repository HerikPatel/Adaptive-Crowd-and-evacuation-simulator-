import type { RoutingMode } from "../config/simulationConfig";
import { Experiment, type Scenario, type Screen } from "../simulation/Experiment";
import { MAPS, type MapChoiceId } from "../maps/maps";

export class Screens {
  private previous: Screen | null = null;
  private preserveSetupOnReturn = false;
  constructor(private experiment: Experiment) {
    document.querySelector("#setup-form")!.addEventListener("submit", (event) => {
      event.preventDefault();
      const mapId = document.querySelector<HTMLSelectElement>("#setup-map")!.value as MapChoiceId;
      if (mapId === "stadium") {
        experiment.showStadium();
        this.update();
        return;
      }
      const count = Number(document.querySelector<HTMLInputElement>("#setup-population")!.value);
      const mode = document.querySelector<HTMLSelectElement>("#setup-routing")!.value as RoutingMode;
      const scenario = document.querySelector<HTMLSelectElement>("#setup-scenario")!.value as Scenario;
      try {
        experiment.begin(count, mode, scenario, mapId, (event as SubmitEvent).submitter?.id !== "edit-before-start");
        document.querySelector("#setup-error")!.textContent = "";
        this.update();
      } catch (error) {
        document.querySelector("#setup-error")!.textContent = (error as Error).message;
      }
    });
    document.querySelector("#setup-map")!.addEventListener("change", () => {
      document.querySelector("#setup-error")!.textContent = "";
      this.updateSetup();
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
  private updateSetup() {
    const map = document.querySelector<HTMLSelectElement>("#setup-map")!.value as MapChoiceId;
    const preview = map === "stadium";
    const settings = document.querySelector<HTMLFieldSetElement>("#setup-simulation-settings")!;
    settings.hidden = preview;
    settings.disabled = preview;
    document.querySelector<HTMLElement>("#setup-map-help")!.hidden = !preview;
    document.querySelector<HTMLElement>("#edit-before-start")!.hidden = preview;
    document.querySelector("#setup-launch")!.textContent = preview ? "View map preview" : "Start experiment";
    if (preview) return;
    const limit = this.experiment.simulation.populationLimit(map);
    document.querySelector<HTMLInputElement>("#setup-population")!.max = String(limit);
    document.querySelector("#setup-population-help")!.textContent = `Choose any whole number from 1 to ${limit}. Edited walls and exits can reduce spawn capacity.`;
  }
  update() {
    const e = this.experiment, s = e.simulation;
    if (this.previous === e.screen) return;
    const previous = this.previous;
    this.previous = e.screen;
    if (e.screen === "stadium") this.preserveSetupOnReturn = previous === "menu";
    for (const screen of ["menu", "simulation", "results", "stadium"] as const)
      document.querySelector<HTMLElement>(`#${screen}-screen`)!.hidden = screen !== e.screen;
    if (e.screen === "menu") {
      // A map-study visit must preserve settings the user has not submitted yet.
      if (previous !== "stadium" || !this.preserveSetupOnReturn) {
        document.querySelector<HTMLSelectElement>("#setup-map")!.value = s.mapId;
        document.querySelector<HTMLInputElement>("#setup-population")!.value = String(s.agentCount);
        document.querySelector<HTMLSelectElement>("#setup-routing")!.value = s.mode;
        document.querySelector<HTMLSelectElement>("#setup-scenario")!.value = e.scenario;
      }
      this.updateSetup();
    } else if (e.screen === "simulation") {
      document.querySelector<HTMLSelectElement>("#map")!.value = s.mapId;
      document.querySelector<HTMLInputElement>("#population")!.value = String(s.agentCount);
      document.querySelector<HTMLSelectElement>("#routing")!.value = s.mode;
    } else if (e.screen === "results") {
      const m = s.metrics;
      const seconds = (value: number | null) => value === null ? "Unused" : `${value.toFixed(2)} s`;
      const scenario = e.scenario === "closure"
        ? e.closureMessage ? `Scheduled closure skipped: ${e.closureMessage}` : e.closureTriggered ? "Exit A closed at 5 s" : "Finished before scheduled closure"
        : "All exits initially open";
      document.querySelector("#result-context")!.textContent =
        `${MAPS[s.mapId].name}${s.hasCustomLayout ? " (edited)" : ""} · ${s.agentCount} agents · ${s.grid.exitIds.length} exits · ${s.mode === "congestion" ? "Congestion Aware" : "Shortest Path"} · ${scenario}`;
      const results: Record<string, string> = {
        evacuated: `${m.evacuatedCount} / ${s.agentCount}`, total: seconds(m.totalEvacuationTime),
        average: seconds(m.averageEvacuationTime), peak: `${m.peakDensity.toFixed(2)} agents/m²`,
        switches: String(m.routeSwitchCount),
      };
      for (const [key, value] of Object.entries(results)) document.querySelector(`#result-${key}`)!.textContent = value;
      document.querySelector("#result-exits")!.innerHTML = Array.from(m.byExit, ([id, record]) =>
        `<div class="metric"><span>Used Exit ${id}</span><strong id="result-exit${id}">${record.count}</strong></div><div class="metric"><span>Exit ${id} final clear</span><strong id="result-clear${id}">${seconds(record.clear)}</strong></div>`).join("");
    }
    document.querySelector<HTMLElement>(`#${e.screen}-heading`)!.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }
}
