import { Grid, CellType } from "../simulation/Grid";
export function createMvpMap(): Grid {
  const grid = new Grid();
  const room = (x1: number, y1: number, x2: number, y2: number) => {
    for (let y = y1; y <= y2; y++)
      for (let x = x1; x <= x2; x++)
        grid.cells[grid.index(x, y)] = CellType.Walkable;
  };
  room(2, 4, 18, 25); // Large, reproducibly populated start area.
  room(19, 13, 25, 17); // Common corridor.
  room(26, 9, 30, 24); // Junction and downward connection.
  room(31, 9, 33, 14);
  room(34, 11, 38, 11);
  room(39, 9, 47, 14); // A: one-cell bottleneck.
  room(31, 21, 47, 25); // B: longer, five-cell-wide approach.
  grid.cells[grid.index(47, 11)] = CellType.ExitA;
  for (let y = 22; y <= 24; y++) grid.cells[grid.index(47, y)] = CellType.ExitB;
  return grid;
}
