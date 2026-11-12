import { STADIUM, STADIUM_SURFACES, surfaceName, type StadiumFeature, type StadiumLayer } from "../maps/stadium";
import { STADIUM_ASSUMPTIONS, type NavigationEdge } from "../maps/stadiumNavigation";
import { StadiumRouter, type StadiumRoute } from "../pathfinding/StadiumRouter";
import { StadiumCrowd } from "./StadiumCrowd";

/** Route inspection and live movement share the same editable network. */
export class StadiumRoutes {
  private router = new StadiumRouter();
  private crowd: StadiumCrowd;
  private layer: StadiumLayer = "overview";
  private from = "section-217";
  private gate = "any";
  private controlId: string | undefined;
  private showNetwork = true;
  private showConnections = true;

  constructor(private root: HTMLElement, private svg: SVGSVGElement, selectFeature: (id: string) => void) {
    root.querySelector("#stadium-route-tools")!.innerHTML = `
      <div><label for="stadium-route-from">Route start section</label><select id="stadium-route-from">
        ${STADIUM_SURFACES.filter(s => s.id.startsWith("upper") || s.id === "lower-bowl").map(s => `<optgroup label="${s.name}">${STADIUM.sections.filter(section => section.surfaceId === s.id).map(section => `<option value="${section.id}">${section.name}</option>`).join("")}</optgroup>`).join("")}
      </select></div><div><label for="stadium-route-gate">Destination gate</label><select id="stadium-route-gate"><option value="any">Any open gate · lowest assumed time</option>
        ${STADIUM.gates.map(g => `<option value="${g.id}">${g.name}</option>`).join("")}</select></div>
      <label class="check"><input id="stadium-walkways" type="checkbox" checked> Show walkable routes</label>`;
    root.querySelector<HTMLSelectElement>("#stadium-route-from")!.value = this.from;
    root.querySelector("#stadium-route-from")!.addEventListener("change", event => {
      this.from = (event.target as HTMLSelectElement).value;
      selectFeature(this.from);
      this.render();
    });
    root.querySelector("#stadium-route-gate")!.addEventListener("change", event => {
      this.gate = (event.target as HTMLSelectElement).value;
      this.render();
    });
    root.querySelector("#stadium-walkways")!.addEventListener("change", event => {
      this.showNetwork = (event.target as HTMLInputElement).checked;
      this.render();
    });
    root.querySelector("#stadium-connection-controls")!.innerHTML = `
      <h3 id="stadium-connection-name"></h3><p class="field-help">Scenario settings · assumed, not measured. Transfers run toward the concourse.</p>
      <button type="button" id="stadium-toggle-connection" class="menu-button" aria-pressed="false"></button>
      <form id="stadium-transfer-form"><label for="stadium-transfer-time">Assumed travel time (seconds)</label><input id="stadium-transfer-time" type="number" min="0.1" max="3600" step="0.1" required>
        <label for="stadium-transfer-capacity">Assumed capacity (people/second)</label><input id="stadium-transfer-capacity" type="number" min="0.1" max="100" step="0.1" required>
        <button type="submit" class="menu-button">Apply connection settings</button><p id="stadium-transfer-message" class="field-help" role="status"></p></form>`;
    root.querySelector("#stadium-toggle-connection")!.addEventListener("click", () => {
      if (!this.controlId) return;
      this.crowd.pause();
      this.router.setClosed(this.controlId, !this.router.isClosed(this.controlId));
      this.crowd.networkChanged();
      this.updateControl(); this.render();
    });
    root.querySelector("#stadium-transfer-form")!.addEventListener("submit", event => {
      event.preventDefault();
      if (!this.controlId) return;
      const message = root.querySelector("#stadium-transfer-message")!;
      try {
        this.crowd.pause();
        this.router.setParameters(this.controlId, {
          travelSeconds: Number(root.querySelector<HTMLInputElement>("#stadium-transfer-time")!.value),
          capacityPerSecond: Number(root.querySelector<HTMLInputElement>("#stadium-transfer-capacity")!.value),
        });
        this.crowd.networkChanged();
        message.textContent = "Scenario settings applied. Run paused; start to continue with updated routes.";
        message.classList.remove("error");
        this.render();
      } catch (error) {
        message.textContent = (error as Error).message;
        message.classList.add("error");
      }
    });
    root.querySelector("#stadium-reset-network")!.addEventListener("click", () => {
      this.crowd.pause(); this.router.reset(); this.crowd.networkChanged(); this.updateControl(); this.render();
    });
    this.crowd = new StadiumCrowd(root, svg, this.router);
    this.updateControl();
    this.render();
  }

