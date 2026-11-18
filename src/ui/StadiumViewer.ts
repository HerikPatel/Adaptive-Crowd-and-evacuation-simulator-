import {
  STADIUM, STADIUM_FEATURES, STADIUM_LAYERS, STADIUM_SOURCES, featureOnLayer, surfaceName,
  type StadiumFeature, type StadiumLayer,
} from "../maps/stadium";
import { StadiumRoutes, stadiumAssumptionsText } from "./StadiumRoutes";
import { Stadium3DView, type StadiumLighting } from "./Stadium3DView";
import { STADIUM_DESTINATIONS, type StadiumViewLevel, type StadiumViewMode } from "./StadiumVisuals";
import { physicalToSvg, sourceToPhysical, STADIUM_PHYSICAL_SEATS } from "../simulation/StadiumPhysicalGeometry";

const VIEW_LEVELS: { id: StadiumViewLevel; name: string; description: string }[] = [
  { id: "overview", name: "Overview", description: "All modeled surfaces and connections." },
  { id: "lower-bowl", name: "Lower bowl", description: "Sections 101–144 and their access routes." },
  { id: "upper-east", name: "East upper", description: "East upper deck and its ramp connection." },
  { id: "upper-west", name: "West upper", description: "West upper deck and its ramp connection." },
  { id: "concourse", name: "Concourse / gates", description: "Concourse circulation and the four exterior gate groups." },
  { id: "connections", name: "Connections", description: "Modeled passages, stairs, and ramps between surfaces." },
];

/** SVG stadium simulation, independent of the original single-grid experiments. */
export class StadiumViewer {
  private layer: StadiumLayer = "overview";
  private level: StadiumViewLevel = "overview";
  private viewMode: StadiumViewMode = "2d";
  private selected: StadiumFeature | undefined;
  private showConnections = true;
  private zoom = 1;
  private view = { x: 0, y: 0, width: STADIUM.height as number, height: STADIUM.width as number };
  private svg: SVGSVGElement;
  private picker: HTMLSelectElement;
  private routes: StadiumRoutes;
  private threeD?: Stadium3DView;

