import { STADIUM, STADIUM_SURFACES, type StadiumLayer } from "../maps/stadium";
import { StadiumRouter } from "../pathfinding/StadiumRouter";
import { StadiumSimulation, STADIUM_STEP, type StadiumRunOptions } from "../simulation/StadiumSimulation";
import { bodyRadius, walkingSpeed, PROFILE_SOURCE, type CrowdProfile, type Gender } from "../simulation/PersonProfile";

/** Presentation only: switching layers never changes the simulation's surface membership. */
export class StadiumCrowd {
  private simulation: StadiumSimulation;
  private layer: StadiumLayer = "overview";
  private accumulator = 0;
  private paintElapsed = 0;
  private active = false;
  private settingsKey = "";
  private circles: SVGCircleElement[] = [];
  private population: HTMLInputElement;
  private origin: HTMLSelectElement;
  private speed: HTMLSelectElement;
  private profileMode: HTMLSelectElement;
  private personPicker: HTMLSelectElement;

  constructor(private root: HTMLElement, private svg: SVGSVGElement, private router: StadiumRouter) {
    this.simulation = new StadiumSimulation(router);
    root.querySelector("#stadium-crowd-controls")!.innerHTML = `
      <form id="stadium-run-form" class="stadium-run-form">
        <div><label for="stadium-population">Spectators</label><input id="stadium-population" type="number" min="1" max="1000" step="1" value="100" required aria-describedby="stadium-population-help"></div>
        <div><label for="stadium-origin">Starting seats</label><select id="stadium-origin"><option value="all">All seating levels</option><option value="lower-bowl">Lower bowl</option><option value="upper-east">East upper deck</option><option value="upper-west">West upper deck</option><option value="mixed">Sections 101 + 217</option></select></div>
        <div><label for="stadium-speed">Playback speed</label><select id="stadium-speed"><option value="1">1×</option><option value="4">4×</option><option value="8">8×</option></select></div>
        <div class="stadium-profile-choice"><label for="stadium-profile-mode">Crowd behavior</label><select id="stadium-profile-mode"><option value="mixed">Individual profiles · synthetic adult mix</option><option value="uniform">Uniform comparison · 1.2 m/s</option></select></div>
        <div class="stadium-run-actions"><button type="submit" id="stadium-run-start" class="primary">Start stadium run</button><button type="button" id="stadium-run-pause" disabled>Pause</button><button type="button" id="stadium-run-reset">Reset crowd</button></div>
      </form><p id="stadium-population-help" class="field-help"></p><p id="stadium-run-error" class="error" role="alert"></p>
      <div class="stadium-run-progress"><strong id="stadium-run-status" role="status">Ready</strong><span>Simulation time <output id="stadium-run-time">0.0 s</output></span><label for="stadium-run-progress">Outside <output id="stadium-run-count">0 / 100</output></label><progress id="stadium-run-progress" max="100" value="0"></progress></div>`;
    root.querySelector("#stadium-crowd-stats")!.innerHTML = `
      <h3>Live stadium counts</h3><p class="field-help">Counts include every level, even when hidden. In-transit people belong to a connector until they reach its landing.</p>
      <div id="stadium-level-counts" class="stadium-counts"></div>
      <p id="stadium-speed-summary" class="field-help"></p>
      <div class="stadium-run-totals"><span>Waiting <strong id="stadium-waiting">0</strong></span><span>Without a route <strong id="stadium-stranded">0</strong></span><span>Mean exit time <strong id="stadium-mean-time">—</strong></span></div>
      <details><summary>Transfer occupancy & gate use</summary><p class="field-help">Entry waiting counts the person at each transfer entrance; longer upstream queues are included in total waiting. Transfer travel times are minimums: slower walkers and a busy landing can delay arrival.</p><div id="stadium-transfer-counts"></div><div id="stadium-gate-counts" class="stadium-counts"></div></details>
      <details class="stadium-profile-panel"><summary>Inspect & edit an individual</summary>
        <label for="stadium-person-picker">Spectator</label><select id="stadium-person-picker"></select>
        <p id="stadium-person-status" class="field-help"></p>
        <form id="stadium-person-form"><fieldset id="stadium-person-fields" class="stadium-person-fields">
          <div><label for="person-age">Age (years)</label><input id="person-age" type="number" min="18" max="85" step="1" required></div>
          <div><label for="person-gender">Gender label</label><select id="person-gender"><option value="woman">Woman</option><option value="man">Man</option><option value="unspecified">Unspecified</option></select></div>
          <div><label for="person-height">Height (cm)</label><input id="person-height" type="number" min="130" max="210" step="1" required></div>
          <div><label for="person-weight">Weight (kg)</label><input id="person-weight" type="number" min="40" max="180" step="1" required></div>
          <div><label for="person-response">Response delay (s)</label><input id="person-response" type="number" min="0" max="60" step="0.1" required></div>
          <div><label for="person-pace">Individual pace factor</label><input id="person-pace" type="number" min="0.6" max="1.4" step="any" required></div>
          <div><label for="person-speed">Speed override (m/s, optional)</label><input id="person-speed" type="number" min="0.45" max="1.8" step="any" placeholder="Use profile estimate"></div>
          <button type="submit">Apply person profile</button>
        </fieldset></form><p id="stadium-person-message" role="status" class="field-help"></p>
        <p class="field-help">Edit before starting; reset the crowd to edit again. Changes apply to this run. Preferred speed is a target: queues can slow someone down.</p>
      </details><details class="stadium-profile-panel"><summary>Profile assumptions & evidence</summary>
        <p class="field-help">Synthetic adult population, ages 18–85. Age mix: 30% ages 18–29, 30% ages 30–44, 25% ages 45–64, 15% ages 65–85. Height, body mass, personal pace and response delays vary with a fixed seed. These are scenario assumptions, not Rutgers attendance data.</p>
        <p class="field-help">Age, height and mass adjust an assumed walking-speed estimate. Gender labels are descriptive and do not change speed. The formula and circular body sizes are illustrative, not validated individual predictions. A speed override supports controlled comparisons.</p>
        <p class="field-help"><a href="${PROFILE_SOURCE}" target="_blank" rel="noopener noreferrer">Walking-speed research: Bohannon (1997)</a> provides context for variation; it does not supply this simulator's coefficients or evacuation delays.</p></details>`;
    this.population = root.querySelector("#stadium-population")!;
    this.origin = root.querySelector("#stadium-origin")!;
    this.speed = root.querySelector("#stadium-speed")!;
    this.profileMode = root.querySelector("#stadium-profile-mode")!;
    this.personPicker = root.querySelector("#stadium-person-picker")!;
    this.personPicker.addEventListener("change", () => { this.showProfile(); this.render(); });
    svg.addEventListener("click", event => {
      const circle = (event.target as Element).closest<SVGCircleElement>("[data-person]");
      if (!circle) return;
      this.personPicker.value = circle.dataset.person!;
      root.querySelector<HTMLDetailsElement>(".stadium-profile-panel")!.open = true;
      this.showProfile(); this.render();
    });
    root.querySelector("#stadium-person-form")!.addEventListener("submit", event => {
      event.preventDefault();
      const number = (id: string) => Number(root.querySelector<HTMLInputElement>(`#${id}`)!.value);
      try {
        const speedText = root.querySelector<HTMLInputElement>("#person-speed")!.value;
        this.simulation.setProfile(Number(this.personPicker.value), {
          age: number("person-age"), gender: root.querySelector<HTMLSelectElement>("#person-gender")!.value as Gender,
          heightCm: number("person-height"), weightKg: number("person-weight"), reactionSeconds: number("person-response"),
          paceFactor: number("person-pace"), speedOverride: speedText.trim() ? Number(speedText) : null,
        });
        root.querySelector("#stadium-person-message")!.textContent = "Profile applied to this run.";
        this.render();
      } catch (error) { root.querySelector("#stadium-person-message")!.textContent = (error as Error).message; }
    });
    this.settingsKey = JSON.stringify(this.readOptions());
    for (const field of [this.origin, this.population, this.profileMode]) field.addEventListener("change", () => {
      this.updateLimit(); this.tryAction(() => this.reset(this.readOptions()));
    });
    root.querySelector("#stadium-run-form")!.addEventListener("submit", event => {
      event.preventDefault();
      this.tryAction(() => {
        const options = this.readOptions();
        if (JSON.stringify(options) !== this.settingsKey || this.simulation.complete) this.reset(options);
        this.accumulator = 0; this.simulation.start(); this.render();
      });
    });
    root.querySelector("#stadium-run-pause")!.addEventListener("click", () => this.pause());
    root.querySelector("#stadium-run-reset")!.addEventListener("click", () => this.tryAction(() => this.reset(this.readOptions())));
    this.speed.addEventListener("change", () => { this.accumulator = 0; });
    // Pause synchronously on navigation, including rapid back/forward visits between animation frames.
    root.querySelector("[data-menu]")!.addEventListener("click", () => this.pause());
    this.makeCircles(); this.updateLimit(); this.render();
  }

