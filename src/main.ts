import "./styles.css";
import { Experiment } from "./simulation/Experiment";
import { Renderer } from "./rendering/Renderer";
import { Controls } from "./ui/Controls";
import { PerformanceStats } from "./ui/PerformanceStats";
import { CONFIG } from "./config/simulationConfig";
import { Screens } from "./ui/Screens";
import { MAPS } from "./maps/maps";
document.querySelector<HTMLDivElement>("#app")!.innerHTML =
  `<header><span class="eyebrow">CS 549 / ASSIGNMENT 04 · ALPHA</span><h1>Evacuation Lab<span>Adaptive crowd simulation</span></h1><p>Explore how route choice changes when a crowd meets a bottleneck.</p></header>
  <section id="menu-screen" class="screen-card" aria-labelledby="menu-heading">
    <div class="intro"><span class="eyebrow">01 / SET UP AN EXPERIMENT</span><h2 id="menu-heading" tabindex="-1">Two exits. One changing crowd.</h2>
    <p>Compare the narrow bottleneck at Exit A with the wider approach to Exit B. Watch how the building layout and congestion change the agents’ choices.</p>
    <ol class="instructions"><li><strong>Choose your experiment.</strong> Pick a crowd size, routing strategy, and exit scenario.</li><li><strong>Observe and intervene.</strong> Pause, inspect paths, or close and reopen Exit A while the crowd moves.</li><li><strong>Review the outcome.</strong> Compare evacuation time, exit use, and congestion, then run another experiment.</li></ol>
    <p class="note">Every new run uses the same starting seed. Repeat the same inputs to reproduce an experiment.</p></div>
    <form id="setup-form"><h3>Experiment setup</h3>
    <label for="setup-map">Building layout</label><select id="setup-map">${Object.entries(MAPS).map(([id, map]) => `<option value="${id}">${map.name}</option>`).join("")}</select>
    <label for="setup-population">Agent population</label><select id="setup-population"><option value="100">100 agents</option><option value="200">200 agents</option><option value="500">500 agents</option></select>
    <label for="setup-routing">Routing strategy</label><select id="setup-routing" aria-describedby="routing-help"><option value="congestion">Congestion Aware</option><option value="shortest">Shortest Path</option></select><p id="routing-help" class="field-help">Shortest Path minimizes distance. Congestion Aware also considers nearby crowd density.</p>
    <label for="setup-scenario">Exit scenario</label><select id="setup-scenario" aria-describedby="scenario-help"><option value="open">Both exits open</option><option value="closure">Close Exit A at 5 seconds</option></select><p id="scenario-help" class="field-help">The closure uses simulation time, so pausing also pauses the countdown. You can still control Exit A manually.</p>
    <button type="submit" class="primary launch">Start experiment</button></form>
  </section>
  <main id="simulation-screen" hidden><section class="stage" aria-labelledby="simulation-heading"><div class="stage-bar"><strong id="simulation-heading" tabindex="-1">02 / Building overview</strong><span id="status" role="status">Ready</span><span id="performance"></span></div>
  <div class="run-progress"><span id="scenario-status"></span><label for="evacuation-progress">Evacuated <span id="progress-label">0 / 100</span></label><progress id="evacuation-progress" max="100" value="0"></progress></div>
  <canvas id="world" width="1000" height="600" aria-label="Crowd evacuation simulation. Agent counts and evacuation progress are available in Live measurements."></canvas><div class="legend"><span>● Active agent</span><span>● Rerouting</span><span class="gradient"></span> Low → High congestion</div></section><aside><h2>Experiment controls</h2><div id="controls"></div><button type="button" data-menu class="menu-button">Back to setup</button><p class="field-help">Return to setup to start a new experiment.</p><h2>Live measurements</h2><div id="metrics"></div></aside></main>
  <section id="results-screen" class="screen-card results" hidden aria-labelledby="results-heading"><span class="eyebrow">03 / RESULTS</span><h2 id="results-heading" tabindex="-1">Evacuation complete</h2><p id="result-context"></p>
  <div class="result-grid">${[["evacuated", "Agents evacuated"], ["total", "Total evacuation time"], ["average", "Average evacuation time"], ["peak", "Peak density"], ["exitA", "Used Exit A"], ["exitB", "Used Exit B"], ["clearA", "Exit A final clear"], ["clearB", "Exit B final clear"], ["switches", "Exit switches"]].map(([id, label]) => `<div class="metric"><span>${label}</span><strong id="result-${id}">—</strong></div>`).join("")}</div>
  <p>Run again with the same settings, or return to setup to compare a different strategy. Manual exit changes must be repeated at the same simulation times for an identical result.</p><div class="result-actions"><button id="run-again" class="primary">Run again</button><button data-menu>New experiment</button></div></section>
  <footer>Reproducible experiments · Seed 549 <span>Assignment 4 alpha · Educational simulation</span></footer>`;
const canvas = document.querySelector<HTMLCanvasElement>("#world")!;
const ctx = canvas.getContext("2d")!;
const experiment = new Experiment();
const simulation = experiment.simulation;
const renderer = new Renderer(ctx);
const controls = new Controls(experiment, renderer.options);
const screens = new Screens(experiment);
const stats = new PerformanceStats();
let revision = experiment.revision;
let last: number | null = null,
  accumulator = 0,
  uiElapsed = 0;
function frame(now: number) {
  // Starts, resets, and resumes discard time from the previous application state.
  if (revision !== experiment.revision) {
    revision = experiment.revision;
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
  renderer.render(
    simulation.grid,
    simulation.agents,
    simulation.density.revision,
    simulation.time,
    MAPS[simulation.mapId].labels,
  );
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
    accumulator = 0;
  }
  last = null;
});
requestAnimationFrame(frame);
