import type { RoutingMode } from "../config/simulationConfig";
import { Simulation } from "./Simulation";
import { MAPS, type MapId } from "../maps/maps";

export type Scenario = "open" | "closure";
export type Screen = "menu" | "simulation" | "results";

/** Application lifecycle and timed inputs, separate from the crowd model. */
export class Experiment {
  readonly simulation = new Simulation(100, "large");
  screen: Screen = "menu";
  scenario: Scenario = "open";
  closureTriggered = false;
  closureMessage = "";
  revision = 0;

  begin(count: number, mode: RoutingMode, scenario: Scenario, mapId: MapId = this.simulation.mapId, running = true) {
    // Validate before changing a running experiment.
    if (mode !== "shortest" && mode !== "congestion") throw new Error("Unknown routing strategy");
    if (scenario !== "open" && scenario !== "closure") throw new Error("Unknown scenario");
    if (!Object.hasOwn(MAPS, mapId)) throw new Error("Unknown building layout");
    this.simulation.validatePopulation(count, mapId);
    this.simulation.agentCount = count;
    this.simulation.mode = mode;
    this.simulation.mapId = mapId;
    this.scenario = scenario;
    this.restart(running);
  }

  restart(running = false) {
    this.simulation.reset();
    this.closureTriggered = false;
    this.closureMessage = "";
    this.screen = "simulation";
    this.simulation.running = running;
    this.revision++;
  }

  showMenu() {
    this.simulation.running = false;
    this.screen = "menu";
    this.revision++;
  }

  resume() {
    if (this.screen === "simulation" && this.simulation.metrics.remainingAgents > 0) {
      this.simulation.running = true;
      this.revision++;
    }
  }

  pause() {
    this.simulation.running = false;
    this.revision++;
  }

  update(dt: number) {
    const s = this.simulation;
    if (this.screen !== "simulation" || !s.running) return;
    // Apply before step 301, matching the existing five-second closure scenario.
    if (this.scenario === "closure" && !this.closureTriggered && s.time + 1e-9 >= 5) {
      const result = s.setExitABlocked(true);
      this.closureMessage = result.ok ? "" : result.message;
      this.closureTriggered = true;
    }
    s.update(dt);
    if (s.metrics.remainingAgents === 0) this.screen = "results";
  }
}
