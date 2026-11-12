/** Original schematic based on Rutgers' public visitor map, not a measured floor plan.
 * Coordinates are drawing units. Physical inputs belong to the separate assumed navigation scenario.
 */
export type Point = { x: number; y: number };
export type StadiumLayer = "overview" | "lower" | "upper" | "concourse";
export type SurfaceId = "lower-bowl" | "upper-east" | "upper-west" | "concourse" | "exterior";

export const STADIUM_SOURCES = {
  map: { title: "Rutgers stadium map", url: "https://scarletknights.com/sports/2026/8/17/shi-stadium-map" },
  gates: { title: "Rutgers gate guide", url: "https://scarletknights.com/sports/2026/8/17/gate-ticket-information" },
  access: { title: "Rutgers accessibility information", url: "https://scarletknights.com/sports/2017/6/11/facilities-ada-shuttle-info-html" },
} as const;
export type SourceId = keyof typeof STADIUM_SOURCES;

export const STADIUM_LAYERS: { id: StadiumLayer; name: string; description: string }[] = [
  { id: "overview", name: "Overview", description: "All modeling layers together. Overlapping shapes do not imply a walkable connection." },
  { id: "lower", name: "100 level", description: "Lower seating bowl, sections 101–144. Assumed aisles lead to a bowl access walk and concourse openings." },
  { id: "upper", name: "200 level", description: "Separate east and west decks. Travel between decks must go through connecting circulation routes." },
  { id: "concourse", name: "Concourse & gates", description: "Proposed circulation ring and four gate groups. Ring continuity and approach routes are assumptions." },
];

export const STADIUM_SURFACES: { id: SurfaceId; name: string; layer: StadiumLayer }[] = [
  { id: "lower-bowl", name: "Lower seating bowl", layer: "lower" },
  { id: "upper-east", name: "East upper deck", layer: "upper" },
  { id: "upper-west", name: "West upper deck", layer: "upper" },
  { id: "concourse", name: "Concourse", layer: "concourse" },
  { id: "exterior", name: "Outside stadium boundary", layer: "concourse" },
];

interface FeatureBase {
  id: string;
  name: string;
  label: string;
  at: Point;
  sources: SourceId[];
  description: string;
}
export interface StadiumSection extends FeatureBase {
  kind: "section";
  surfaceId: SurfaceId;
  polygon: Point[];
  capacity: null;
}
export interface StadiumGate extends FeatureBase {
  kind: "gate";
  side: "West" | "North" | "East" | "South";
  gateNames: readonly string[];
  approach: Point;
  from: "concourse";
  to: "exterior";
  widthMeters: null;
}
export interface StadiumConnector extends FeatureBase {
  kind: "connector";
  connectorType: "ramp" | "stairs";
  from: { surfaceId: SurfaceId; point: Point };
  to: { surfaceId: SurfaceId; point: Point };
  connectionStatus: "proposed";
  travelSeconds: null;
  capacityPerSecond: null;
}
export interface StadiumLandmark extends FeatureBase {
  kind: "reference";
  surfaceId: "lower-bowl";
  evacuationUse: "unspecified";
}
export type StadiumFeature = StadiumSection | StadiumGate | StadiumConnector | StadiumLandmark;

const rectangle = (x: number, y: number, w: number, h: number): Point[] =>
  [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];

function arcPoint(cx: number, rx: number, ry: number, angle: number): Point {
  const a = angle * Math.PI / 180;
  return { x: cx + rx * Math.cos(a), y: 440 + ry * Math.sin(a) };
}

function endSection(cx: number, start: number, end: number): Point[] {
  const points: Point[] = [];
  for (let i = 0; i <= 6; i++) points.push(arcPoint(cx, 220, 220, start + (end - start) * i / 6));
  for (let i = 6; i >= 0; i--) points.push(arcPoint(cx, 110, 160, start + (end - start) * i / 6));
  return points;
}

function section(number: number, surfaceId: SurfaceId, polygon: Point[], at: Point): StadiumSection {
  return {
    id: `section-${number}`, kind: "section", name: `Section ${number}`, label: String(number),
    surfaceId, polygon, at, capacity: null, sources: ["map"],
    description: "Section label and relative arrangement follow the public map. Shape and size are approximate. An assumed aisle connects this section to its access walk. Actual seat counts and aisle locations remain unverified.",
  };
}

