import { EXIT_IDS, type ExitId } from "../config/simulationConfig";
import { MAPS, type MapId } from "../maps/maps";
import { Grid, CellType } from "./Grid";

/**
 * Saved building layouts: a small JSON file with one text row per grid row,
 * so files stay readable and diff cleanly in version control.
 *
 *   #  wall      .  floor      A-H  exit
 */
export const LAYOUT_FORMAT = "evacuation-lab-layout";
export const LAYOUT_VERSION = 1;

export interface LayoutFile {
  format: typeof LAYOUT_FORMAT;
  version: number;
  map: MapId;
  width: number;
  height: number;
  cells: string[];
}

export interface LoadedLayout { mapId: MapId; grid: Grid; }

const FLOOR = ".", WALL = "#";

function cellChar(type: number): string {
  if (type === CellType.Walkable) return FLOOR;
  if (type === CellType.Wall) return WALL;
  const exit = EXIT_IDS[type - CellType.ExitA];
  if (exit) return exit;
  throw new Error(`Cell type ${type} cannot be saved.`);
}

function charType(char: string): number | null {
  if (char === FLOOR) return CellType.Walkable;
  if (char === WALL) return CellType.Wall;
  const exit = EXIT_IDS.indexOf(char as ExitId);
  return exit === -1 ? null : CellType.ExitA + exit;
}

export function serializeLayout(grid: Grid, mapId: MapId): string {
  const rows: string[] = [];
  for (let y = 0; y < grid.height; y++) {
    let row = "";
    for (let x = 0; x < grid.width; x++) row += cellChar(grid.type(x, y));
    rows.push(row);
  }
  const file: LayoutFile = { format: LAYOUT_FORMAT, version: LAYOUT_VERSION, map: mapId, width: grid.width, height: grid.height, cells: rows };
  // One row per line keeps the grid readable in any text editor.
  return JSON.stringify({ ...file, cells: [] }, null, 2)
    .replace('"cells": []', `"cells": [\n${rows.map((r) => `    ${JSON.stringify(r)}`).join(",\n")}\n  ]`) + "\n";
}

/** Parses and validates a layout file. Throws an Error with a message fit for the user. */
export function parseLayout(text: string): LoadedLayout {
  let data: Partial<LayoutFile>;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("This file is not valid JSON. Choose a layout saved from Evacuation Lab.");
  }
  if (!data || typeof data !== "object" || data.format !== LAYOUT_FORMAT)
    throw new Error("This is not an Evacuation Lab layout file.");
  if (data.version !== LAYOUT_VERSION)
    throw new Error(`Layout file version ${String(data.version)} is not supported. Expected version ${LAYOUT_VERSION}.`);
  const mapId = data.map as MapId;
  if (typeof mapId !== "string" || !Object.hasOwn(MAPS, mapId))
    throw new Error("The layout names a building map that does not exist in this build.");
  const reference = MAPS[mapId].create();
  if (data.width !== reference.width || data.height !== reference.height)
    throw new Error(`The ${MAPS[mapId].name} map is ${reference.width} × ${reference.height} cells; this file is ${String(data.width)} × ${String(data.height)}.`);
  const rows = data.cells;
  if (!Array.isArray(rows) || rows.length !== reference.height || rows.some((r) => typeof r !== "string" || r.length !== reference.width))
    throw new Error(`The layout grid must have ${reference.height} rows of ${reference.width} cells.`);

  const grid = new Grid(reference.width, reference.height, reference.cellSize);
  for (let y = 0; y < grid.height; y++)
    for (let x = 0; x < grid.width; x++) {
      const type = charType(rows[y][x]);
      if (type === null) throw new Error(`Unknown cell "${rows[y][x]}" at row ${y + 1}, column ${x + 1}.`);
      grid.cells[grid.index(x, y)] = type;
    }

  for (let y = 0; y < grid.height; y++)
    for (let x = 0; x < grid.width; x++) {
      const edge = x === 0 || y === 0 || x === grid.width - 1 || y === grid.height - 1;
      if (edge && grid.type(x, y) === CellType.Walkable)
        throw new Error(`Floor at row ${y + 1}, column ${x + 1} touches the map edge. Close the outer boundary with walls or exits.`);
    }
  for (const id of grid.exitIds) {
    const cells = grid.exits(id, true), seen = new Set<number>([grid.index(cells[0].x, cells[0].y)]);
    const queue = [cells[0]];
    for (let i = 0; i < queue.length; i++)
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const q = { x: queue[i].x + dx, y: queue[i].y + dy }, k = grid.index(q.x, q.y);
        if (grid.exitAt(q.x, q.y) === id && !seen.has(k)) { seen.add(k); queue.push(q); }
      }
    if (seen.size !== cells.length) throw new Error(`Exit ${id} is split into separate openings. Each exit letter must be one connected opening.`);
  }
  return { mapId, grid };
}
