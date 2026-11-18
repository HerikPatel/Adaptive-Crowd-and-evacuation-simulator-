import "./styles.css";
import { Experiment } from "./simulation/Experiment";
import { Renderer } from "./rendering/Renderer";
import { Controls } from "./ui/Controls";
import { PerformanceStats } from "./ui/PerformanceStats";
import { CONFIG, PATH_ALGORITHMS, ALGORITHM_LABELS, ALGORITHM_HELP, SLOW_SHARES } from "./config/simulationConfig";
import { Screens } from "./ui/Screens";
import { MAPS, MAP_CHOICES } from "./maps/maps";
import { Editor } from "./ui/Editor";
import { StadiumViewer } from "./ui/StadiumViewer";
import type { Renderer3D } from "./rendering/Renderer3D";
import { BuildingComparisonPanel } from "./ui/BuildingComparisonPanel";
document.querySelector<HTMLDivElement>("#app")!.innerHTML =
  `<header><span class="eyebrow">CS 549 · GROUP 5 · CROWD EVACUATION SIMULATOR</span><h1>Evacuation Lab<span>Adaptive crowd simulation</span></h1><p>Explore how route choice changes when a crowd meets a bottleneck.</p></header>
  <section id="menu-screen" class="screen-card" aria-labelledby="menu-heading">
    <div class="intro"><span class="eyebrow">01 / SET UP AN EXPERIMENT</span><h2 id="menu-heading" tabindex="-1">Get everyone out as fast as you can.</h2>
    <p class="goal"><strong>Your goal:</strong> evacuate the whole building in the shortest time. Pick a building and how people choose their routes, start the run, and see how long it takes. Then change one thing and try to beat your time.</p>
    <ol class="instructions"><li><strong>Set up and start.</strong> Choose a building, crowd size, routing strategy and exit scenario, then press Start experiment.</li><li><strong>Watch the evacuation.</strong> Pause, block exits, or switch between the 2D plan and the 3D view. The colours show where crowds build up.</li><li><strong>Change something and compare.</strong> Draw walls, exits or furniture below the map, or use Compare strategies to test several routing options at once.</li></ol>
    <p class="note">Every new run uses the same starting seed. Repeat the same inputs to reproduce an experiment.</p></div>
    <form id="setup-form"><h3>Experiment setup</h3>
    <label for="setup-map">Building layout</label><select id="setup-map" aria-describedby="setup-map-help">${MAP_CHOICES.map(map => `<option value="${map.id}">${map.name}</option>`).join("")}</select>
    <p id="setup-map-help" class="field-help" hidden>Run a schematic SHI Stadium crowd simulation across seating levels, timed transfers and exterior gates. Choose crowd settings inside the stadium map.</p>
    <fieldset id="setup-simulation-settings" aria-label="Simulation settings">
    <label for="setup-population">Agent population</label><input id="setup-population" type="number" min="1" max="1000" step="1" value="100" required aria-describedby="setup-population-help"><p id="setup-population-help" class="field-help"></p>
    <label for="setup-slow">Slower walkers</label><select id="setup-slow" aria-describedby="setup-crowd-help">${SLOW_SHARES.map(v => `<option value="${v}">${v ? `${v * 100}% of the crowd` : "None"}</option>`).join("")}</select>
    <label class="check"><input type="checkbox" id="setup-groups" aria-describedby="setup-crowd-help"> Groups that stay together</label>
    <p id="setup-crowd-help" class="field-help">Slower walkers (for example, people with a mobility impairment) move at about half speed and are drawn in purple. Groups of 2 to 4 friends or family start together, use the same exit and walk at their slowest member's pace.</p>
    <label for="setup-routing">Routing strategy</label><select id="setup-routing" aria-describedby="routing-help"><option value="congestion">Congestion Aware</option><option value="shortest">Shortest Path</option><option value="flow-field">Shared Flow Field</option></select><p id="routing-help" class="field-help">Shortest Path minimizes distance. Congestion Aware considers crowd density. Shared Flow Field shares congestion-aware routes across the crowd.</p>
    <label for="setup-algorithm">Path-planning algorithm</label><select id="setup-algorithm" aria-describedby="setup-algorithm-help">${PATH_ALGORITHMS.map(id => `<option value="${id}">${ALGORITHM_LABELS[id]}</option>`).join("")}</select><p id="setup-algorithm-help" class="field-help">${ALGORITHM_HELP.astar}</p>
    <label for="setup-movement">Local movement</label><select id="setup-movement" aria-describedby="movement-help"><option value="predictive">Predictive steering</option><option value="orca">ORCA</option></select><p id="movement-help" class="field-help">Compare how people avoid one another. ORCA shares avoidance between nearby walkers. Both modes use the same routing and collision checks.</p>
    <label for="setup-scenario">Exit scenario</label><select id="setup-scenario" aria-describedby="scenario-help"><option value="open">All exits open</option><option value="closure">Close Exit A at 5 seconds</option><option value="fire">Fire spreads from the middle at 5 seconds</option></select><p id="scenario-help" class="field-help">Timed events use simulation time, so pausing also pauses the countdown. In the fire scenario, fire blocks the cells it reaches and smoke slows people and pushes them onto other routes. You can control every exit manually.</p>
    </fieldset><p id="setup-error" class="error" role="alert"></p><button type="submit" id="setup-launch" class="primary launch">Start experiment</button><button type="submit" id="edit-before-start" class="launch">Edit layout first</button></form>
  </section>
  <section id="stadium-screen" hidden aria-labelledby="stadium-heading"></section>
  <main id="simulation-screen" hidden><section class="stage" aria-labelledby="simulation-heading"><div class="stage-bar"><strong id="simulation-heading" tabindex="-1">02 / Building overview</strong><span id="status" role="status">Ready</span><span id="performance"></span><div class="view-toggle" role="group" aria-label="View mode"><button type="button" data-view="2d" aria-pressed="true">2D plan</button><button type="button" data-view="3d" aria-pressed="false">3D view</button></div></div>
  <div class="run-progress"><span id="scenario-status"></span><label for="evacuation-progress">Evacuated <span id="progress-label">0 / 100</span></label><progress id="evacuation-progress" max="100" value="0"></progress></div>
  <canvas id="world" width="1000" height="600" tabindex="0" aria-label="Crowd evacuation simulation and layout editor" aria-describedby="editor-help"></canvas><div id="world3d" hidden><div class="view3d-tools"><button type="button" id="view3d-reset">Reset camera</button><button type="button" id="view3d-top">Top-down</button><label class="check"><input type="checkbox" id="view3d-walls"> Full-height walls</label><span>Drag to orbit · Scroll to zoom · Right-drag to pan</span></div><p id="view3d-error" class="error" role="alert"></p></div><div class="legend"><span>● Active agent</span><span>● Rerouting</span><span class="slow-walker">● Slower walker</span><span class="gradient"></span> Low → High congestion</div><div id="editor"></div><div id="building-comparison"></div></section><aside><h2>Experiment controls</h2><div id="controls"></div><button type="button" data-menu class="menu-button">Back to setup</button><p class="field-help">Edited layouts stay available during this visit. Reloading the page restores the presets.</p><h2>Live measurements</h2><div id="metrics"></div><div id="exit-metrics"></div></aside></main>
  <section id="results-screen" class="screen-card results" hidden aria-labelledby="results-heading"><span class="eyebrow">03 / RESULTS</span><h2 id="results-heading" tabindex="-1">Evacuation complete</h2><p id="result-context"></p>
  <div class="result-grid">${[["evacuated", "Agents evacuated"], ["total", "Total evacuation time"], ["average", "Average evacuation time"], ["peak", "Peak density"], ["switches", "Exit switches"]].map(([id, label]) => `<div class="metric"><span>${label}</span><strong id="result-${id}">—</strong></div>`).join("")}</div><div id="result-exits" class="result-grid"></div>
  <p>Run again with the same settings, or return to setup to compare a different strategy. Manual exit changes must be repeated at the same simulation times for an identical result.</p><div class="result-actions"><button id="run-again" class="primary">Run again</button><button data-menu>New experiment</button></div></section>
  <footer>Reproducible experiments · Seed 549 <span>Educational simulation · not for real-world safety planning</span></footer>`;
