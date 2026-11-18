import { CONFIG, type ExitId } from "../config/simulationConfig";
import type { GridPosition, Vector2 } from "../utils/Vector2";
export class Agent {
  velocity: Vector2 = { x: 0, y: 0 };
  radius: number = CONFIG.agentRadius;
  path: GridPosition[] = [];
  pathIndex = 0;
  targetExit: ExitId | null = null;
  evacuated = false;
  lastReplanTime = -Infinity;
  lastPathCost = Infinity;
  nextReplanTime = 0;
  reroutingUntil = 0;
  evacuationTime: number | null = null;
  queued = false;
  stalledSeconds = 0;
  /** Normal walking speed; `speed` is this, reduced while walking through smoke. */
  baseSpeed: number;
  /** Slower walkers move at a fraction of normal speed. */
  slow = false;
  /** Group id (the leader's id) for people in a group; null for people on their own. */
  groupId: number | null = null;
  constructor(
    public id: number,
    public position: Vector2,
    public speed: number,
    public replanOffset = 0,
  ) {
    this.baseSpeed = speed;
  }
}
