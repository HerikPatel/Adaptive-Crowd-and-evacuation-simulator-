import { PATH_ALGORITHMS, type RoutingMode, type MovementMode, type PathAlgorithm } from "../config/simulationConfig";
import { Simulation } from "./Simulation";
import { FireSpread } from "./FireSpread";
import { MAPS, type MapId } from "../maps/maps";

export type Scenario = "open" | "closure" | "fire";
export const SCENARIO_LABELS: Record<Scenario, string> = {
  open: "All exits open",
  closure: "Exit A closes at 5 s",
  fire: "Fire spreads from the middle at 5 s",
};
export type Screen = "menu" | "simulation" | "results" | "stadium";

/** Application lifecycle and timed inputs, separate from the crowd model. */
export class Experiment {
  readonly simulation = new Simulation(100, "large");
  screen: Screen = "menu";
  scenario: Scenario = "open";
  closureTriggered = false;
  closureMessage = "";
  /** Simulation time when Exit A actually closed; later than 5 s if the doorway was busy. */
  closureTime: number | null = null;
  /** The spreading fire in the fire scenario; null otherwise. */
  fire: FireSpread | null = null;
  revision = 0;

  begin(count: number, mode: RoutingMode, scenario: Scenario, mapId: MapId = this.simulation.mapId, running = true, movement: MovementMode = this.simulation.movementMode, algorithm: PathAlgorithm = this.simulation.algorithm) {
    // Validate before changing a running experiment.
    if (mode !== "shortest" && mode !== "congestion" && mode !== "flow-field") throw new Error("Unknown routing strategy");
    if (movement !== "predictive" && movement !== "orca") throw new Error("Unknown local movement mode");
    if (!PATH_ALGORITHMS.includes(algorithm)) throw new Error("Unknown path-planning algorithm");
    if (scenario !== "open" && scenario !== "closure" && scenario !== "fire") throw new Error("Unknown scenario");
    if (!Object.hasOwn(MAPS, mapId)) throw new Error("Unknown building layout");
    this.simulation.validatePopulation(count, mapId);
    this.simulation.agentCount = count;
    this.simulation.mode = mode;
    this.simulation.movementMode = movement;
    this.simulation.algorithm = algorithm;
    this.simulation.mapId = mapId;
    this.scenario = scenario;
    this.restart(running);
  }

  restart(running = false) {
    this.simulation.reset();
    this.closureTriggered = false;
    this.closureMessage = "";
    this.closureTime = null;
    this.fire = this.scenario === "fire" ? new FireSpread(this.simulation.grid) : null;
    this.screen = "simulation";
    this.simulation.running = running;
    this.revision++;
  }

  showMenu() {
    this.simulation.running = false;
    this.screen = "menu";
    this.revision++;
  }

  showStadium() {
    this.simulation.running = false;
    this.screen = "stadium";
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
      // Someone in the doorway only delays the closure: retry every step until it is clear.
      if (!result.retry) {
        this.closureMessage = result.ok ? "" : result.message;
        this.closureTriggered = true;
        if (result.ok) this.closureTime = s.time;
      }
    }
    this.fire?.update(s);
    s.update(dt);
    if (s.metrics.remainingAgents === 0) this.screen = "results";
  }
}