  constructor(private root: HTMLElement) {
    root.innerHTML = `
      <div class="stadium-heading-row"><div><span class="eyebrow stadium-eyebrow">RUTGERS / MAP STUDY</span>
        <h2 id="stadium-heading" tabindex="-1">SHI Stadium <span class="stadium-badge">Linked 2D + 3D simulation</span></h2>
        <p>${STADIUM.scenario}. Follow spectators from the stands through transfers to exterior gates.</p></div>
        <button type="button" data-menu>Back to setup</button></div>
      <div class="stadium-layout"><section class="stage" aria-label="Stadium map viewer">
        <div class="stadium-view-switch" role="group" aria-label="Stadium view"><button type="button" data-view="2d" aria-pressed="true">2D overview</button><button type="button" data-view="3d" aria-pressed="false">Architectural 3D</button><span class="stadium-schematic-label">SHI STADIUM-INSPIRED · VISUAL PROJECTION</span></div>
        <div class="stadium-toolbar"><div class="stadium-layers" role="group" aria-label="Map level">
          ${VIEW_LEVELS.map(l => `<button type="button" data-level="${l.id}" aria-pressed="${l.id === this.level}">${l.name}</button>`).join("")}
        </div><div class="stadium-zoom" role="group" aria-label="Map zoom">
          <button type="button" data-zoom="out" aria-label="Zoom out">−</button><output id="stadium-zoom-value" aria-label="Zoom level">100%</output>
          <button type="button" data-zoom="in" aria-label="Zoom in">+</button><button type="button" data-zoom="fit">Fit map</button>
        </div></div>
        <p id="stadium-layer-description" class="stadium-layer-description"></p>
        <section id="stadium-crowd-controls" aria-label="Stadium crowd controls"></section>
        <div id="stadium-blocked-warning" class="stadium-blocked-warning" role="alert" hidden></div>
        <details id="stadium-reference-panel" class="stadium-collapsible"><summary>Reference-speed route preview</summary><div id="stadium-route-tools"></div>
          <section class="stadium-route-summary" aria-label="Reference-speed route preview results"><span class="stadium-detail-tag">REFERENCE-SPEED ROUTE PREVIEW · EXCLUDES QUEUES</span><strong id="stadium-route-status" role="status"></strong><p id="stadium-route-measures"></p><p id="stadium-route-layer-note" class="field-help"></p>
            <details><summary>Route steps</summary><ol id="stadium-route-steps"></ol></details>
            <div class="stadium-connectivity-row"><strong id="stadium-connectivity" role="status"></strong><button type="button" id="stadium-reset-network">Reset route assumptions</button></div><p id="stadium-disconnected"></p>
          </section></details>
        <div class="stadium-view-stack"><svg id="stadium-map" class="stadium-svg hide-section-labels" viewBox="0 0 ${STADIUM.height} ${STADIUM.width}" role="group" aria-labelledby="stadium-map-title" aria-describedby="stadium-map-description">
          <title id="stadium-map-title">SHI Stadium schematic</title>
          <desc id="stadium-map-description">North is up. Shared physical geometry in meters is projected into this view. Use the feature selector or click a section, gate or connection to inspect it.</desc>
          <g aria-hidden="true" class="stadium-context">
            <g class="stadium-compass" transform="translate(80 95)"><path d="M-30 0H30 M0-30V30"/><path d="M0-30l-5 8h10Z"/><text x="0" y="-41">N</text><text x="44" y="5">E</text><text x="0" y="50">S</text><text x="-44" y="5">W</text></g>
            <g data-context="upper"><text class="stadium-deck-name" x="760" y="600" transform="rotate(90 760 600)">EAST UPPER DECK</text><text class="stadium-deck-name" x="120" y="600" transform="rotate(-90 120 600)">WEST UPPER DECK</text></g>
            <g id="stadium-concourse-ring"><rect class="stadium-concourse" x="205" y="205" width="470" height="790" rx="235"/><rect class="stadium-concourse-guide" x="205" y="205" width="470" height="790" rx="235"/></g>
            <rect class="stadium-bowl-outline" x="280" y="280" width="320" height="640" rx="160"/>
            <rect class="stadium-field" x="320" y="350" width="240" height="500" rx="4"/>
            <path class="stadium-field-lines" d="${Array.from({ length: 11 }, (_, i) => `M330 ${350 + (i + 1) * 500 / 12}H550`).join(" ")}"/>
            <text class="stadium-side-name" x="292" y="600" transform="rotate(-90 292 600)">WEST</text><text class="stadium-side-name" x="588" y="600" transform="rotate(90 588 600)">EAST</text>
            <rect class="stadium-field-caption" x="354" y="564" width="172" height="72" rx="8"/>
            <text class="stadium-field-name" x="440" y="592">FOOTBALL FIELD</text><text class="stadium-caption" x="440" y="615">No spectator route</text>
          </g>
          ${STADIUM_FEATURES.map(f => this.featureMarkup(f)).join("")}
          <g id="stadium-seating-detail" aria-hidden="true"></g><g id="stadium-network" aria-hidden="true"></g><g id="stadium-active-route" aria-hidden="true"></g><g id="stadium-committed-routes" aria-hidden="true"></g><g id="stadium-route-labels" aria-hidden="true"></g><g id="stadium-crowd-agents" aria-hidden="true"></g><g id="stadium-state-markers" aria-hidden="true"></g>
        </svg><div id="stadium-3d" class="stadium-3d" hidden><div id="stadium-3d-loading">Choose 3D to load the SHI Stadium-inspired scene.</div></div></div>
        <div id="stadium-3d-controls" class="stadium-3d-controls" hidden>
          <div role="group" aria-label="3D camera"><button type="button" id="stadium-follow-person" aria-pressed="false" disabled>Follow selected person</button><button type="button" data-camera="reset">Reset</button><button type="button" data-camera="top-down">Top-down</button><button type="button" data-camera="connections">Connectors</button><button type="button" data-camera="gates">Gates</button></div>
          <div class="stadium-lighting-controls" role="group" aria-label="3D lighting"><button type="button" data-lighting="day" aria-pressed="true">Day</button><button type="button" data-lighting="night" aria-pressed="false">Stadium lights</button></div>
          <div class="stadium-cutaway-controls" role="group" aria-label="3D structure"><button type="button" data-cutaway="true" aria-pressed="true">Evacuation cutaway</button><button type="button" data-cutaway="false" aria-pressed="false">Full architecture</button></div><output id="stadium-3d-performance"></output></div>
        <div id="stadium-3d-error" class="error" role="alert"><span id="stadium-3d-error-text"></span><button type="button" id="stadium-return-2d" hidden>Return to 2D</button></div>
        <div class="stadium-legend stadium-destination-legend">${Object.entries(STADIUM_DESTINATIONS).map(([id, gate]) => `<span data-gate-legend="${id}"><i class="swatch" style="background:${gate.color}"></i>${gate.label}</span>`).join("")}
          <span><i class="swatch neutral"></i>Not assigned</span><span><i class="swatch waiting"></i>Waiting outline</span><span><i class="swatch rerouting"></i>Rerouting marker</span><span><i class="swatch blocked"></i>Blocked route</span></div>
        <p class="stadium-map-help">The 2D map remains schematic. The 3D scene is a SHI Stadium-inspired visual projection; orbit with drag and zoom with the wheel or trackpad.</p>
        <details id="stadium-measurements" class="stadium-collapsible"><summary>Detailed measurements</summary><section id="stadium-crowd-stats" class="stadium-route-summary" aria-label="Stadium live measurements"></section></details>
      </section><aside class="stadium-details" aria-label="Map details">
        <span class="eyebrow">CONTEXTUAL INSPECTOR</span>
        <label for="stadium-feature-picker">Inspect a section, gate or connection</label><select id="stadium-feature-picker"></select>
        <label for="stadium-context-person-picker">Inspect a spectator</label><select id="stadium-context-person-picker"><option value="">Choose a spectator…</option></select>
        <div id="stadium-feature-details" aria-live="polite" aria-atomic="true"></div>
        <div id="stadium-person-context" hidden></div>
        <div id="stadium-connection-controls" hidden></div>
        <details class="stadium-display-panel"><summary>Display settings</summary><div class="stadium-toggles"><label class="check"><input id="stadium-labels" type="checkbox"> Section labels</label>
          <label class="check"><input id="stadium-connections" type="checkbox" checked> Proposed connections</label></div></details>
        <div class="stadium-scope"><strong>Connected levels, timed transfers</strong><p>Inspect a ramp, stair, gate or lower section to change its connection. Changes pause the run. Closures prevent new entries; people already traveling finish their current connection, then replan. Reset crowd keeps your route settings.</p><p>Counts update across all levels. Only passing an exterior gate counts as evacuation. The highlighted route is a reference-speed inspection aid. After their response delay, each spectator chooses from the currently open routes using their preferred walking speed and commits; queues delay movement but do not change that route.</p></div>
        <details class="stadium-sources"><summary>Sources & assumptions</summary>
          <p>Section labels, gate groups and access symbols come from Rutgers. The 2D map remains schematic. The separate 3D projection is inspired by SHI Stadium's open bowl, sideline upper decks, south-end expansion, video board and entrance façade; it is not a measured digital twin. Official branding is intentionally omitted.</p>
          <p>${stadiumAssumptionsText}</p><p>Default transfer assumptions: ramps 30 s at 2 people/s; stairs 12 s at 1 person/s; bowl openings 3 s at 2 people/s. Connectors lead toward the concourse; gates lead outside. Settings last for this visit.</p>
          <ul>${Object.values(STADIUM_SOURCES).map(s => `<li><a href="${s.url}" target="_blank" rel="noopener noreferrer">${s.title}</a></li>`).join("")}</ul>
          <p>References inspected ${STADIUM.inspected}. Premium areas and the field are reference only. Elevator evacuation use is unspecified.</p>
        </details>
      </aside></div>`;
    this.svg = root.querySelector<SVGSVGElement>("#stadium-map")!;
    this.picker = root.querySelector<HTMLSelectElement>("#stadium-feature-picker")!;
    root.querySelectorAll<HTMLButtonElement>("[data-level]").forEach(button => button.addEventListener("click", () => {
      this.level = button.dataset.level as StadiumViewLevel;
      this.layer = this.mapLayer(this.level);
      this.updateVisibility();
    }));
    this.picker.addEventListener("change", () => this.select(this.picker.value));
    root.querySelector<HTMLSelectElement>("#stadium-context-person-picker")!.addEventListener("change", event => {
      const value = (event.target as HTMLSelectElement).value;
      if (value !== "") this.selectPerson(Number(value));
    });
    this.svg.addEventListener("click", event => {
      const feature = (event.target as Element).closest<SVGGElement>("[data-feature]");
      if (feature) this.select(feature.dataset.feature);
      else if (!(event.target as Element).closest("[data-person]")) this.clearPersonAndOverview();
    });
    this.svg.addEventListener("keydown", event => {
      const feature = (event.target as Element).closest<SVGGElement>("[data-feature]");
      if (feature && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault();
        this.select(feature.dataset.feature);
      }
    });
    root.querySelector<HTMLInputElement>("#stadium-labels")!.addEventListener("change", event => {
      this.svg.classList.toggle("hide-section-labels", !(event.target as HTMLInputElement).checked);
    });
    root.querySelector<HTMLInputElement>("#stadium-connections")!.addEventListener("change", event => {
      this.showConnections = (event.target as HTMLInputElement).checked;
      this.updateVisibility();
    });
    root.querySelectorAll<HTMLButtonElement>("[data-zoom]").forEach(button => button.addEventListener("click", () => {
      const action = button.dataset.zoom;
      const next = action === "fit" ? 1 : Math.max(1, Math.min(4, this.zoom * (action === "in" ? 1.5 : 1 / 1.5)));
      const width = STADIUM.height / next, height = STADIUM.width / next;
      this.view = { x: this.view.x + (this.view.width - width) / 2, y: this.view.y + (this.view.height - height) / 2, width, height };
      this.zoom = next;
      this.updateView(); this.updateSeatingDetail();
    }));
    this.routes = new StadiumRoutes(root, this.svg, id => this.select(id), id => this.selectPerson(id));
    const personPanel = root.querySelector<HTMLDetailsElement>(".stadium-profile-panel")!;
    root.querySelector("#stadium-person-context")!.append(personPanel);
    personPanel.open = true;
    personPanel.querySelector<HTMLLabelElement>('label[for="stadium-person-picker"]')!.hidden = true;
    personPanel.querySelector<HTMLSelectElement>("#stadium-person-picker")!.hidden = true;
    root.querySelectorAll<HTMLButtonElement>("[data-view]").forEach(button => button.addEventListener("click", () => void this.switchView(button.dataset.view as StadiumViewMode)));
    root.querySelector<HTMLDetailsElement>("#stadium-reference-panel")!.addEventListener("toggle", event =>
      this.routes.setReferenceVisible((event.target as HTMLDetailsElement).open));
    root.querySelectorAll<HTMLButtonElement>("[data-camera]").forEach(button => button.addEventListener("click", () => {
      this.threeD?.preset(button.dataset.camera as "reset" | "top-down" | "connections" | "gates");
      this.updateFollowControl();
    }));
    root.querySelector<HTMLButtonElement>("#stadium-follow-person")!.addEventListener("click", () => {
      const id = this.routes.selectedPersonId;
      const person = id === null ? undefined : this.routes.renderFrame().people.find(candidate => candidate.id === id);
      if (person && person.movementState !== "evacuated") this.threeD?.focusPerson(person, true);
      this.updateFollowControl();
    });
    root.querySelectorAll<HTMLButtonElement>("[data-lighting]").forEach(button => button.addEventListener("click", () => {
      const lighting = button.dataset.lighting as StadiumLighting;
      this.threeD?.setLighting(lighting);
      root.querySelectorAll<HTMLElement>("[data-lighting]").forEach(control =>
        control.setAttribute("aria-pressed", String(control.dataset.lighting === lighting)));
    }));
    root.querySelectorAll<HTMLButtonElement>("[data-cutaway]").forEach(button => button.addEventListener("click", () => {
      const value = button.dataset.cutaway === "true"; this.threeD?.setCutaway(value);
      root.querySelectorAll<HTMLElement>("[data-cutaway]").forEach(control => control.setAttribute("aria-pressed", String((control.dataset.cutaway === "true") === value)));
    }));
    root.querySelector("#stadium-return-2d")!.addEventListener("click", () => {
      this.root.querySelector("#stadium-3d-error-text")!.textContent = "";
      this.root.querySelector<HTMLElement>("#stadium-return-2d")!.hidden = true;
      void this.switchView("2d");
    });
    this.bindPan();
    this.updateVisibility();
    this.updateView();
  }