const sections: StadiumSection[] = [];
// West sideline runs 110 → 101 from left to right; east runs 121 → 131.
for (let i = 0; i < 10; i++) {
  sections.push(section(110 - i, "lower-bowl", rectangle(351 + i * 50, 601, 48, 58), { x: 375 + i * 50, y: 630 }));
  const start = 90 + i * 18;
  sections.push(section(111 + i, "lower-bowl", endSection(350, start + 0.7, start + 17.3), arcPoint(350, 165, 190, start + 9)));
}
for (let i = 0; i < 11; i++) {
  const width = 500 / 11;
  sections.push(section(121 + i, "lower-bowl", rectangle(351 + i * width, 221, width - 2, 58), { x: 350 + (i + 0.5) * width, y: 250 }));
}
for (let i = 0; i < 13; i++) {
  const start = -90 + i * 180 / 13, end = start + 180 / 13;
  sections.push(section(132 + i, "lower-bowl", endSection(850, start + 0.7, end - 0.7), arcPoint(850, 165, 190, (start + end) / 2)));
}
// Public map has no sections 215 or 216. The decks are distinct surfaces.
for (let i = 0; i < 14; i++) {
  const width = 500 / 14, x = 350 + i * width;
  sections.push(section(217 + i, "upper-east", rectangle(x + 1, 91, width - 2, 58), { x: x + width / 2, y: 120 }));
  sections.push(section(214 - i, "upper-west", rectangle(x + 1, 731, width - 2, 58), { x: x + width / 2, y: 760 }));
}
sections.sort((a, b) => Number(a.label) - Number(b.label));

const gates: StadiumGate[] = ([
  { side: "West", gateNames: ["A", "B"], at: { x: 600, y: 833 }, approach: { x: 600, y: 680 } },
  { side: "North", gateNames: ["C", "D"], at: { x: 57, y: 440 }, approach: { x: 120, y: 440 } },
  { side: "East", gateNames: ["E"], at: { x: 265, y: 150 }, approach: { x: 320, y: 208 } },
  { side: "South", gateNames: ["G", "H"], at: { x: 1143, y: 440 }, approach: { x: 1080, y: 440 } },
] as const).map(g => ({
  ...g, id: `gate-${g.side.toLowerCase()}`, kind: "gate", name: `${g.side} gates ${g.gateNames.join(" / ")}`,
  label: g.gateNames.join(" / "), from: "concourse", to: "exterior", widthMeters: null, sources: ["gates", "map"],
  description: "Gate names and stadium side are published by Rutgers. Marker position and approach line are schematic; individual openings, widths and evacuation availability are unverified. Entry recommendations do not restrict exit routes.",
}));

const connectors: StadiumConnector[] = ([
  {
    id: "ramp-east", name: "East upper ramp", label: "R1", connectorType: "ramp", at: { x: 305, y: 103 },
    from: { surfaceId: "upper-east", point: { x: 350, y: 155 } }, to: { surfaceId: "concourse", point: { x: 275, y: 220 } },
  },
  {
    id: "ramp-west", name: "West upper ramp", label: "R2", connectorType: "ramp", at: { x: 305, y: 777 },
    from: { surfaceId: "upper-west", point: { x: 445, y: 715 } }, to: { surfaceId: "concourse", point: { x: 275, y: 660 } },
  },
  {
    id: "stairs-south-east", name: "South stairs, east side", label: "S1", connectorType: "stairs", at: { x: 1090, y: 300 },
    from: { surfaceId: "lower-bowl", point: { x: 1020, y: 340 } }, to: { surfaceId: "concourse", point: { x: 1065, y: 360 } },
  },
  {
    id: "stairs-south-west", name: "South stairs, west side", label: "S2", connectorType: "stairs", at: { x: 1090, y: 580 },
    from: { surfaceId: "lower-bowl", point: { x: 1020, y: 540 } }, to: { surfaceId: "concourse", point: { x: 1065, y: 520 } },
  },
] as const).map(c => ({
  ...c, kind: "connector", sources: ["map"], connectionStatus: "proposed", travelSeconds: null, capacityPerSecond: null,
  description: "A ramp or stair symbol appears in this area of the visitor map. The dashed link proposes a connection between modeling surfaces; exact endpoints, direction, travel time and capacity still need verification. This is not an evacuation exit.",
}));

const references: StadiumLandmark[] = [
  { id: "elevator-101", name: "Elevator near section 101", label: "L1", at: { x: 870, y: 690 } },
  { id: "elevator-138", name: "Elevator near section 138", label: "L2", at: { x: 1090, y: 485 } },
].map(r => ({
  ...r, kind: "reference", surfaceId: "lower-bowl", evacuationUse: "unspecified", sources: ["access"],
  description: "Rutgers describes elevator access behind this section. Position is approximate; stops, capacity and evacuation use are unspecified. Reference marker only, with no modeled transfer connection.",
}));

export const STADIUM = {
  name: "SHI Stadium", scenario: "Football · spectators in the stands", inspected: "2026-11-12",
  width: 1200, height: 880, geometryStatus: "schematic", metersPerUnit: null, simulationReady: true,
  sections, gates, connectors, references,
} as const;

export const STADIUM_FEATURES: StadiumFeature[] = [...sections, ...gates, ...connectors, ...references];
export function surfaceName(id: SurfaceId): string {
  return STADIUM_SURFACES.find(s => s.id === id)!.name;
}
export function featureOnLayer(feature: StadiumFeature, layer: StadiumLayer): boolean {
  if (layer === "overview") return true;
  const surfaces = STADIUM_SURFACES.filter(s => s.layer === layer).map(s => s.id);
  if (feature.kind === "gate") return layer === "concourse";
  if (feature.kind === "connector") return surfaces.includes(feature.from.surfaceId) || surfaces.includes(feature.to.surfaceId);
  return surfaces.includes(feature.surfaceId);
}