const canvas = document.querySelector<HTMLCanvasElement>("#world")!;
const ctx = canvas.getContext("2d")!;
const experiment = new Experiment();
const simulation = experiment.simulation;
const renderer = new Renderer(ctx);
const controls = new Controls(experiment, renderer.options);
const stadium = new StadiumViewer(document.querySelector<HTMLElement>("#stadium-screen")!);
const screens = new Screens(experiment);
const editor = new Editor(experiment, canvas);
const stats = new PerformanceStats();
// Initialize form defaults before the first paint can accept user input.
screens.update();
controls.update(stats);
editor.update();
// 3D view: loaded on demand so the 2D app stays small. Editing tools use the 2D plan.
const world3d = document.querySelector<HTMLElement>("#world3d")!;
let view: "2d" | "3d" = "2d";
let renderer3d: Renderer3D | null = null;
async function setView(next: "2d" | "3d") {
  if (next === "3d" && !renderer3d) {
    try {
      const { Renderer3D } = await import("./rendering/Renderer3D");
      renderer3d = new Renderer3D(world3d);
    } catch (error) {
      document.querySelector("#view3d-error")!.textContent = `3D view is unavailable in this browser (${(error as Error).message}).`;
      next = "2d";
    }
  }
  view = next;
  canvas.hidden = view === "3d";
  world3d.hidden = view === "2d";
  document.querySelector<HTMLElement>(".legend")!.dataset.view = view;
  for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>("[data-view]")))
    button.setAttribute("aria-pressed", String(button.dataset.view === view));
}
for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>("[data-view]")))
  button.addEventListener("click", () => setView(button.dataset.view as "2d" | "3d"));