  update(delta: number, active: boolean) {
    this.routes.update(delta, active);
    this.syncPersonPicker();
    if (active && this.viewMode === "3d" && this.threeD) {
      this.threeD.render(this.routes.renderFrame());
      this.updateFollowControl();
    }
  }
  pause() { this.routes.pause(); }

  private featureMarkup(f: StadiumFeature): string {
    let shape: string;
    if (f.kind === "section") {
      const at = physicalToSvg(sourceToPhysical(f.at));
      shape = `<polygon points="${f.polygon.map(p => { const point = physicalToSvg(sourceToPhysical(p)); return `${point.x.toFixed(2)},${point.y.toFixed(2)}`; }).join(" ")}"/><text class="stadium-section-label" x="${at.x}" y="${at.y + 5}">${f.label}</text>`;
    } else {
      const isGate = f.kind === "gate", halfWidth = isGate ? 47 : 19;
      const at = physicalToSvg(sourceToPhysical(f.at));
      const line = f.kind === "connector"
        ? (() => { const from = physicalToSvg(sourceToPhysical(f.from.point)), to = physicalToSvg(sourceToPhysical(f.to.point)); return `<path class="stadium-link" d="M${from.x} ${from.y} L${at.x} ${at.y} L${to.x} ${to.y}"/><circle class="stadium-endpoint" cx="${from.x}" cy="${from.y}" r="4"/><circle class="stadium-endpoint" cx="${to.x}" cy="${to.y}" r="4"/>`; })()
        : isGate ? (() => { const approach = physicalToSvg(sourceToPhysical(f.approach)); return `<path class="stadium-link" d="M${approach.x} ${approach.y} L${at.x} ${at.y}"/>`; })() : "";
      shape = `${line}<rect x="${at.x - halfWidth}" y="${at.y - 17}" width="${halfWidth * 2}" height="34" rx="6"/><text x="${at.x}" y="${at.y + 5}">${f.label}</text>${isGate ? `<text class="stadium-gate-side" x="${at.x}" y="${at.y - 27}">${f.side.toUpperCase()}</text>` : ""}`;
    }
    const level = f.kind === "section" ? f.surfaceId === "lower-bowl" ? "lower" : "upper" : "";
    return `<g class="stadium-feature feature-${f.kind} ${level}" data-feature="${f.id}" role="button" tabindex="0" aria-label="${f.name}" aria-pressed="false"><title>${f.name}</title>${shape}</g>`;
  }

