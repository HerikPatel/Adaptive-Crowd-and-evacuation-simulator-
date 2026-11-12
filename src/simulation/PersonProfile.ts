import { clamp, seededRandom } from "../utils/math";

export type CrowdProfile = "mixed" | "uniform";
export type Gender = "woman" | "man" | "unspecified";
export interface PersonProfile {
  age: number;
  gender: Gender;
  heightCm: number;
  weightKg: number;
  /** Stable individual variation, not a new random draw at every timestep. */
  paceFactor: number;
  reactionSeconds: number;
  speedOverride: number | null;
}

export const PROFILE_SOURCE = "https://pubmed.ncbi.nlm.nih.gov/9143432/";
export const PROFILE_LIMITS = { minSpeed: 0.45, maxSpeed: 1.8, maxRadius: 0.32 } as const;

/** Synthetic scenario, NOT a fitted demographic regression or measured Rutgers population.
 * Age affects an assumed baseline; modest height/mass adjustments and individual variation
 * allow sensitivity experiments. Gender identity is descriptive, not a biological speed proxy.
 * Bohannon 1997 motivates variability, not these coefficients; see docs/AGENT_BEHAVIOR.md.
 */
export function walkingSpeed(profile: PersonProfile): number {
  if (profile.speedOverride !== null) return profile.speedOverride;
  const ageBaseline = profile.age < 45 ? 1.34 : profile.age < 65 ? 1.26 : profile.age < 75 ? 1.12 : 1.0;
  const heightFactor = clamp(Math.sqrt(profile.heightCm / 170), 0.92, 1.08);
  const bmi = profile.weightKg / (profile.heightCm / 100) ** 2;
  const massFactor = clamp(1 - Math.max(0, bmi - 30) * 0.006, 0.85, 1);
  return clamp(ageBaseline * heightFactor * massFactor * profile.paceFactor, PROFILE_LIMITS.minSpeed, PROFILE_LIMITS.maxSpeed);
}

/** Circular footprint is an explicit modeling approximation, not measured anthropometry. */
export function bodyRadius(profile: PersonProfile): number {
  return clamp(0.26 + (profile.weightKg - 70) * 0.0008 + (profile.heightCm - 170) * 0.0003, 0.22, PROFILE_LIMITS.maxRadius);
}

export function validateProfile(p: PersonProfile): void {
  const fields: [number, number, number, string][] = [
    [p.age, 18, 85, "Age"], [p.heightCm, 130, 210, "Height"], [p.weightKg, 40, 180, "Weight"],
    [p.paceFactor, 0.6, 1.4, "Pace factor"], [p.reactionSeconds, 0, 60, "Response delay"],
  ];
  if (p.speedOverride !== null) fields.push([p.speedOverride, 0.45, 1.8, "Walking speed"]);
  for (const [value, min, max, name] of fields)
    if (!Number.isFinite(value) || value < min || value > max) throw new Error(`${name} must be between ${min} and ${max}.`);
  if (!Number.isInteger(p.age)) throw new Error("Age must be a whole number.");
  if (!["woman", "man", "unspecified"].includes(p.gender)) throw new Error("Choose a valid gender label.");
}

/** Separate per-person random stream keeps seating identical across comparison modes. */
export function createProfile(seed: number, id: number, mode: CrowdProfile): PersonProfile {
  if (mode === "uniform") return { age: 35, gender: "unspecified", heightCm: 170, weightKg: 70,
    paceFactor: 1, reactionSeconds: 0, speedOverride: 1.2 };
  const random = seededRandom((seed ^ Math.imul(id + 1, 0x45d9f3b)) >>> 0);
  const normal = () => Math.sqrt(-2 * Math.log(Math.max(1e-9, random()))) * Math.cos(2 * Math.PI * random());
  const u = random(), band = u < 0.3 ? [18, 29] : u < 0.6 ? [30, 44] : u < 0.85 ? [45, 64] : [65, 85];
  const age = band[0] + Math.floor(random() * (band[1] - band[0] + 1));
  const genderDraw = random(), gender: Gender = genderDraw < 0.49 ? "woman" : genderDraw < 0.98 ? "man" : "unspecified";
  const heightCm = Math.round(clamp(170 + 9 * normal(), 145, 200));
  const bmi = clamp(26 + 4 * normal(), 18, 38);
  return { age, gender, heightCm, weightKg: Math.round(clamp(bmi * (heightCm / 100) ** 2, 40, 150)),
    paceFactor: clamp(1 + 0.12 * normal(), 0.65, 1.35), reactionSeconds: Math.round((0.5 + random() * 4.5) * 10) / 10,
    speedOverride: null };
}
