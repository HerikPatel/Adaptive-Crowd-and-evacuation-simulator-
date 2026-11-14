import type { SurfaceId } from "../maps/stadium";

export type StadiumViewMode = "2d" | "3d";
export type StadiumViewLevel = "overview" | "lower-bowl" | "upper-east" | "upper-west" | "concourse" | "connections";

export const STADIUM_DESTINATIONS = {
  "gate-west": { label: "A / B", name: "West gates A / B", color: "#2f80ed" },
  "gate-north": { label: "C / D", name: "North gates C / D", color: "#f2994a" },
  "gate-east": { label: "E", name: "East gate E", color: "#27ae60" },
  "gate-south": { label: "G / H", name: "South gates G / H", color: "#9b51e0" },
} as const;

export type StadiumGateId = keyof typeof STADIUM_DESTINATIONS;
export const STADIUM_NEUTRAL_COLOR = "#94a3b8";
export const STADIUM_BLOCKED_COLOR = "#ff3b5c";
export const STADIUM_REFERENCE_ROUTE_COLOR = "#ffd166";

export function destinationColor(gateId: string | null): string {
  return gateId && gateId in STADIUM_DESTINATIONS
    ? STADIUM_DESTINATIONS[gateId as StadiumGateId].color : STADIUM_NEUTRAL_COLOR;
}

export function levelShowsSurface(level: StadiumViewLevel, surface: SurfaceId | null): boolean {
  if (level === "overview" || level === "connections") return true;
  if (level === "concourse") return surface === "concourse" || surface === "exterior";
  return surface === level;
}

/** Illustrative elevations in meters; no surveyed vertical geometry is available. */
export const STADIUM_3D_ASSUMPTIONS = Object.freeze({
  drawingScale: 0.02,
  fieldElevation: 0,
  exteriorElevation: 0,
  concourseElevation: 1.2,
  lowerBowlElevation: 4.2,
  upperDeckElevation: 10.5,
  sectionThickness: 0.45,
  personHeight: 1.7,
});

export function surfaceElevation(surface: SurfaceId): number {
  if (surface === "lower-bowl") return STADIUM_3D_ASSUMPTIONS.lowerBowlElevation;
  if (surface === "upper-east" || surface === "upper-west") return STADIUM_3D_ASSUMPTIONS.upperDeckElevation;
  if (surface === "concourse") return STADIUM_3D_ASSUMPTIONS.concourseElevation;
  return STADIUM_3D_ASSUMPTIONS.exteriorElevation;
}
