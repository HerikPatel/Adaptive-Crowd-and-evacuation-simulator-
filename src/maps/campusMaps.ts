import { Grid, CellType } from "../simulation/Grid";
import type { ExitId } from "../config/simulationConfig";

/**
 * Additional schematic layouts for common campus building types.
 * 1 cell = 1 m (20 px). Layouts are illustrative, not surveyed floor plans.
 * Every layout keeps all floor connected to at least two exits, so the
 * "Close Exit A at 5 seconds" scenario never strands an area.
 */
function builder(width: number, height: number) {
  const grid = new Grid(width, height, 20);
  const set = (type: CellType) => (x1: number, y1: number, x2: number, y2: number) => {
    for (let y = y1; y <= y2; y++)
      for (let x = x1; x <= x2; x++) grid.cells[grid.index(x, y)] = type;
  };
  const exitType = (id: ExitId) => CellType.ExitA + ["A", "B", "C", "D", "E", "F", "G", "H"].indexOf(id);
  return {
    grid,
    floor: set(CellType.Walkable),
    wall: set(CellType.Wall),
    exit: (id: ExitId, x1: number, y1: number, x2 = x1, y2 = y1) => set(exitType(id) as CellType)(x1, y1, x2, y2),
  };
}

/** Tiered lecture hall: seat rows with side and centre aisles, stage at the front. */
export function createLectureHall(): Grid {
  const { grid, floor, wall, exit } = builder(60, 40);
  floor(4, 3, 55, 35); // Hall interior.
  wall(4, 3, 55, 4); // Projection wall behind the stage.
  // Seat rows: 1 m benches with 2 m walkways, broken by two side aisles and a centre aisle.
  for (let y = 11; y <= 32; y += 3) {
    wall(8, y, 26, y);
    wall(33, y, 51, y);
  }
  // Front doors beside the stage, rear doors at the back corners.
  floor(1, 7, 3, 7); exit("A", 0, 7); // Single front-left door.
  floor(56, 6, 58, 8); exit("B", 59, 6, 59, 8); // Double front-right door.
  floor(8, 36, 11, 38); exit("C", 8, 39, 11, 39); // Rear-left double door.
  floor(48, 36, 51, 38); exit("D", 48, 39, 51, 39); // Rear-right double door.
  return grid;
}

/** Double-loaded classroom corridor with stairwells at both ends and a lobby exit. */
export function createClassroomCorridor(): Grid {
  const { grid, floor, exit } = builder(70, 32);
  floor(3, 14, 66, 17); // 4 m corridor.
  const roomsX = [4, 17, 30, 43, 56];
  for (const x of roomsX) {
    floor(x, 3, x + 10, 12); // North classroom.
    floor(x + 2, 13, x + 3, 13); // Its 2 m door.
    // South classrooms either side of the lobby are 1 m narrower to leave walls around it.
    floor(x === 30 ? x + 1 : x, 19, x === 17 ? x + 9 : x + 10, 28); // South classroom.
    floor(x + 7, 18, x + 8, 18); // Its door, near the far end.
  }
  // Stairwells: A is a narrow west stair, B a wider east stair.
  floor(1, 15, 2, 15); exit("A", 0, 15);
  floor(67, 14, 68, 17); exit("B", 69, 14, 69, 17);
  // Ground-floor lobby between classrooms 2 and 3 on the south side.
  floor(28, 18, 29, 30); exit("C", 28, 31, 29, 31);
  return grid;
}

/** Open-plan office floor: desk islands, a central service core and perimeter meeting rooms. */
export function createOfficeFloor(): Grid {
  const { grid, floor, wall, exit } = builder(64, 40);
  floor(3, 3, 60, 36);
  wall(27, 15, 36, 24); // Lifts, restrooms and risers (no evacuation by lift).
  // Desk islands (2 × 6 m) in four zones around the core.
  for (const [x0, y0] of [[6, 6], [39, 6], [6, 27], [39, 27]])
    for (let i = 0; i < 3; i++) {
      wall(x0 + i * 6, y0, x0 + i * 6 + 1, y0 + 4);
    }
  for (const x of [6, 12, 18, 40, 45, 50]) {
    wall(x, 16, x + 1, 17);
    wall(x, 22, x + 1, 23);
  }
  // Meeting rooms along the west and east walls, each with a 2 m door.
  wall(9, 13, 9, 26); floor(9, 19, 9, 20);
  wall(55, 13, 55, 26); floor(55, 19, 55, 20);
  // Stair cores.
  floor(1, 5, 2, 6); exit("A", 0, 5, 0, 6); // Northwest stair.
  floor(61, 32, 62, 34); exit("B", 63, 32, 63, 34); // Southeast stair.
  floor(55, 1, 57, 2); exit("C", 55, 0, 57, 0); // Northeast stair.
  return grid;
}

/** Student-center dining hall: table blocks, a serving line and a wide main entrance. */
export function createDiningHall(): Grid {
  const { grid, floor, wall, exit } = builder(66, 42);
  floor(3, 3, 62, 36);
  wall(3, 3, 62, 7); // Kitchen (staff only).
  wall(10, 10, 40, 11); // Serving counter, open at both ends.
  // 2 × 4 m tables on a regular grid.
  for (let y = 15; y <= 31; y += 5)
    for (let x = 8; x <= 56; x += 7) wall(x, y, x + 3, y + 1);
  floor(28, 37, 37, 39); exit("B", 28, 40, 37, 40); // Wide main entrance, south.
  floor(1, 24, 2, 24); exit("A", 0, 24); // Narrow west door.
  floor(63, 20, 64, 22); exit("C", 65, 20, 65, 22); // East patio door.
  return grid;
}

/** Library stacks: long shelving rows, a main aisle and a reading room. */
export function createLibrary(): Grid {
  const { grid, floor, wall, exit } = builder(64, 40);
  floor(3, 3, 60, 36);
  // Shelving rows (1 m deep) with 2 m aisles, split by a 3 m main aisle.
  for (let y = 5; y <= 33; y += 3) {
    wall(6, y, 27, y);
    wall(31, y, 40, y);
  }
  // Reading room on the east side behind a partition with two openings.
  wall(44, 3, 44, 36);
  floor(44, 10, 44, 12);
  floor(44, 27, 44, 29);
  for (let y = 7; y <= 31; y += 6) wall(49, y, 56, y + 1); // Study tables.
  floor(28, 37, 31, 38); exit("A", 28, 39, 31, 39); // Main entrance, south.
  floor(61, 18, 62, 20); exit("B", 63, 18, 63, 20); // Reading-room fire exit, east.
  floor(1, 34, 2, 34); exit("C", 0, 34); // Narrow staff door, west.
  return grid;
}
