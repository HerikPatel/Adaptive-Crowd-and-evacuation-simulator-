import { EXIT_IDS, type ExitId } from "../config/simulationConfig";
import { Grid, CellType } from "./Grid";
import type { Simulation } from "./Simulation";
import type { GridPosition } from "../utils/Vector2";
import { clamp } from "../utils/math";

export type EditTool = "wall" | "floor" | "exit";
export interface EditResult { ok: boolean; message: string; }

/** Each drag is validated as one transaction; a rejected stroke changes nothing. */
export class LayoutEditor {
  private history: Grid[] = [];
  private current: Grid;
  constructor(private simulation: Simulation) { this.current = simulation.grid; }
  get canUndo() { this.sync(); return this.history.length > 0; }
  clearHistory() { this.history = []; this.current = this.simulation.grid; }
  private sync() {
    if (this.current !== this.simulation.grid) this.clearHistory();
  }
  private validate(grid: Grid): string | null {
    const s = this.simulation;
    for (const a of s.agents)
      if (!a.evacuated && s.collision.intersectsWall(a.position, a.radius, grid))
        return "A wall would overlap an agent. Choose another cell.";
    const issue = s.layoutConnectivityIssue(grid);
    if (issue) return issue;
    if (s.populationLimit(s.mapId, grid.cloneLayout(false)) < s.agentCount)
      return "This edit leaves too little spawn space for the selected crowd size.";
    return null;
  }
  apply(tool: EditTool, cells: GridPosition[], requestedExit: ExitId | "new" = "new"): EditResult {
    this.sync();
    const s = this.simulation;
    if (s.running) return { ok: false, message: "Pause before editing the layout." };
    if (s.metrics.remainingAgents === 0) return { ok: false, message: "Reset the run before editing." };
    const grid = s.grid.cloneLayout();
    const id = requestedExit === "new" ? EXIT_IDS.find((id) => !grid.exitIds.includes(id)) : requestedExit;
    if (tool === "exit" && (!id || !EXIT_IDS.includes(id)))
      return { ok: false, message: "This layout already has eight exits. Select an existing exit to widen it." };
    let changed = false;
    for (const p of cells) {
      if (!Number.isInteger(p.x) || !Number.isInteger(p.y) ||
          p.x <= 0 || p.y <= 0 || p.x >= grid.width - 1 || p.y >= grid.height - 1)
        return { ok: false, message: "Keep edits inside the outer boundary of the map." };
      const existing = grid.exitAt(p.x, p.y);
      if (existing && !(tool === "exit" && existing === id))
        return { ok: false, message: `Exit ${existing} occupies this cell. Choose another cell.` };
      if (tool === "exit") {
        for (const a of s.agents) {
          if (a.evacuated) continue;
          const size = grid.cellSize;
          const dx = a.position.x - clamp(a.position.x, p.x * size, (p.x + 1) * size);
          const dy = a.position.y - clamp(a.position.y, p.y * size, (p.y + 1) * size);
          if (dx * dx + dy * dy < a.radius * a.radius)
            return { ok: false, message: "An agent occupies this cell. Place the exit in a clear cell." };
        }
      }
      const type = tool === "wall" ? CellType.Wall : tool === "floor" ? CellType.Walkable : CellType.ExitA + EXIT_IDS.indexOf(id!);
      if (grid.cells[grid.index(p.x, p.y)] !== type) changed = true;
      grid.cells[grid.index(p.x, p.y)] = type;
    }
    if (!changed) return { ok: false, message: "No cells changed." };
    // One label identifies one contiguous opening, even when extended by dragging.
    if (tool === "exit") {
      const opening = grid.exits(id!, true);
      const seen = new Set<number>();
      const queue = [opening[0]];
      for (let i = 0; i < queue.length; i++) {
        const p = queue[i], key = grid.index(p.x, p.y);
        if (seen.has(key)) continue;
        seen.add(key);
        for (const q of [{x:p.x+1,y:p.y},{x:p.x-1,y:p.y},{x:p.x,y:p.y+1},{x:p.x,y:p.y-1}])
          if (grid.exitAt(q.x, q.y) === id && !seen.has(grid.index(q.x,q.y))) queue.push(q);
      }
      if (seen.size !== opening.length)
        return { ok: false, message: `Extend Exit ${id} beside its existing cells, or choose New exit.` };
      if (!opening.some((p) => grid.neighbors(p).some((q) => !grid.exitAt(q.x, q.y))))
        return { ok: false, message: "Connect the exit to an open floor cell so agents can reach it." };
    }
    const issue = this.validate(grid);
    if (issue) return { ok: false, message: issue };
    this.history.push(s.grid.cloneLayout());
    if (this.history.length > 50) this.history.shift();
    s.applyEditedLayout(grid);
    this.current = grid;
    return { ok: true, message: tool === "exit" ? `Exit ${id} added or widened. Routes will update on Start.` : "Layout updated. Routes will update on Start." };
  }
  undo(): EditResult {
    this.sync();
    if (this.simulation.running) return { ok: false, message: "Pause before undoing edits." };
    const previous = this.history.at(-1)?.cloneLayout(false);
    if (!previous) return { ok: false, message: "No edits to undo." };
    for (const id of this.simulation.grid.blockedExits)
      if (previous.exitIds.includes(id)) previous.blockedExits.add(id);
    const issue = this.validate(previous);
    if (issue) return { ok: false, message: issue };
    this.history.pop();
    this.simulation.applyEditedLayout(previous);
    this.current = previous;
    return { ok: true, message: "Last edit undone." };
  }
}