  private readOptions(): StadiumRunOptions {
    const origin = this.origin.value;
    const sections = origin === "all" ? STADIUM.sections.map(s => s.id)
      : origin === "mixed" ? ["section-101", "section-217"]
      : STADIUM.sections.filter(s => s.surfaceId === origin).map(s => s.id);
    return { count: Number(this.population.value), sections, seed: 549, profileMode: this.profileMode.value as CrowdProfile };
  }
  private updateLimit() {
    const limit = this.simulation.capacity(this.readOptions().sections);
    this.population.max = String(limit);
    this.root.querySelector("#stadium-population-help")!.textContent = `1–${limit} spectators · equal allocation across selected sections · seed 549. Individual profiles vary speed, response delay and body size. Route inspection below does not change crowd destinations.`;
  }
  private tryAction(action: () => void) {
    try { action(); this.root.querySelector("#stadium-run-error")!.textContent = ""; }
    catch (error) { this.root.querySelector("#stadium-run-error")!.textContent = (error as Error).message; }
  }
  private reset(options: StadiumRunOptions) {
    this.simulation.reset(options); this.settingsKey = JSON.stringify(options); this.accumulator = 0;
    this.makeCircles(); this.render();
  }
  private makeCircles() {
    this.circles = this.simulation.spectators.map(p => {
      const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      circle.dataset.person = String(p.id);
      const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
      title.textContent = `Spectator ${p.id + 1} · ${p.sectionId.replace("section-", "Section ")}`;
      circle.append(title);
      return circle;
    });
    this.svg.querySelector("#stadium-crowd-agents")!.replaceChildren(...this.circles);
    this.personPicker.innerHTML = this.simulation.spectators.map(p => `<option value="${p.id}">Spectator ${p.id + 1} · ${p.sectionId.replace("section-", "Section ")}</option>`).join("");
    this.showProfile();
  }
  private showProfile() {
    const p = this.simulation.spectators[Number(this.personPicker.value)].profile;
    for (const [id, value] of Object.entries({ "person-age": p.age, "person-gender": p.gender, "person-height": p.heightCm,
      "person-weight": p.weightKg, "person-response": p.reactionSeconds, "person-pace": p.paceFactor.toFixed(3), "person-speed": p.speedOverride ?? "" }))
      this.root.querySelector<HTMLInputElement | HTMLSelectElement>(`#${id}`)!.value = String(value);
    this.root.querySelector("#stadium-person-message")!.textContent = "";
  }
  pause() { this.simulation.pause(); this.accumulator = 0; this.render(); }
  networkChanged() { this.simulation.refreshRoutes(); this.render(); }
  setLayer(layer: StadiumLayer) { this.layer = layer; this.render(); }

