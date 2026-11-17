import { Experiment } from "../simulation/Experiment";
import { LayoutEditor, isZoneTool, type EditTool, type EditResult } from "../simulation/LayoutEditor";
import type { ExitId } from "../config/simulationConfig";
import { MAPS } from "../maps/maps";
import { parseLayout, serializeLayout } from "../simulation/LayoutFile";
import type { GridPosition } from "../utils/Vector2";

/** Canvas coordinates are converted from CSS pixels so editing also works on small screens. */
export class Editor {
  private model: LayoutEditor;
  private tool: EditTool | "inspect" = "inspect";
  private stroke = new Map<string, GridPosition>();
  private pointer: number | null = null;
  private cursor: GridPosition | null = null;
  private lastCell: GridPosition | null = null;
  private lastGrid;
  private wasRunning = false;
  private signature = "";
  /** Crowd size the user asked for; start zones may hold fewer, and grow back to it as zones grow. */
  private requestedCount: number;
  private lastSetCount: number;
  private exitSelect: HTMLSelectElement;
  constructor(private experiment: Experiment, private canvas: HTMLCanvasElement) {
    this.model = new LayoutEditor(experiment.simulation);
    this.lastGrid = experiment.simulation.grid;
    this.requestedCount = this.lastSetCount = experiment.simulation.agentCount;
    document.querySelector("#editor")!.innerHTML = `
      <div class="editor-heading"><strong>Layout editor</strong><span id="layout-state">Original layout</span></div>
      <div class="editor-tools" role="group" aria-label="Drawing tools">
        <button data-tool="inspect" aria-pressed="true">Inspect</button><button data-tool="wall" aria-pressed="false">Draw wall</button><button data-tool="floor" aria-pressed="false">Erase wall</button><button data-tool="exit" aria-pressed="false">Add exit</button><button data-tool="obstacle" aria-pressed="false">Place furniture</button><button data-tool="spawn" aria-pressed="false">Paint start zone</button><button data-tool="unspawn" aria-pressed="false">Erase start zone</button>
      </div>
      <div class="editor-actions"><div><label for="editor-exit">Exit to place</label><select id="editor-exit"><option value="new">New exit</option></select></div><button id="undo-edit">Undo edit</button><button id="restore-layout">Restore original layout</button></div>
      <div class="editor-files"><button id="save-layout" type="button">Save layout</button><button id="load-layout" type="button">Load layout</button><input id="layout-file" type="file" accept=".json,application/json" hidden></div>
      <p id="editor-help" class="field-help">Choose a tool to pause. Click or drag across cells; release to apply. Erase wall also removes furniture. Furniture blocks walking like a wall but is drawn lower in 3D. Once you paint a start zone, people start only inside start zones. Add exits in clear floor or wall cells; select an existing exit to widen it. With the canvas focused, use arrow keys and Space to edit. Escape cancels a stroke. Save layout downloads a .json file you can load again later.</p>
      <p id="editor-message" role="status">Edits keep every floor area connected to an open exit.</p>`;
    this.exitSelect = document.querySelector<HTMLSelectElement>("#editor-exit")!;
    for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>("[data-tool]")))
      button.addEventListener("click", () => {
        this.cancelStroke();
        this.tool = button.dataset.tool as EditTool | "inspect";
        if (this.tool !== "inspect") experiment.pause();
        this.update();
      });
    this.exitSelect.addEventListener("change", () => this.cancelStroke());
    document.querySelector("#undo-edit")!.addEventListener("click", () => {
      this.cancelStroke();
      const zones = experiment.simulation.grid.spawnZones.join("");
      const result = this.model.undo();
      const s = experiment.simulation;
      if (result.ok && (s.grid.spawnZones.join("") !== zones || s.agentCount > s.populationLimit())) this.fitCrowd(result);
      this.report(result);
      this.lastGrid = experiment.simulation.grid;
      this.update();
    });
    document.querySelector("#restore-layout")!.addEventListener("click", () => {
      experiment.simulation.restoreOriginalLayout();
      experiment.restart();
      this.model.clearHistory();
      this.cancelStroke();
      this.report({ ok: true, message: "Original layout restored and crowd reset." });
      this.update();
    });
    document.querySelector("#save-layout")!.addEventListener("click", () => this.save());
    const fileInput = document.querySelector<HTMLInputElement>("#layout-file")!;
    document.querySelector("#load-layout")!.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", () => {
      const file = fileInput.files?.[0];
      fileInput.value = "";
      if (file) void this.load(file);
    });
    canvas.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || this.pointer !== null || !this.canEdit()) return;
      event.preventDefault();
      canvas.focus({ preventScroll: true });
      this.pointer = event.pointerId;
      canvas.setPointerCapture(event.pointerId);
      this.addCell(this.cellAt(event));
    });
    canvas.addEventListener("pointermove", (event) => {
      this.cursor = this.cellAt(event);
      if (this.pointer === event.pointerId) this.addCell(this.cursor);
    });
    canvas.addEventListener("pointerup", (event) => {
      if (this.pointer !== event.pointerId) return;
      this.addCell(this.cellAt(event));
      const cells = Array.from(this.stroke.values());
      this.cancelStroke();
      this.apply(cells);
    });
    canvas.addEventListener("pointercancel", () => this.cancelStroke());
    canvas.addEventListener("lostpointercapture", () => this.cancelStroke());
    canvas.addEventListener("pointerleave", () => { if (this.pointer === null) this.cursor = null; });
    canvas.addEventListener("keydown", (event) => {
      if (event.key === "Escape") { this.cancelStroke(); return; }
      if (!this.canEdit()) return;
      const moves: Record<string, GridPosition> = { ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }, ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 } };
      const grid = experiment.simulation.grid;
      if (moves[event.key]) {
        event.preventDefault();
        const p = this.cursor ?? { x: 2, y: 2 }, d = moves[event.key];
        this.cursor = { x: Math.max(1, Math.min(grid.width - 2, p.x + d.x)), y: Math.max(1, Math.min(grid.height - 2, p.y + d.y)) };
      } else if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        this.apply([this.cursor ?? { x: 2, y: 2 }]);
      }
    });
  }
  private canEdit() {
    return this.tool !== "inspect" && !this.experiment.simulation.running && this.experiment.screen === "simulation";
  }
  private cellAt(event: PointerEvent): GridPosition {
    const rect = this.canvas.getBoundingClientRect(), grid = this.experiment.simulation.grid;
    return { x: Math.floor((event.clientX - rect.left) / rect.width * grid.width), y: Math.floor((event.clientY - rect.top) / rect.height * grid.height) };
  }
  private addCell(p: GridPosition) {
    // Fill gaps between events with a cardinal staircase so dragged exits stay connected.
    const from = this.lastCell ?? p;
    let x = from.x, y = from.y;
    const dx = Math.abs(p.x - x), dy = Math.abs(p.y - y);
    let ix = 0, iy = 0;
    this.stroke.set(`${x},${y}`, { x, y });
    while (ix < dx || iy < dy) {
      if (ix < dx && (iy === dy || (ix + 0.5) * dy < (iy + 0.5) * dx)) { x += Math.sign(p.x - from.x); ix++; }
      else { y += Math.sign(p.y - from.y); iy++; }
      this.stroke.set(`${x},${y}`, { x, y });
    }
    this.lastCell = p;
    this.cursor = p;
  }
  private cancelStroke() {
    if (this.pointer !== null && this.canvas.hasPointerCapture(this.pointer)) this.canvas.releasePointerCapture(this.pointer);
    this.pointer = null;
    this.stroke.clear();
    this.lastCell = null;
  }
  /**
   * Start zones decide where people start, so a zone change resets the crowd into the
   * new zones, sized to what they hold (up to the size the user asked for).
   */
  private fitCrowd(result: EditResult) {
    const e = this.experiment, s = e.simulation;
    const target = Math.min(this.requestedCount, s.populationLimit());
    s.agentCount = target;
    this.lastSetCount = target;
    document.querySelector<HTMLInputElement>("#population")!.value = String(target);
    e.restart(false);
    this.model.rebase();
    result.message += " Crowd reset into the start zones.";
    if (target < this.requestedCount)
      result.message += ` They hold ${target} of the ${this.requestedCount} people requested; paint more zone to fit more.`;
  }
  private apply(cells: GridPosition[]) {
    if (!this.canEdit() || this.tool === "inspect") return;
    const tool = this.tool;
    const result = this.model.apply(tool, cells, this.exitSelect.value as ExitId | "new");
    if (result.ok && isZoneTool(tool)) this.fitCrowd(result);
    this.report(result);
    this.lastGrid = this.experiment.simulation.grid;
    this.update();
  }
  private save() {
    const s = this.experiment.simulation;
    const url = URL.createObjectURL(new Blob([serializeLayout(s.grid, s.mapId)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `evacuation-lab-${s.mapId}-layout.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    this.report({ ok: true, message: `Layout saved as ${link.download}.` });
  }
  /** Loads a saved layout, switching to its map if needed, and resets the crowd on it. */
  async load(file: File) {
    this.cancelStroke();
    const e = this.experiment, s = e.simulation;
    let loaded;
    try {
      loaded = parseLayout(await file.text());
    } catch (error) {
      this.report({ ok: false, message: (error as Error).message });
      return;
    }
    const issue = s.layoutConnectivityIssue(loaded.grid);
    if (issue) { this.report({ ok: false, message: `This layout cannot be used: ${issue}` }); return; }
    const limit = s.populationLimit(loaded.mapId, loaded.grid);
    if (limit < 1) { this.report({ ok: false, message: "This layout has no free floor where people can start." }); return; }
    const requested = s.agentCount, count = Math.min(requested, limit);
    e.pause();
    s.mapId = loaded.mapId;
    s.agentCount = count;
    s.loadCustomLayout(loaded.grid);
    e.restart(false);
    this.requestedCount = this.lastSetCount = count;
    this.model.clearHistory();
    this.tool = "inspect";
    this.lastGrid = s.grid;
    document.querySelector<HTMLSelectElement>("#map")!.value = s.mapId;
    document.querySelector<HTMLInputElement>("#population")!.value = String(s.agentCount);
    const reduced = count < requested ? ` (reduced from ${requested} to fit this layout's spawn space)` : "";
    this.report({ ok: true, message: `Loaded ${file.name} on ${MAPS[s.mapId].name}. Crowd reset to ${count} people${reduced}.` });
    this.update();
  }
  private report(result: EditResult) {
    const message = document.querySelector<HTMLElement>("#editor-message")!;
    message.textContent = result.message;
    message.classList.toggle("error", !result.ok);
  }
  update() {
    const s = this.experiment.simulation;
    // A crowd size set elsewhere (controls, setup, loading) becomes the new request.
    if (s.agentCount !== this.lastSetCount) this.requestedCount = this.lastSetCount = s.agentCount;
    if (s.running && !this.wasRunning) {
      this.model.clearHistory();
      this.tool = "inspect";
      this.cancelStroke();
    }
    if (this.lastGrid !== s.grid || this.experiment.screen !== "simulation") {
      this.cancelStroke();
      this.cursor = null;
      this.lastGrid = s.grid;
    }
    this.wasRunning = s.running;
    const ids = s.grid.exitIds, signature = ids.join(",");
    if (signature !== this.signature) {
      this.signature = signature;
      const selected = this.exitSelect.value;
      this.exitSelect.innerHTML = `<option value="new">New exit${ids.length === 8 ? " (limit reached)" : ""}</option>` + ids.map((id) => `<option value="${id}">Widen Exit ${id}</option>`).join("");
      this.exitSelect.value = selected === "new" || ids.includes(selected as ExitId) ? selected : "new";
    }
    this.exitSelect.disabled = this.tool !== "exit";
    for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>("[data-tool]")))
      button.setAttribute("aria-pressed", String(button.dataset.tool === this.tool));
    this.canvas.classList.toggle("editing", this.canEdit());
    document.querySelector<HTMLButtonElement>("#undo-edit")!.disabled = s.running || !this.model.canUndo;
    document.querySelector<HTMLButtonElement>("#restore-layout")!.disabled = !s.hasCustomLayout;
    document.querySelector("#layout-state")!.textContent = `${s.hasCustomLayout ? "Edited" : "Original"} layout · ${ids.length} exits`;
  }
  render(ctx: CanvasRenderingContext2D) {
    const s = this.experiment.simulation, grid = s.grid, size = grid.cellSize;
    // Start zones show while editing and before a run starts.
    if (grid.hasSpawnZones && (this.canEdit() || (s.time === 0 && !s.running))) {
      ctx.save();
      ctx.fillStyle = "#7fb6ff22";
      ctx.strokeStyle = "#7fb6ffaa";
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = 1;
      for (let y = 0; y < grid.height; y++)
        for (let x = 0; x < grid.width; x++) {
          if (!grid.spawnZones[grid.index(x, y)]) continue;
          ctx.fillRect(x * size, y * size, size, size);
          for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]])
            if (!grid.inside(x + dx, y + dy) || !grid.spawnZones[grid.index(x + dx, y + dy)]) {
              ctx.beginPath();
              const x0 = (x + (dx > 0 ? 1 : 0)) * size, y0 = (y + (dy > 0 ? 1 : 0)) * size;
              ctx.moveTo(x0, y0);
              ctx.lineTo(dx === 0 ? x0 + size : x0, dy === 0 ? y0 + size : y0);
              ctx.stroke();
            }
        }
      ctx.restore();
    }
    if (!this.canEdit()) return;
    const cells = this.stroke.size ? Array.from(this.stroke.values()) : this.cursor ? [this.cursor] : [];
    ctx.save();
    ctx.fillStyle = { wall: "#efb36d66", exit: "#67dec166", obstacle: "#c49a6c88", spawn: "#7fb6ff66", unspawn: "#ef735c55", floor: "#b9d7ff66", inspect: "#b9d7ff66" }[this.tool];
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.5;
    for (const p of cells) {
      if (!grid.inside(p.x, p.y)) continue;
      ctx.fillRect(p.x * size, p.y * size, size, size);
      ctx.strokeRect(p.x * size + 1, p.y * size + 1, size - 2, size - 2);
    }
    ctx.restore();
  }
}
