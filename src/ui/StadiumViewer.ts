import {
  STADIUM, STADIUM_FEATURES, STADIUM_LAYERS, STADIUM_SOURCES, featureOnLayer, surfaceName,
  type StadiumFeature, type StadiumLayer,
} from "../maps/stadium";
import { StadiumRoutes, stadiumAssumptionsText } from "./StadiumRoutes";

/** SVG stadium simulation, independent of the original single-grid experiments. */
export class StadiumViewer {
  private layer: StadiumLayer = "overview";
  private selected: StadiumFeature | undefined;
  private showConnections = true;
  private zoom = 1;
  private view = { x: 0, y: 0, width: STADIUM.width as number, height: STADIUM.height as number };
  private svg: SVGSVGElement;
  private picker: HTMLSelectElement;
  private routes: StadiumRoutes;

  constructor(private root: HTMLElement) {
    root.innerHTML = `
      <div class="stadium-heading-row"><div><span class="eyebrow stadium-eyebrow">RUTGERS / MAP STUDY</span>
        <h2 id="stadium-heading" tabindex="-1">SHI Stadium <span class="stadium-badge">Schematic simulation</span></h2>
        <p>${STADIUM.scenario}. Follow spectators from the stands through transfers to exterior gates.</p></div>
        <button type="button" data-menu>Back to setup</button></div>
      <div class="stadium-layout"><section class="stage" aria-label="Stadium map viewer">
        <div class="stadium-toolbar"><div class="stadium-layers" role="group" aria-label="Map layer">
          ${STADIUM_LAYERS.map(l => `<button type="button" data-layer="${l.id}" aria-pressed="${l.id === this.layer}">${l.name}</button>`).join("")}
        </div><div class="stadium-zoom" role="group" aria-label="Map zoom">
          <button type="button" data-zoom="out" aria-label="Zoom out">−</button><output id="stadium-zoom-value" aria-label="Zoom level">100%</output>
          <button type="button" data-zoom="in" aria-label="Zoom in">+</button><button type="button" data-zoom="fit">Fit map</button>
        </div></div>
        <p id="stadium-layer-description" class="stadium-layer-description"></p>
        <section id="stadium-crowd-controls" aria-label="Stadium crowd controls"></section>
        <div id="stadium-route-tools"></div>
        <svg id="stadium-map" class="stadium-svg" viewBox="0 0 ${STADIUM.width} ${STADIUM.height}" role="group" aria-labelledby="stadium-map-title" aria-describedby="stadium-map-description">
          <title id="stadium-map-title">SHI Stadium schematic</title>
          <desc id="stadium-map-description">East is up, north is left. Approximate geometry, not to scale. Use the feature selector or click a section, gate or connection to inspect it.</desc>
          <g aria-hidden="true" class="stadium-context">
            <g class="stadium-compass" transform="translate(100 80)"><path d="M-30 0H30 M0-30V30"/><path d="M-30 0l8-5v10Z"/><text x="0" y="-41">E</text><text x="-44" y="5">N</text><text x="44" y="5">S</text><text x="0" y="50">W</text></g>
            <g data-context="upper"><rect class="stadium-reference-area" x="350" y="32" width="500" height="28" rx="5"/><text class="stadium-caption" x="600" y="51">HALE CENTER · REFERENCE ONLY</text>
              <rect class="stadium-reference-area" x="350" y="164" width="500" height="26" rx="4"/><text class="stadium-caption" x="600" y="182">CLUB 1–14 · REFERENCE ONLY</text>
              <text class="stadium-deck-name" x="600" y="81">EAST UPPER DECK</text><text class="stadium-deck-name" x="600" y="703">WEST UPPER DECK</text></g>
            <g id="stadium-concourse-ring"><path class="stadium-concourse" d="M350 205H850 A235 235 0 0 1 850 675H350 A235 235 0 0 1 350 205Z"/>
              <path class="stadium-concourse-guide" d="M350 205H850 A235 235 0 0 1 850 675H350 A235 235 0 0 1 350 205Z"/></g>
            <path class="stadium-bowl-outline" d="M350 280H850 A110 160 0 0 1 850 600H350 A110 160 0 0 1 350 280Z"/>
            <rect class="stadium-field" x="350" y="320" width="500" height="240" rx="4"/>
            <path class="stadium-field-lines" d="${Array.from({ length: 11 }, (_, i) => `M${350 + (i + 1) * 500 / 12} 330V550`).join(" ")}"/>
            <text class="stadium-side-name" x="600" y="306">HOME / EAST</text><text class="stadium-side-name" x="600" y="584">VISITOR / WEST</text>
            <rect class="stadium-field-caption" x="425" y="404" width="350" height="72" rx="8"/>
            <text class="stadium-field-name" x="600" y="432">FOOTBALL FIELD</text><text class="stadium-caption" x="600" y="455">Reference only · no spectator route</text>
          </g>
          ${STADIUM_FEATURES.map(f => this.featureMarkup(f)).join("")}
          <g id="stadium-network" aria-hidden="true"></g><g id="stadium-active-route" aria-hidden="true"></g><g id="stadium-route-labels" aria-hidden="true"></g><g id="stadium-crowd-agents" aria-hidden="true"></g>
        </svg>
        <div class="stadium-legend"><span><i class="swatch lower"></i>100 level</span><span><i class="swatch upper"></i>200 level</span>
          <span><i class="swatch gate"></i>Gate group</span><span><i class="swatch connection"></i>Proposed link</span><span><i class="swatch reference"></i>Elevator reference</span><span><i class="swatch route"></i>Selected route</span></div>
        <p class="stadium-map-help">East is up. Zoom in, then drag the background to pan. Shapes are approximate and not to scale.</p>
        <div class="stadium-crowd-legend"><span>● Moving</span><span>● Waiting</span><span>● In transit</span><span>● Without a route</span></div>
        <section id="stadium-crowd-stats" class="stadium-route-summary" aria-label="Stadium live measurements"></section>
        <section class="stadium-route-summary" aria-label="Route preview results"><span class="stadium-detail-tag">ROUTE INSPECTION · FREE-FLOW ESTIMATE</span><strong id="stadium-route-status" role="status"></strong><p id="stadium-route-measures"></p><p id="stadium-route-layer-note" class="field-help"></p>
          <details><summary>Route steps</summary><ol id="stadium-route-steps"></ol></details>
          <div class="stadium-connectivity-row"><strong id="stadium-connectivity" role="status"></strong><button type="button" id="stadium-reset-network">Reset route assumptions</button></div><p id="stadium-disconnected"></p>
        </section>
      </section><aside class="stadium-details" aria-label="Map details">
        <span class="eyebrow">EXPLORE THE MAP</span>
        <label for="stadium-feature-picker">Inspect a section, gate or connection</label><select id="stadium-feature-picker"></select>
        <div class="stadium-toggles"><label class="check"><input id="stadium-labels" type="checkbox" checked> Section labels</label>
          <label class="check"><input id="stadium-connections" type="checkbox" checked> Proposed connections</label></div>
        <div id="stadium-feature-details" aria-live="polite" aria-atomic="true"></div>
        <div id="stadium-connection-controls" hidden></div>
        <div class="stadium-scope"><strong>Connected levels, timed transfers</strong><p>Inspect a ramp, stair, gate or lower section to change its connection. Changes pause the run. Closures prevent new entries; people already traveling finish their current connection, then replan. Reset crowd keeps your route settings.</p><p>Counts update across all levels. Only passing an exterior gate counts as evacuation. The highlighted route is an inspection aid; spectators choose the lowest assumed travel time to any open gate.</p></div>
        <details class="stadium-sources"><summary>Sources & assumptions</summary>
          <p>Section labels, gate groups and access symbols come from Rutgers. All shapes are schematic; the concourse ring and dashed connections are modeling assumptions. Layers do not represent three uniform building floors.</p>
          <p>${stadiumAssumptionsText}</p><p>Default transfer assumptions: ramps 30 s at 2 people/s; stairs 12 s at 1 person/s; bowl openings 3 s at 2 people/s. Connectors lead toward the concourse; gates lead outside. Settings last for this visit.</p>
          <ul>${Object.values(STADIUM_SOURCES).map(s => `<li><a href="${s.url}" target="_blank" rel="noopener noreferrer">${s.title}</a></li>`).join("")}</ul>
          <p>References inspected ${STADIUM.inspected}. Premium areas and the field are reference only. Elevator evacuation use is unspecified.</p>
        </details>
      </aside></div>`;
    this.svg = root.querySelector<SVGSVGElement>("#stadium-map")!;
    this.picker = root.querySelector<HTMLSelectElement>("#stadium-feature-picker")!;
    root.querySelectorAll<HTMLButtonElement>("[data-layer]").forEach(button => button.addEventListener("click", () => {
      this.layer = button.dataset.layer as StadiumLayer;
      this.updateVisibility();
    }));
    this.picker.addEventListener("change", () => this.select(this.picker.value));
    this.svg.addEventListener("click", event => {
      const feature = (event.target as Element).closest<SVGGElement>("[data-feature]");
      if (feature) this.select(feature.dataset.feature);
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
      const width = STADIUM.width / next, height = STADIUM.height / next;
      this.view = { x: this.view.x + (this.view.width - width) / 2, y: this.view.y + (this.view.height - height) / 2, width, height };
      this.zoom = next;
      this.updateView();
    }));
    this.routes = new StadiumRoutes(root, this.svg, id => this.select(id));
    this.bindPan();
    this.updateVisibility();
    this.updateView();
  }

  update(delta: number, active: boolean) { this.routes.update(delta, active); }
  pause() { this.routes.pause(); }

  private featureMarkup(f: StadiumFeature): string {
    let shape: string;
    if (f.kind === "section") {
      shape = `<polygon points="${f.polygon.map(p => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ")}"/><text class="stadium-section-label" x="${f.at.x}" y="${f.at.y + 5}">${f.label}</text>`;
    } else {
      const isGate = f.kind === "gate", halfWidth = isGate ? 47 : 19;
      const line = f.kind === "connector"
        ? `<path class="stadium-link" d="M${f.from.point.x} ${f.from.point.y} L${f.at.x} ${f.at.y} L${f.to.point.x} ${f.to.point.y}"/><circle class="stadium-endpoint" cx="${f.from.point.x}" cy="${f.from.point.y}" r="4"/><circle class="stadium-endpoint" cx="${f.to.point.x}" cy="${f.to.point.y}" r="4"/>`
        : isGate ? `<path class="stadium-link" d="M${f.approach.x} ${f.approach.y} L${f.at.x} ${f.at.y}"/>` : "";
      shape = `${line}<rect x="${f.at.x - halfWidth}" y="${f.at.y - 17}" width="${halfWidth * 2}" height="34" rx="6"/><text x="${f.at.x}" y="${f.at.y + 5}">${f.label}</text>${isGate ? `<text class="stadium-gate-side" x="${f.at.x}" y="${f.at.y - 27}">${f.side.toUpperCase()}</text>` : ""}`;
    }
    const level = f.kind === "section" ? f.surfaceId === "lower-bowl" ? "lower" : "upper" : "";
    return `<g class="stadium-feature feature-${f.kind} ${level}" data-feature="${f.id}" role="button" tabindex="0" aria-label="${f.name}" aria-pressed="false"><title>${f.name}</title>${shape}</g>`;
  }

  private visible(f: StadiumFeature): boolean {
    return featureOnLayer(f, this.layer) && (this.showConnections || f.kind !== "connector");
  }

  private updateVisibility() {
    for (const f of STADIUM_FEATURES) {
      this.svg.querySelector(`[data-feature="${f.id}"]`)!.toggleAttribute("hidden", !this.visible(f));
    }
    this.root.querySelectorAll<HTMLElement>("[data-layer]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.layer === this.layer)));
    this.root.querySelector("#stadium-layer-description")!.textContent = STADIUM_LAYERS.find(l => l.id === this.layer)!.description;
    this.svg.querySelector("[data-context=upper]")!.toggleAttribute("hidden", this.layer !== "overview" && this.layer !== "upper");
    this.svg.querySelector("#stadium-concourse-ring")!.classList.toggle("muted", this.layer === "lower" || this.layer === "upper");
    this.picker.innerHTML = `<option value="">Choose a feature…</option>` + STADIUM_FEATURES.filter(f => this.visible(f)).map(f => `<option value="${f.id}">${f.name}</option>`).join("");
    this.select(this.selected && this.visible(this.selected) ? this.selected.id : undefined);
    this.routes.setLayer(this.layer, this.showConnections);
  }

  private select(id?: string) {
    this.selected = STADIUM_FEATURES.find(f => f.id === id && this.visible(f));
    this.picker.value = this.selected?.id ?? "";
    this.svg.querySelectorAll<SVGGElement>("[data-feature]").forEach(el => el.setAttribute("aria-pressed", String(el.dataset.feature === this.selected?.id)));
    this.routes.inspectFeature(this.selected);
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

  private updateView() {
    this.view.x = Math.max(0, Math.min(STADIUM.width - this.view.width, this.view.x));
    this.view.y = Math.max(0, Math.min(STADIUM.height - this.view.height, this.view.y));
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