  setLayer(layer: StadiumLayer, showConnections: boolean) {
    this.layer = layer;
    this.showConnections = showConnections;
    this.crowd.setLayer(layer);
    this.render();
  }

  update(delta: number, active: boolean) { this.crowd.update(delta, active); }
  pause() { this.crowd.pause(); }

  inspectFeature(feature?: StadiumFeature) {
    if (feature?.kind === "section") {
      this.from = feature.id;
      this.root.querySelector<HTMLSelectElement>("#stadium-route-from")!.value = this.from;
    }
    this.controlId = feature ? this.router.controls.find(e => e.featureId === feature.id)?.id : undefined;
    this.updateControl();
    this.render();
  }

  private updateControl() {
    const panel = this.root.querySelector<HTMLElement>("#stadium-connection-controls")!;
    panel.hidden = !this.controlId;
    if (!this.controlId) return;
    const edge = this.router.edges.get(this.controlId)!;
    this.root.querySelector("#stadium-connection-name")!.textContent = edge.name;
    const button = this.root.querySelector<HTMLButtonElement>("#stadium-toggle-connection")!;
    const closed = this.router.isClosed(this.controlId);
    button.textContent = `${closed ? "Reopen" : "Close"} ${edge.kind === "gate" ? "gate group" : "connection"}`;
    button.setAttribute("aria-pressed", String(closed));
    const parameters = this.router.parameters(this.controlId);
    this.root.querySelector<HTMLElement>("#stadium-transfer-form")!.hidden = !parameters;
    if (parameters) {
      this.root.querySelector<HTMLInputElement>("#stadium-transfer-time")!.value = String(parameters.travelSeconds);
      this.root.querySelector<HTMLInputElement>("#stadium-transfer-capacity")!.value = String(parameters.capacityPerSecond);
    }
    this.root.querySelector("#stadium-transfer-message")!.textContent = "";
  }

  private visible(edge: NavigationEdge): boolean {
    if (this.layer === "overview") return true;
    const layers = [edge.from, edge.to].map(id => STADIUM_SURFACES.find(s => s.id === this.router.nodes.get(id)!.surfaceId)!.layer);
    return layers.includes(this.layer);
  }

  private line(edge: NavigationEdge): string {
    return edge.points.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(" ");
  }

  private itinerary(route: StadiumRoute): string {
    const labels: string[] = [];
    for (const step of route.steps) {
      const edge = this.router.edges.get(step.edgeId)!;
      const surface = surfaceName(this.router.nodes.get(step.from)!.surfaceId);
      const parameters = this.router.parameters(edge.id);
      const label = parameters ? `${edge.name} · assumed ${parameters.travelSeconds} s, ${parameters.capacityPerSecond} people/s`
        : edge.kind === "gate" ? edge.name
        : `${surface} · ${edge.kind === "aisle" ? "section aisle" : edge.kind === "concourse" ? "concourse path" : "access walk"}`;
      if (labels.at(-1) !== label) labels.push(label);
    }
    labels.push("Outside stadium boundary");
    return labels.map(label => `<li>${label}</li>`).join("");
  }