  update(delta: number, active: boolean) {
    if (!active) {
      if (this.simulation.running) this.pause();
      this.active = false; this.accumulator = 0; return;
    }
    if (!this.active) { this.active = true; return; }
    if (!this.simulation.running) return;
    this.accumulator += Math.min(Math.max(0, delta), 0.1) * Number(this.speed.value);
    while (this.accumulator + 1e-9 >= STADIUM_STEP && this.simulation.running) {
      this.simulation.update(STADIUM_STEP); this.accumulator -= STADIUM_STEP;
    }
    this.paintElapsed += delta;
    if (this.paintElapsed >= 1 / 20 || !this.simulation.running) { this.render(); this.paintElapsed = 0; }
  }

  private render() {
    const s = this.simulation, m = s.snapshot();
    for (const p of s.spectators) {
      const circle = this.circles[p.id], surface = s.surfaceOf(p), state = p.state;
      const layers = state.kind === "transfer" ? [state.step.from, state.step.to].map(id =>
        STADIUM_SURFACES.find(level => level.id === this.router.nodes.get(id)!.surfaceId)!.layer)
        : [STADIUM_SURFACES.find(level => level.id === surface)?.layer];
      circle.toggleAttribute("hidden", state.kind === "evacuated" || (this.layer !== "overview" && !layers.includes(this.layer)));
      const point = s.position(p);
      circle.setAttribute("cx", point.x.toFixed(2)); circle.setAttribute("cy", point.y.toFixed(2));
      circle.setAttribute("r", String(bodyRadius(p.profile) / 0.2));
      circle.dataset.selected = String(p.id === Number(this.personPicker.value));
      circle.dataset.state = p.stranded ? "stranded" : state.kind === "transfer" ? "transfer" : p.waiting ? "waiting" : "moving";
      circle.dataset.surface = surface ?? "in-transit";
    }
    this.population.disabled = this.origin.disabled = this.profileMode.disabled = s.running;
    this.root.querySelector<HTMLFieldSetElement>("#stadium-person-fields")!.disabled = s.running || s.time > 0;
    const person = s.spectators[Number(this.personPicker.value)];
    this.root.querySelector("#stadium-person-status")!.textContent = `Spectator ${person.id + 1} · ${person.stranded ? "without a route" : person.state.kind} · preferred ${walkingSpeed(person.profile).toFixed(2)} m/s · body diameter ${(bodyRadius(person.profile) * 2).toFixed(2)} m · response ${person.profile.reactionSeconds.toFixed(1)} s`;
    this.root.querySelector("#stadium-speed-summary")!.textContent = `Preferred walking speeds: ${m.minSpeed.toFixed(2)}–${m.maxSpeed.toFixed(2)} m/s · mean ${m.meanSpeed.toFixed(2)} m/s. Bodies retain their size at turns and junctions.`;
    this.root.querySelector<HTMLButtonElement>("#stadium-run-start")!.disabled = s.running;
    this.root.querySelector<HTMLButtonElement>("#stadium-run-pause")!.disabled = !s.running;
    this.root.querySelector("#stadium-run-status")!.textContent = s.complete ? "Evacuation complete" : s.blocked ? "Blocked · reopen a route, then start" : s.running ? "Running" : s.time ? "Paused" : "Ready";
    this.root.querySelector("#stadium-run-time")!.textContent = `${m.time.toFixed(1)} s`;
    this.root.querySelector("#stadium-run-count")!.textContent = `${m.evacuated} / ${m.population}`;
    const progress = this.root.querySelector<HTMLProgressElement>("#stadium-run-progress")!;
    progress.max = m.population; progress.value = m.evacuated;
    this.root.querySelector("#stadium-level-counts")!.innerHTML = STADIUM_SURFACES.filter(level => level.id !== "exterior").map(level =>
      `<div><span>${level.name}</span><strong data-surface-count="${level.id}">${m.surfaces[level.id as keyof typeof m.surfaces]}</strong></div>`).join("") +
      `<div><span>In transit</span><strong id="stadium-in-transit">${m.inTransfer}</strong></div><div><span>Outside</span><strong>${m.evacuated}</strong></div>`;
    this.root.querySelector("#stadium-waiting")!.textContent = String(m.waiting);
    this.root.querySelector("#stadium-stranded")!.textContent = String(m.stranded);
    this.root.querySelector("#stadium-mean-time")!.textContent = m.averageEvacuationSeconds === null ? "—" : `${m.averageEvacuationSeconds.toFixed(1)} s`;
    this.root.querySelector("#stadium-transfer-counts")!.innerHTML = Object.entries(m.transfers).filter(([, counts]) => counts.traveling || counts.waiting).map(([id, counts]) =>
      `<p>${this.router.edges.get(id)!.name}: ${counts.waiting} at entry · ${counts.traveling} in transit</p>`).join("") || "<p>No occupied transfers.</p>";
    this.root.querySelector("#stadium-gate-counts")!.innerHTML = STADIUM.gates.map(g => `<div><span>${g.name}</span><strong>${m.exits[g.id]}</strong></div>`).join("");
  }
}
