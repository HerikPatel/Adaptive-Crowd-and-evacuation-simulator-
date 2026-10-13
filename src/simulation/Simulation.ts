import { CONFIG, type RoutingMode } from "../config/simulationConfig";
import { createMvpMap } from "../maps/mvpMap";
import { MAPS, type MapId } from "../maps/maps";
import { CongestionRouter } from "../pathfinding/CongestionRouter";
import { Density } from "./Density";
import { Metrics } from "./Metrics";
import { distance } from "../utils/Vector2";
import { seededRandom } from "../utils/math";
import { CollisionSystem } from "../collision/CollisionSystem";
import { SpatialHash } from "./SpatialHash";
import { Agent } from "./Agent";
import { CellType } from "./Grid";
export class Simulation {
  grid = createMvpMap();
  agents: Agent[] = [];
  time = 0;
  running = false;
  mode: RoutingMode = "congestion";
  density = new Density();
  router = new CongestionRouter();
  hash = new SpatialHash<Agent>(CONFIG.spatialCellSize);
  collision = new CollisionSystem();
  replanQueue: Agent[] = [];
  routeSwitchCount = 0;
  metrics = new Metrics(0);
  constructor(
    public agentCount = 100,
    public mapId: MapId = "mvp",
  ) {
    this.reset();
  }
  reset() {
    this.grid = MAPS[this.mapId].create();
    this.time = 0;
    this.running = false;
    this.agents = [];
    this.replanQueue = [];
    this.routeSwitchCount = 0;
    this.density = new Density();
    this.metrics = new Metrics(this.agentCount);
    const random = seededRandom(CONFIG.seed),
      slots: { x: number; y: number }[] = [];
    for (const area of MAPS[this.mapId].spawnAreas)
      for (let y = area.y1; y <= area.y2; y += 12)
        for (let x = area.x1; x <= area.x2; x += 12)
          if (
            !this.collision.intersectsWall(
              { x, y },
              CONFIG.agentRadius + 1,
              this.grid,
            )
          )
            slots.push({ x, y });
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
    if (blocked === this.grid.exitABlocked) return;
    this.grid.exitABlocked = blocked;
    if (blocked) {
      const urgent: Agent[] = [];
      for (const a of this.agents) {
        if (a.evacuated) continue;
        // Closing a door may touch a circle whose center has not yet evacuated.
        // Move it the minimum distance back onto the approach before replanning.
        if (this.collision.intersectsWall(a.position, a.radius, this.grid))
          a.position = this.collision.resolveDoorClosure(
            a.position,
            a.radius,
            this.grid,
          );
        if (a.targetExit === "A") {
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
  }
  processReplans() {
    let processed = 0;
    while (this.replanQueue.length && processed < CONFIG.maxReplansPerStep) {
      const a = this.replanQueue.shift()!;
      a.queued = false;
      if (a.evacuated) continue;
      processed++;
      const route = this.router.plan(a, this.grid, this.mode);
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
    for (const a of this.agents) {
      if (a.evacuated) continue;
      // Visible local lookahead prevents crowds from fighting for one exact cell
      // center. Circle-swept visibility preserves corner/wall clearance.
      while (a.pathIndex < a.path.length - 1) {
        const current = this.grid.center(a.path[a.pathIndex]),
          next = this.grid.center(a.path[a.pathIndex + 1]);
        if (
          distance(a.position, current) < this.grid.cellSize &&
          this.collision.canTravel(a.position, next, a.radius, this.grid)
        )
          a.pathIndex++;
        else break;
      }
      const node = a.path[a.pathIndex];
      if (!node) continue;
      const goal = this.grid.center(node);
      if (distance(a.position, goal) < CONFIG.waypointThreshold) {
        a.pathIndex++;
        continue;
      }
      a.velocity = this.collision.velocity(
        a,
        this.collision.direction(a, goal),
        this.hash,
        this.grid,
      );
      movements.push({
        agent: a,
        position: this.collision.move(a, a.velocity, dt, this.grid),
      });
    }
    // Compute from a shared snapshot before committing positions (no stale hash buckets).
    for (const { agent: a, position } of movements) {
      a.position = position;
      const cell = this.grid.cell(a.position),
        type = this.grid.type(cell.x, cell.y);
      if (
        (type === CellType.ExitA && !this.grid.exitABlocked) ||
        type === CellType.ExitB
      ) {
        a.evacuated = true;
        a.evacuationTime = this.time;
        a.velocity = { x: 0, y: 0 };
        this.metrics.recordEvacuation(
          type === CellType.ExitA ? "A" : "B",
          this.time,
        );
      }
    }
    if (this.agents.every((a) => a.evacuated)) this.running = false;
    this.metrics.update(this.time, this.density.peak, this.routeSwitchCount);
  }
}