  private render() {
    const route = this.router.route(this.from, this.gate);
    const network = this.svg.querySelector("#stadium-network")!;
    network.innerHTML = this.showNetwork ? this.router.network.edges.filter(e => this.visible(e) && (!e.transfer || (e.kind === "passage" && this.showConnections)) && e.kind !== "gate").map(e =>
      `<path data-network-edge="${e.id}" class="stadium-network-path ${e.transfer ? "is-transfer" : ""} ${this.router.isClosed(e.id) ? "is-closed" : ""}" d="${this.line(e)}"/>`).join("") : "";
    // Full route stays selected when layers or background overlays change.
    this.svg.querySelector("#stadium-active-route")!.innerHTML = route ? route.steps.filter(step => this.visible(this.router.edges.get(step.edgeId)!)).map(step => {
      const edge = this.router.edges.get(step.edgeId)!;
      return `<path data-route-edge="${edge.id}" class="stadium-route-path ${edge.transfer ? "is-transfer" : ""}" d="${this.line(edge)}"/>`;
    }).join("") : "";
    for (const feature of STADIUM.connectors) {
      this.svg.querySelector(`[data-feature="${feature.id}"]`)!.classList.toggle("is-closed", this.router.isClosed(feature.id));
    }
    for (const gate of STADIUM.gates) this.svg.querySelector(`[data-feature="${gate.id}"]`)!.classList.toggle("is-closed", this.router.isClosed(gate.id));
    // Keep section and marker labels readable above the route overlay, without adding tab stops.
    this.svg.querySelector("#stadium-route-labels")!.replaceChildren(...Array.from(this.svg.querySelectorAll(".stadium-feature:not([hidden]) text")).map(text => text.cloneNode(true)));
    const from = STADIUM.sections.find(s => s.id === this.from)!;
    const status = this.root.querySelector("#stadium-route-status")!;
    status.textContent = route ? `${from.name} → ${STADIUM.gates.find(g => g.id === route.gateId)!.name}`
      : `No route from ${from.name} to ${this.gate === "any" ? "an open gate" : "the selected gate"}.`;
    status.classList.toggle("error", !route);
    this.root.querySelector("#stadium-route-measures")!.textContent = route
      ? `Illustrative travel without queues: ${route.freeFlowSeconds.toFixed(1)} s · assumed walking distance ${route.assumedWalkMeters.toFixed(1)} m · transfers ${route.transferSeconds.toFixed(1)} s`
      : "Reopen a connection or gate, or choose another destination. See connectivity below for sections without any exit route.";
    this.root.querySelector("#stadium-route-layer-note")!.textContent = this.layer === "overview" ? "" : "Only this layer's portion is highlighted. Choose Overview to see the complete route.";
    this.root.querySelector("#stadium-route-steps")!.innerHTML = route ? this.itinerary(route) : "<li>No connected route.</li>";
    const connectivity = this.router.connectivity();
    this.root.querySelector("#stadium-connectivity")!.textContent = `${connectivity.reachable.length} / ${STADIUM.sections.length} sections can reach an open gate`;
    this.root.querySelector("#stadium-connectivity")!.classList.toggle("error", connectivity.disconnected.length > 0);
    this.root.querySelector("#stadium-disconnected")!.textContent = connectivity.disconnected.length
      ? `Disconnected sections: ${connectivity.disconnected.map(id => id.replace("section-", "")).join(", ")}` : "All modeled sections have a connected route.";
  }
}

export const stadiumAssumptionsText = `All route geometry and dimensions are assumptions: ${STADIUM_ASSUMPTIONS.metersPerUnit} m per drawing unit; route-inspection reference speed ${STADIUM_ASSUMPTIONS.walkingSpeedMetersPerSecond} m/s; aisles ${STADIUM_ASSUMPTIONS.aisleWidthMeters} m, access walks ${STADIUM_ASSUMPTIONS.walkwayWidthMeters} m, concourse ${STADIUM_ASSUMPTIONS.concourseWidthMeters} m wide. Individual profiles vary walking speed, response delay and body size. Continuous body-clearance checks and reserved junctions constrain movement; slower walkers can delay a queue. Transfer rates and minimum times remain enforced. Seat access and population profiles are synthetic. These are experimental inputs, not measured stadium dimensions or validated evacuation predictions.`;
