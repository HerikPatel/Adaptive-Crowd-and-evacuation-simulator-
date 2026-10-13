import { Grid, CellType } from "../simulation/Grid";

/** Four occupied wings joined by a ring corridor and a central cross passage. */
export function createLargeMap(): Grid {
  const grid = new Grid(70, 42, 20);
  const floor = (x1: number, y1: number, x2: number, y2: number) => {
    for (let y = y1; y <= y2; y++)
      for (let x = x1; x <= x2; x++)
        grid.cells[grid.index(x, y)] = CellType.Walkable;
  };
  floor(5, 6, 26, 16); // Northwest wing.
  floor(43, 6, 64, 16); // Northeast wing.
  floor(5, 25, 26, 35); // Southwest wing.
  floor(43, 25, 64, 35); // Southeast wing.
  floor(10, 17, 13, 24); // West link.
  floor(56, 17, 59, 24); // East link.
  floor(27, 10, 42, 13); // North passage.
  floor(27, 28, 42, 31); // South passage.
  floor(33, 14, 36, 27); // Central passage.
  floor(27, 18, 42, 23); // Central gathering space.
  floor(2, 11, 4, 11); // Narrow approach to west-facing A.
  grid.cells[grid.index(2, 11)] = CellType.ExitA;
  floor(54, 36, 58, 39); // Wide approach to south-facing B.
  for (let x = 54; x <= 58; x++) grid.cells[grid.index(x, 39)] = CellType.ExitB;
  return grid;
}