  private visible(f: StadiumFeature): boolean {
    if (!this.showConnections && f.kind === "connector") return false;
    if (this.level === "overview") return true;
    if (this.level === "connections") return f.kind === "connector";
    if (f.kind === "gate") return this.level === "concourse";
    if (f.kind === "connector") return f.from.surfaceId === this.level || f.to.surfaceId === this.level;
    return f.surfaceId === this.level;
  }

  private updateVisibility() {
    for (const f of STADIUM_FEATURES) {
      this.svg.querySelector(`[data-feature="${f.id}"]`)!.toggleAttribute("hidden", !this.visible(f));
    }
    this.root.querySelectorAll<HTMLElement>("[data-level]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.level === this.level)));
    this.root.querySelector("#stadium-layer-description")!.textContent = VIEW_LEVELS.find(l => l.id === this.level)!.description;
    this.svg.querySelector("[data-context=upper]")!.toggleAttribute("hidden", !["overview", "upper-east", "upper-west"].includes(this.level));
    this.svg.querySelector("#stadium-concourse-ring")!.classList.toggle("muted", ["lower-bowl", "upper-east", "upper-west"].includes(this.level));
    this.picker.innerHTML = `<option value="">Choose a feature…</option>` + STADIUM_FEATURES.filter(f => this.visible(f)).map(f => `<option value="${f.id}">${f.name}</option>`).join("");
    const personId = this.routes.selectedPersonId;
    if (personId === null) this.select(this.selected && this.visible(this.selected) ? this.selected.id : undefined);
    else {
      this.selected = undefined; this.picker.value = "";
      this.svg.querySelectorAll<SVGGElement>("[data-feature]").forEach(el => el.setAttribute("aria-pressed", "false"));
    }
    this.routes.setLayer(this.layer, this.showConnections);
    this.routes.setViewLevel(this.level);
    if (personId === null) this.routes.selectSection(this.selected?.kind === "section" ? this.selected.id : null);
    this.threeD?.setLevel(this.level);
    this.threeD?.setSelection(personId, personId === null && this.selected?.kind === "section" ? this.selected.id : null);
    this.updateSeatingDetail();
  }

  private select(id?: string) {
    this.selected = STADIUM_FEATURES.find(f => f.id === id && this.visible(f));
    this.picker.value = this.selected?.id ?? "";
    this.svg.querySelectorAll<SVGGElement>("[data-feature]").forEach(el => el.setAttribute("aria-pressed", String(el.dataset.feature === this.selected?.id)));
    this.routes.inspectFeature(this.selected);
    this.routes.clearPersonSelection();
    this.routes.selectSection(this.selected?.kind === "section" ? this.selected.id : null);
    this.root.querySelector<HTMLElement>("#stadium-person-context")!.hidden = true;
    this.root.querySelector<HTMLElement>("#stadium-feature-details")!.hidden = false;
    this.threeD?.setSelection(null, this.selected?.kind === "section" ? this.selected.id : null);
    if (this.selected?.kind === "section" && this.viewMode === "2d") this.frameSection(this.selected);
    const f = this.selected;
    const details = this.root.querySelector("#stadium-feature-details")!;
    if (!f) {
      details.innerHTML = `<h3>One stadium, connected levels</h3><p>Inspect a section or connection to see what is known and what still needs to be mapped.</p>
        <dl class="stadium-facts"><div><dt>Lower bowl</dt><dd>44 sections</dd></div><div><dt>Upper decks</dt><dd>28 sections</dd></div><div><dt>Public gates</dt><dd>7 names · 4 groups</dd></div></dl>`;
      return;
    }
    let facts: [string, string][];
    if (f.kind === "section") facts = [["Layer", surfaceName(f.surfaceId)], ["Seat count", "Unknown"], ["Aisle connections", "Assumed aisle + access walk"]];
    else if (f.kind === "gate") facts = [["Stadium side", f.side], ["Gate names", f.gateNames.join(", ")], ["Opening widths", "Unknown"]];
    else if (f.kind === "connector") facts = [["Proposed from", surfaceName(f.from.surfaceId)], ["Proposed to", surfaceName(f.to.surfaceId)], ["Time / capacity", "Editable assumptions below"]];
    else facts = [["Use", "Reference only"], ["Elevator stops", "Unknown"], ["Evacuation use", "Unspecified"]];
    details.innerHTML = `<span class="stadium-detail-tag">${f.kind === "connector" ? "PROPOSED CONNECTION" : f.kind === "reference" ? "REFERENCE MARKER" : "PUBLISHED LABEL · SCHEMATIC SHAPE"}</span>
      <h3>${f.name}</h3><p>${f.description}</p><dl class="stadium-facts">${facts.map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join("")}</dl>
      <p class="stadium-evidence">Source: ${f.sources.map(id => `<a href="${STADIUM_SOURCES[id].url}" target="_blank" rel="noopener noreferrer">${STADIUM_SOURCES[id].title}</a>`).join(" · ")}</p>`;
  }

  private selectPerson(id: number) {
    if (this.routes.selectedPersonId === id) { this.clearPersonAndOverview(); return; }
    this.selected = undefined; this.picker.value = "";
    this.svg.querySelectorAll<SVGGElement>("[data-feature]").forEach(el => el.setAttribute("aria-pressed", "false"));
    this.routes.selectPerson(id);
    this.root.querySelector<HTMLSelectElement>("#stadium-context-person-picker")!.value = String(id);
    this.root.querySelector<HTMLElement>("#stadium-feature-details")!.hidden = true;
    this.root.querySelector<HTMLElement>("#stadium-connection-controls")!.hidden = true;
    this.root.querySelector<HTMLElement>("#stadium-person-context")!.hidden = false;
    this.threeD?.setSelection(id, null);
    this.updateFollowControl();
  }

  private clearPersonAndOverview() {
    this.routes.clearPersonSelection();
    this.root.querySelector<HTMLSelectElement>("#stadium-context-person-picker")!.value = "";
    this.root.querySelector<HTMLElement>("#stadium-person-context")!.hidden = true;
    this.root.querySelector<HTMLElement>("#stadium-feature-details")!.hidden = false;
    this.threeD?.setSelection(null, null); this.threeD?.setFollowing(false); this.updateFollowControl();
  }

  private frameSection(section: Extract<StadiumFeature, { kind: "section" }>) {
    const points = section.polygon.map(point => physicalToSvg(sourceToPhysical(point)));
    const minX = Math.min(...points.map(point => point.x)), maxX = Math.max(...points.map(point => point.x));
    const minY = Math.min(...points.map(point => point.y)), maxY = Math.max(...points.map(point => point.y));
    const width = Math.max(120, (maxX - minX) * 3.2), height = width * STADIUM.width / STADIUM.height;
    this.view = { x: (minX + maxX - width) / 2, y: (minY + maxY - height) / 2, width, height };
    this.zoom = STADIUM.height / width; this.updateView(); this.updateSeatingDetail();
  }

  private updateSeatingDetail() {
    const group = this.svg.querySelector("#stadium-seating-detail");
    if (!group) return;
    const selectedId = this.selected?.kind === "section" ? this.selected.id : null;
    if (this.zoom < 1.8 && !selectedId) { group.replaceChildren(); return; }
    const ids = selectedId ? [selectedId] : STADIUM.sections.filter(section => this.visible(section)).map(section => section.id);
    group.innerHTML = ids.flatMap(id => {
      const seats = STADIUM_PHYSICAL_SEATS.get(id) ?? [];
      const seatDots = seats.map(seat => { const point = physicalToSvg(seat.position); return `<circle class="stadium-physical-seat" cx="${point.x.toFixed(2)}" cy="${point.y.toFixed(2)}" r="1.15"/>`; }).join("");
      const rows = new Map<number, (typeof seats)[number][]>();
      for (const seat of seats) rows.set(seat.row, [...(rows.get(seat.row) ?? []), seat]);
      const rowPaths = [...rows.values()].map(row => {
        const ordered = [...row].sort((a, b) => a.position.x - b.position.x || a.position.z - b.position.z);
        const points = [ordered[0].position, ordered.at(-1)!.position].map(physicalToSvg);
        return `<path class="stadium-row-access is-row" d="M${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)} L${points[1].x.toFixed(2)} ${points[1].y.toFixed(2)}"/>`;
      }).join("");
      const sidePaths = (["left", "right"] as const).map(side => {
        const sideSeats = [...rows.values()].map(row => row.find(seat => seat.side === side)).filter((seat): seat is (typeof seats)[number] => Boolean(seat)).sort((a, b) => a.row - b.row);
        if (!sideSeats.length) return "";
        const aislePoints = sideSeats.map(seat => seat.accessPath.points[1]);
        aislePoints.push(sideSeats.at(-1)!.accessPath.points.at(-1)!);
        return `<path class="stadium-row-access is-aisle" d="${aislePoints.map((point, index) => { const projected = physicalToSvg(point); return `${index ? "L" : "M"}${projected.x.toFixed(2)} ${projected.y.toFixed(2)}`; }).join(" ")}"/>`;
      }).join("");
      const paths = `${rowPaths}${sidePaths}`;
      const section = STADIUM.sections.find(candidate => candidate.id === id)!;
      const clip = section.polygon.map(point => { const projected = physicalToSvg(sourceToPhysical(point)); return `${projected.x.toFixed(2)},${projected.y.toFixed(2)}`; }).join(" ");
      return `<clipPath id="seating-clip-${id}"><polygon points="${clip}"/></clipPath><g data-seating-section="${id}" clip-path="url(#seating-clip-${id})">${paths}${seatDots}</g>`;
    }).join("");
  }

  private mapLayer(level: StadiumViewLevel): StadiumLayer {
    if (level === "lower-bowl") return "lower";
    if (level === "upper-east" || level === "upper-west") return "upper";
    if (level === "concourse") return "concourse";
    return "overview";
  }

  private async switchView(mode: StadiumViewMode) {
    if (mode === this.viewMode) return;
    if (mode === "3d") {
      try {
        if (!this.threeD) {
          const container = this.root.querySelector<HTMLElement>("#stadium-3d")!;
          this.threeD = new Stadium3DView(container, this.routes.getRouter(), id => this.selectPerson(id), () => this.clearPersonAndOverview(),
            this.root.querySelector<HTMLElement>("#stadium-3d-performance")!);
          await this.threeD.initialize(); this.threeD.setLevel(this.level);
          this.threeD.setSelection(this.routes.selectedPersonId, this.selected?.kind === "section" ? this.selected.id : null);
        }
        this.root.querySelector("#stadium-3d-error-text")!.textContent = "";
        this.root.querySelector<HTMLElement>("#stadium-return-2d")!.hidden = true;
      } catch (error) {
        this.root.querySelector("#stadium-3d-error-text")!.textContent = `3D view unavailable: ${(error as Error).message} The 2D simulator remains active. `;
        this.root.querySelector<HTMLElement>("#stadium-return-2d")!.hidden = false;
        return;
      }
    }
    this.viewMode = mode; this.routes.setViewMode(mode);
    this.svg.toggleAttribute("hidden", mode !== "2d");
    this.root.querySelector<HTMLElement>("#stadium-3d")!.hidden = mode !== "3d";
    this.root.querySelector<HTMLElement>("#stadium-3d-controls")!.hidden = mode !== "3d";
    this.root.querySelector<HTMLElement>(".stadium-zoom")!.hidden = mode !== "2d";
    this.root.querySelectorAll<HTMLElement>("[data-view]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.view === mode)));
    if (mode === "3d" && this.threeD) this.threeD.render(this.routes.renderFrame());
    this.updateFollowControl();
  }

  private syncPersonPicker() {
    const picker = this.root.querySelector<HTMLSelectElement>("#stadium-context-person-picker")!;
    const frame = this.routes.renderFrame();
    if (picker.options.length === frame.population + 1) return;
    picker.innerHTML = `<option value="">Choose a spectator…</option>` + frame.people.map(person =>
      `<option value="${person.id}">Spectator ${person.id + 1} · ${person.sectionId.replace("section-", "Section ")}</option>`).join("");
  }

  private updateFollowControl() {
    const button = this.root.querySelector<HTMLButtonElement>("#stadium-follow-person");
    if (!button) return;
    const id = this.routes.selectedPersonId;
    const person = id === null ? undefined : this.routes.renderFrame().people.find(candidate => candidate.id === id);
    button.disabled = !person || person.movementState === "evacuated" || !this.threeD;
    button.setAttribute("aria-pressed", String(Boolean(person && this.threeD?.isFollowing)));
  }

  private updateView() {
    this.view.x = Math.max(0, Math.min(STADIUM.height - this.view.width, this.view.x));
    this.view.y = Math.max(0, Math.min(STADIUM.width - this.view.height, this.view.y));
    this.svg.setAttribute("viewBox", `${this.view.x} ${this.view.y} ${this.view.width} ${this.view.height}`);
    this.root.querySelector("#stadium-zoom-value")!.textContent = `${Math.round(this.zoom * 100)}%`;
    this.root.querySelector<HTMLButtonElement>("[data-zoom=out]")!.disabled = this.zoom === 1;
    this.root.querySelector<HTMLButtonElement>("[data-zoom=in]")!.disabled = this.zoom === 4;
  }

  private bindPan() {
    let drag: { id: number; x: number; y: number; viewX: number; viewY: number; scale: number } | undefined;
    this.svg.addEventListener("pointerdown", event => {
      if (event.button !== 0 || drag || (event.target as Element).closest("[data-feature], [data-person]")) return;
      const scale = this.svg.getScreenCTM()?.a;
      if (!scale) return;
      event.preventDefault();
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, viewX: this.view.x, viewY: this.view.y, scale };
      this.svg.setPointerCapture(event.pointerId);
    });
    this.svg.addEventListener("pointermove", event => {
      if (!drag || drag.id !== event.pointerId) return;
      this.view.x = drag.viewX - (event.clientX - drag.x) / drag.scale;
      this.view.y = drag.viewY - (event.clientY - drag.y) / drag.scale;
      this.updateView();
    });
    const stop = (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.id) return;
      drag = undefined;
      if (this.svg.hasPointerCapture(event.pointerId)) this.svg.releasePointerCapture(event.pointerId);
    };
    this.svg.addEventListener("pointerup", stop);
    this.svg.addEventListener("pointercancel", stop);
    this.svg.addEventListener("lostpointercapture", stop);
  }
}
