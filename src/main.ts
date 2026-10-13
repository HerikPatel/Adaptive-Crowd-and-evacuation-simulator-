import "./styles.css";
import { Simulation } from "./simulation/Simulation";
import { Renderer } from "./rendering/Renderer";
import { Controls } from "./ui/Controls";
import { PerformanceStats } from "./ui/PerformanceStats";
import { CONFIG } from "./config/simulationConfig";
document.querySelector<HTMLDivElement>("#app")!.innerHTML =
  `<header><span class="eyebrow">CS 549 / ASSIGNMENT 03</span><h1>Evacuation Lab<span>Adaptive crowd simulation</span></h1><p>A deterministic experiment in movement, congestion, and route choice.</p></header><main><section class="stage"><div class="stage-bar"><strong>01 / Building overview</strong><span id="status">Ready</span></div><canvas id="world" width="1000" height="600" aria-label="Crowd evacuation simulation"></canvas><div class="legend"><span>● Active agent</span><span>● Rerouting</span><span class="gradient"></span> Low → High congestion</div></section><aside><h2>Experiment controls</h2><div id="controls"></div><h2>Live measurements</h2><div id="metrics"></div></aside></main><footer>Fixed timestep · Seed 549 · Canvas 2D <span>Assignment 3 engineering prototype</span></footer>`;
const canvas = document.querySelector<HTMLCanvasElement>("#world")!;
const ctx = canvas.getContext("2d")!;
const simulation = new Simulation();
const renderer = new Renderer(ctx);
const controls = new Controls(simulation, renderer.options);
const stats = new PerformanceStats();
const performanceLabel = document.createElement("span");
performanceLabel.id = "performance";
document.querySelector(".stage-bar")!.append(performanceLabel);
let last: number | null = null,
  accumulator = 0,
  uiElapsed = 0;
function frame(now: number) {
  const frameDelta = last === null ? 0 : (now - last) / 1000;
  last = now;
  const start = performance.now();
  if (simulation.running) {
    accumulator += Math.min(frameDelta, CONFIG.maxFrameDelta);
    while (accumulator + 1e-9 >= CONFIG.fixedDt) {
      simulation.update(CONFIG.fixedDt);
      accumulator -= CONFIG.fixedDt;
    }
  } else accumulator = 0;
  renderer.render(
    simulation.grid,
    simulation.agents,
    simulation.density.revision,
    simulation.time,
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
    simulation.running = false;
    accumulator = 0;
  }
  last = null;
});
requestAnimationFrame(frame);