document.querySelector("#view3d-reset")!.addEventListener("click", () => renderer3d?.resetView());
document.querySelector("#view3d-top")!.addEventListener("click", () => renderer3d?.topView());
document.querySelector("#view3d-walls")!.addEventListener("change", (event) =>
  renderer3d?.setWallMode((event.target as HTMLInputElement).checked ? "full" : "cutaway"));
document.querySelector("#editor")!.addEventListener("click", (event) => {
  const tool = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-tool]");
  if (tool && tool.dataset.tool !== "inspect" && view === "3d") setView("2d");
});
const comparison = new BuildingComparisonPanel(document.querySelector<HTMLElement>("#building-comparison")!, experiment);
let revision = experiment.revision;
let last: number | null = null,
  accumulator = 0,
  uiElapsed = 0;
function frame(now: number) {
  // Starts, resets, and resumes discard time from the previous application state.
  if (revision !== experiment.revision) {
    revision = experiment.revision;
    comparison.summarize();
    accumulator = 0;
    last = null;
    uiElapsed = 0.1;
  }
  const frameDelta = last === null ? 0 : (now - last) / 1000;
  last = now;
  const start = performance.now();
  if (simulation.running) {
    accumulator += Math.min(frameDelta, CONFIG.maxFrameDelta);
    while (accumulator + 1e-9 >= CONFIG.fixedDt) {
      experiment.update(CONFIG.fixedDt);
      accumulator -= CONFIG.fixedDt;
    }
  } else accumulator = 0;
  screens.update();
  stadium.update(frameDelta, experiment.screen === "stadium");
  editor.update();
  if (experiment.screen === "simulation" && view === "3d" && renderer3d)
    renderer3d.render(simulation.grid, simulation.agents, simulation.density.revision, simulation.time, MAPS[simulation.mapId].labels, renderer.options);
  else {
    renderer.render(
      simulation.grid,
      simulation.agents,
      simulation.density.revision,
      simulation.time,
      MAPS[simulation.mapId].labels,
    );
    editor.render(ctx);
  }
  stats.record(frameDelta, performance.now() - start);
  uiElapsed += frameDelta;
  if (uiElapsed >= 0.1 || !simulation.running) {
    controls.update(stats);
    uiElapsed = 0;
  }
  requestAnimationFrame(frame);
}
// Hidden tabs auto-pause so returning never creates a giant catch-up frame.
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    experiment.pause();
    stadium.pause();
    accumulator = 0;
  }
  last = null;
});
requestAnimationFrame(frame);
