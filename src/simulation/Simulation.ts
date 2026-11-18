import { CONFIG, FIRE, type ExitId, type RoutingMode, type MovementMode, type PathAlgorithm } from "../config/simulationConfig";
import { createMvpMap } from "../maps/mvpMap";
import { MAPS, type MapId } from "../maps/maps";
import { CongestionRouter } from "../pathfinding/CongestionRouter";
import { lineOfSight } from "../pathfinding/algorithms";
import { Density } from "./Density";
import { Metrics } from "./Metrics";
import { distance } from "../utils/Vector2";
import { seededRandom } from "../utils/math";
import { CollisionSystem } from "../collision/CollisionSystem";
import { OrcaSolver } from "../collision/OrcaSolver";
import { SpatialHash } from "./SpatialHash";
import { Agent } from "./Agent";
import { Grid } from "./Grid";
export class Simulation {
  grid = createMvpMap();
  agents: Agent[] = [];
  time = 0;
  running = false;
  mode: RoutingMode = "congestion";
  movementMode: MovementMode = "predictive";
  algorithm: PathAlgorithm = "astar";
  orca = new OrcaSolver();
  density = new Density();
  router = new CongestionRouter();
  hash = new SpatialHash<Agent>(CONFIG.spatialCellSize);
  collision = new CollisionSystem();
  replanQueue: Agent[] = [];
  routeSwitchCount = 0;
  metrics = new Metrics(0);
  private customLayouts = new Map<MapId, Grid>();
  get hasCustomLayout() { return this.customLayouts.has(this.mapId); }
  layoutFor(mapId: MapId = this.mapId): Grid {
    return this.customLayouts.get(mapId)?.cloneLayout(false) ?? MAPS[mapId].create();
  }
  spawnSlots(grid: Grid, mapId: MapId = this.mapId) {
    const slots: { x: number; y: number }[] = [];
    if (grid.hasSpawnZones) {
      // Painted start zones replace the preset areas; same 12 px lattice, so spacing is unchanged.
      for (let y = 6; y < grid.height * grid.cellSize; y += 12)
        for (let x = 6; x < grid.width * grid.cellSize; x += 12) {
          const p = { x, y }, cell = grid.cell(p);
          if (grid.spawnZones[grid.index(cell.x, cell.y)] && !grid.exitAt(cell.x, cell.y) &&
              !this.collision.intersectsWall(p, CONFIG.agentRadius + 1, grid))
            slots.push(p);
        }
      return slots;
    }
    for (const area of MAPS[mapId].spawnAreas)
      for (let y = area.y1; y <= area.y2; y += 12)
        for (let x = area.x1; x <= area.x2; x += 12) {
          const p = { x, y }, cell = grid.cell(p);
          if (!grid.exitAt(cell.x, cell.y) &&
              !this.collision.intersectsWall(p, CONFIG.agentRadius + 1, grid))
            slots.push(p);
        }
    return slots;
  }
  populationLimit(mapId: MapId = this.mapId, grid = this.layoutFor(mapId)) {
    return Math.min(CONFIG.maxPopulation, this.spawnSlots(grid, mapId).length);
  }
  validatePopulation(count: number, mapId: MapId = this.mapId, grid = this.layoutFor(mapId)) {
    const limit = this.populationLimit(mapId, grid);
    if (!Number.isInteger(count) || count < 1 || count > limit)
      throw new Error(`Choose a whole-number crowd size from 1 to ${limit} for this layout.`);
  }
  constructor(
    public agentCount = 100,
    public mapId: MapId = "mvp",
  ) {
    this.reset();
  }
  reset() {
    const grid = this.layoutFor();
    this.validatePopulation(this.agentCount, this.mapId, grid);
    this.grid = grid;
    this.time = 0;
    this.running = false;
    this.agents = [];
    this.replanQueue = [];
    this.routeSwitchCount = 0;
    this.density = new Density();
    this.orca = new OrcaSolver();
    this.router = new CongestionRouter();
    this.metrics = new Metrics(this.agentCount, this.grid.exitIds);
    const random = seededRandom(CONFIG.seed),
      slots = this.spawnSlots(this.grid);
    for (let i = slots.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [slots[i], slots[j]] = [slots[j], slots[i]];
    }
    for (let i = 0; i < this.agentCount; i++) {
      const p = slots[i];
      if (!p) throw new Error("Agent count exceeds spawn capacity");
      const a = new Agent(
        i,
        { x: p.x + (random() - 0.5), y: p.y + (random() - 0.5) },
        CONFIG.baseSpeed * (0.9 + 0.2 * random()),
        random() * CONFIG.replanJitter,
      );
      this.agents.push(a);
      this.enqueue(a);
    }
    this.rebuildHash();
  }
  rebuildHash() {
    this.hash.clear();
    for (const a of this.agents) if (!a.evacuated) this.hash.insert(a);
  }
  enqueue(a: Agent) {
    if (!a.queued && !a.evacuated) {
      a.queued = true;
      this.replanQueue.push(a);
    }
  }
  setExitABlocked(blocked: boolean) {
    return this.setExitBlocked("A", blocked);
  }
  /** `retry` marks a temporary refusal (someone is in the doorway) that may succeed a moment later. */
  setExitBlocked(id: ExitId, blocked: boolean): { ok: boolean; message: string; retry?: boolean } {
    if (!this.grid.exitIds.includes(id)) return { ok: false, message: `Exit ${id} does not exist.` };
    if (blocked === this.grid.blockedExits.has(id)) return { ok: true, message: "" };
    const candidate = this.grid.cloneLayout();
    candidate.setExitBlocked(id, blocked);
    const relocated = new Map<number, { x: number; y: number }>();
    if (blocked) {
      const issue = this.layoutConnectivityIssue(candidate);
      if (issue) return { ok: false, message: issue };
      for (const a of this.agents) {
        if (a.evacuated) continue;
        if (!this.collision.intersectsWall(a.position, a.radius, candidate)) continue;
        const fits = (p: { x: number; y: number }) => this.agents.every(b => b === a || b.evacuated || distance(p, relocated.get(b.id) ?? b.position) >= a.radius + b.radius + 0.02);
        const p = this.collision.resolveDoorClosure(a.position, a.radius, candidate, fits);
        if (this.collision.intersectsWall(p, a.radius, candidate) || !fits(p))
          return { ok: false, retry: true, message: "An agent is in this doorway. Try again after it moves." };
        relocated.set(a.id, p);
      }
    }
    this.grid.setExitBlocked(id, blocked);
    if (blocked) {
      const urgent: Agent[] = [];
      for (const a of this.agents) {
        if (a.evacuated) continue;
        // Closing a door may touch a circle whose center has not yet evacuated.
        // Move it the minimum distance back onto the approach before replanning.
        if (relocated.has(a.id)) a.position = relocated.get(a.id)!;
        if (a.targetExit === id || a.path.slice(a.pathIndex).some((p) => this.grid.exitAt(p.x, p.y) === id)) {
          a.path = [];
          a.pathIndex = 0;
          a.velocity = { x: 0, y: 0 };
          a.reroutingUntil = this.time + 1.5;
          urgent.push(a);
        }
      }
      const ids = new Set(urgent.map((a) => a.id));
      this.replanQueue = [
        ...urgent,
        ...this.replanQueue.filter((a) => !ids.has(a.id)),
      ];
      for (const a of urgent) a.queued = true;
    }
    return { ok: true, message: `Exit ${id} ${blocked ? "blocked" : "reopened"}.` };
  }
  layoutConnectivityIssue(grid: Grid): string | null {
    if (!grid.exitIds.some((id) => !grid.blockedExits.has(id)))
      return "Keep at least one exit open.";
    const reachable = grid.reachableFromExits();
    for (let y = 0; y < grid.height; y++)
      for (let x = 0; x < grid.width; x++)
        if (grid.walkable(x, y) && !reachable[grid.index(x, y)])
          return "This change would cut off an area from every open exit.";
    return null;
  }
  applyEditedLayout(grid: Grid) {
    this.customLayouts.set(this.mapId, grid.cloneLayout(false));
    this.grid = grid;
    const peak = this.density.peak;
    this.density = new Density();
    this.density.peak = peak;
    for (const id of grid.exitIds) this.metrics.addExit(id);
    for (const [id, record] of this.metrics.byExit)
      if (!grid.exitIds.includes(id) && record.count === 0) this.metrics.byExit.delete(id);
    this.replanQueue = [];
    for (const a of this.agents) {
      a.path = [];
      a.pathIndex = 0;
      a.velocity = { x: 0, y: 0 };
      a.queued = false;
      a.nextReplanTime = 0;
      this.enqueue(a);
    }
    this.rebuildHash();
  }
  /** Stores a layout from a saved file as this map's custom layout; call reset() to use it. */
  loadCustomLayout(grid: Grid) {
    this.customLayouts.set(this.mapId, grid.cloneLayout(false));
  }
  /**
   * After fire spreads into `cells`, anyone whose remaining route passes through
   * or right beside them replans immediately, like the people heading for a closed exit.
   */
  rerouteAround(cells: number[]) {
    const g = this.grid, burnt = new Set(cells), urgent: Agent[] = [];
    const near = (x: number, y: number) => {
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) if (g.inside(x + dx, y + dy) && burnt.has(g.index(x + dx, y + dy))) return true;
      return false;
    };
    for (const a of this.agents) {
      if (a.evacuated) continue;
      let prev = g.cell(a.position), hit = false;
      for (let i = a.pathIndex; i < a.path.length && !hit; i++) {
        const p = a.path[i], steps = Math.max(1, Math.ceil(Math.hypot(p.x - prev.x, p.y - prev.y) * 2));
        for (let k = 1; k <= steps && !hit; k++)
          hit = near(Math.round(prev.x + ((p.x - prev.x) * k) / steps), Math.round(prev.y + ((p.y - prev.y) * k) / steps));
        prev = p;
      }
      if (!hit) continue;
      a.path = [];
      a.pathIndex = 0;
      a.reroutingUntil = this.time + 1.5;
      urgent.push(a);
    }
    const ids = new Set(urgent.map((a) => a.id));
    this.replanQueue = [...urgent, ...this.replanQueue.filter((a) => !ids.has(a.id))];
    for (const a of urgent) a.queued = true;
  }
  restoreOriginalLayout() {
    this.customLayouts.delete(this.mapId);
    this.reset();
  }
  processReplans() {
    let processed = 0;
    while (this.replanQueue.length && processed < CONFIG.maxReplansPerStep) {
      const a = this.replanQueue.shift()!;
      a.queued = false;
      if (a.evacuated) continue;
      processed++;
      const route = this.router.plan(a, this.grid, this.mode, this.time, this.algorithm);
      if (route) {
        if (a.targetExit && a.targetExit !== route.targetExit) {
          this.routeSwitchCount++;
          a.reroutingUntil = this.time + 1.5;
        }
        a.path = route.path;
        a.pathIndex = 0;
        a.targetExit = route.targetExit;
        a.lastPathCost = route.totalCost;
      }
      a.lastReplanTime = this.time;
      a.nextReplanTime = this.time + CONFIG.replanInterval + a.replanOffset;
    }
  }
  update(dt: number) {
    if (!this.running) return;
    this.time += dt;
    this.rebuildHash();
    this.density.update(this.grid, this.hash, dt);
    // Seeded offsets and bounded work prevent synchronized herding. Cooldowns are
    // simulation time, independent of rendering speed; urgent closures bypass them.
    for (const a of this.agents)
      if (!a.evacuated && this.time >= a.nextReplanTime) this.enqueue(a);
    this.processReplans();
    const movements: { agent: Agent; position: { x: number; y: number } }[] =
      [];
    // Smoke slows walkers; outside a fire scenario hazard is zero and speeds are unchanged.
    for (const a of this.agents) {
      if (a.evacuated) continue;
      const c = this.grid.cell(a.position);
      const smoke = this.grid.inside(c.x, c.y) ? this.grid.hazard[this.grid.index(c.x, c.y)] : 0;
      a.speed = a.baseSpeed * (1 - (1 - FIRE.smokeSpeedFactor) * smoke);
    }
    const maxSpeed = Math.max(0, ...this.agents.filter(a => !a.evacuated).map(a => a.speed));
    for (const a of this.agents) {
      if (a.evacuated) continue;
      // Visible local lookahead prevents crowds from fighting for one exact cell
      // center. Circle-swept visibility preserves corner/wall clearance.
      // A lateral avoidance maneuver must not force a return to an already bypassed
      // corner center. Follow the furthest visible nearby point on the committed path.
      const startIndex = a.pathIndex;
      for (let i = startIndex + 1; i < Math.min(a.path.length, startIndex + 7); i++) {
        const next = this.grid.center(a.path[i]);
        if (distance(a.position, next) <= 3 * this.grid.cellSize && this.collision.canTravel(a.position, next, a.radius, this.grid)) a.pathIndex = i;
      }
      // Any-angle (Theta*) routes all hug the same corners. Advance as soon as the
      // following waypoint is in line of sight instead of crowding the exact corner point.
      if (this.algorithm === "thetastar" && this.mode !== "flow-field") {
        const here = this.grid.cell(a.position);
        while (a.pathIndex + 1 < a.path.length && this.grid.walkable(here.x, here.y) &&
               lineOfSight(this.grid, here, a.path[a.pathIndex + 1])) a.pathIndex++;
      }
      const node = a.path[a.pathIndex];
      const goal = node ? this.grid.center(node) : null;
      const reached = goal && distance(a.position, goal) < CONFIG.waypointThreshold;
      if (reached) {
        a.pathIndex++;
      }
      if ((!goal || reached) && this.movementMode === "predictive") continue;
      const desired = goal && !reached ? this.collision.direction(a, goal) : { x: 0, y: 0 };
      const velocity = this.movementMode === "orca"
        ? this.orca.velocity(a, desired, this.hash, this.grid, dt, maxSpeed)
        : this.collision.velocity(
        a,
        desired,
        this.hash,
        this.grid,
        Math.round(this.time / CONFIG.fixedDt),
      );
      movements.push({
        agent: a,
        position: this.collision.move(a, velocity, dt, this.grid),
      });
    }
    // Compute from a shared snapshot before committing positions (no stale hash buckets).
    for (const { agent: a, position } of this.collision.reserveMovements(movements, this.agents, this.hash, this.grid, dt, Math.round(this.time / CONFIG.fixedDt), this.movementMode === "orca")) {
      a.velocity = { x: (position.x - a.position.x) / dt, y: (position.y - a.position.y) / dt };
      a.stalledSeconds = Math.hypot(a.velocity.x, a.velocity.y) < 0.1 * a.speed ? a.stalledSeconds + dt : 0;
      a.position = position;
      const cell = this.grid.cell(a.position),
        exit = this.grid.exitAt(cell.x, cell.y);
      if (exit && !this.grid.blockedExits.has(exit)) {
        a.evacuated = true;
        a.evacuationTime = this.time;
        a.velocity = { x: 0, y: 0 };
        this.metrics.recordEvacuation(exit, this.time);
      }
    }
    if (this.agents.every((a) => a.evacuated)) this.running = false;
    this.metrics.update(this.time, this.density.peak, this.routeSwitchCount);
  }
}
