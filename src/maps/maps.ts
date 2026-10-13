import { createMvpMap } from "./mvpMap";
import { createLargeMap } from "./largeMap";
import type { Grid } from "../simulation/Grid";

export type MapId = "mvp" | "large";
export interface MapLabel {
  text: string;
  x: number;
  y: number;
  exit?: "A" | "B";
}
export interface SpawnArea {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}
export interface MapDefinition {
  name: string;
  create: () => Grid;
  spawnAreas: SpawnArea[];
  labels: MapLabel[];
}

export const MAPS: Record<MapId, MapDefinition> = {
  mvp: {
    name: "Original bottleneck · 50 × 30",
    create: createMvpMap,
    spawnAreas: [{ x1: 60, y1: 100, x2: 350, y2: 490 }],
    labels: [
      { text: "START AREA", x: 55, y: 65 },
      { text: "JUNCTION", x: 514, y: 164 },
      { text: "NARROW PASSAGE", x: 657, y: 195 },
      { text: "WIDE APPROACH", x: 693, y: 407 },
      { text: "EXIT A →", x: 875, y: 166, exit: "A" },
      { text: "EXIT B →", x: 893, y: 549, exit: "B" },
    ],
  },
  large: {
    name: "Distributed wings · 70 × 42",
    create: createLargeMap,
    spawnAreas: [
      { x1: 120, y1: 140, x2: 510, y2: 310 },
      { x1: 880, y1: 140, x2: 1270, y2: 310 },
      { x1: 120, y1: 520, x2: 510, y2: 690 },
      { x1: 880, y1: 520, x2: 1270, y2: 690 },
    ],
    labels: [
      { text: "NORTHWEST WING", x: 110, y: 105 },
      { text: "NORTHEAST WING", x: 870, y: 105 },
      { text: "SOUTHWEST WING", x: 110, y: 485 },
      { text: "SOUTHEAST WING", x: 870, y: 485 },
      { text: "CENTRAL HALL", x: 580, y: 350 },
      { text: "← EXIT A / WEST", x: 30, y: 75, exit: "A" },
      { text: "EXIT B / SOUTH ↓", x: 1060, y: 826, exit: "B" },
    ],
  },
};
