import { Experiment } from "../simulation/Experiment";
import { LayoutEditor, type EditTool, type EditResult } from "../simulation/LayoutEditor";
import type { ExitId } from "../config/simulationConfig";
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
  private exitSelect: HTMLSelectElement;
  constructor(private experiment: Experiment, private canvas: HTMLCanvasElement) {
    this.model = new LayoutEditor(experiment.simulation);
    this.lastGrid = experiment.simulation.grid;
    document.querySelector("#editor")!.innerHTML = `
      <div class="editor-heading"><strong>Layout editor</strong><span id="layout-state">Original layout</span></div>
      <div class="editor-tools" role="group" aria-label="Drawing tools">
        <button data-tool="inspect" aria-pressed="true">Inspect</button><button data-tool="wall" aria-pressed="false">Draw wall</button><button data-tool="floor" aria-pressed="false">Erase wall</button><button data-tool="exit" aria-pressed="false">Add exit</button>
      </div>
      <div class="editor-actions"><div><label for="editor-exit">Exit to place</label><select id="editor-exit"><option value="new">New exit</option></select></div><button id="undo-edit">Undo edit</button><button id="restore-layout">Restore original layout</button></div>
      <p id="editor-help" class="field-help">Choose a tool to pause. Click or drag across cells; release to apply. Add exits in clear floor or wall cells; select an existing exit to widen it. With the canvas focused, use arrow keys and Space to edit. Escape cancels a stroke.</p>
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
      this.report(this.model.undo());
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
  private apply(cells: GridPosition[]) {
    if (!this.canEdit() || this.tool === "inspect") return;
    this.report(this.model.apply(this.tool, cells, this.exitSelect.value as ExitId | "new"));
    this.lastGrid = this.experiment.simulation.grid;
    this.update();
  }
  private report(result: EditResult) {
    const message = document.querySelector<HTMLElement>("#editor-message")!;
    message.textContent = result.message;
    message.classList.toggle("error", !result.ok);
  }
  update() {
    const s = this.experiment.simulation;
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
    if (!this.canEdit()) return;
    const grid = this.experiment.simulation.grid, size = grid.cellSize;
    const cells = this.stroke.size ? Array.from(this.stroke.values()) : this.cursor ? [this.cursor] : [];
    ctx.save();
    ctx.fillStyle = this.tool === "wall" ? "#efb36d66" : this.tool === "exit" ? "#67dec166" : "#b9d7ff66";
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
