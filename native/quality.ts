// The look per graphics level. The engine-owned effects (shadows and their
// map size, ambient occlusion, bloom, the grade, anti-aliasing) are the
// level's own (levelSettings(): the same table every StarHermit game reads).
// The game's art (materials, the pavement texture, round-geometry LOD,
// particles, motes, detail, atmosphere) is the browser build's four presets
// and budgets (src/gfx.js TABLE / BUDGETS) keyed by the level's quality tier,
// with the drifting motes and the spark pool scaled within the tier by the
// level's particle budget against the tier's anchor level (quantum,
// molecular, terrestrial, galactic), at most twice the tier's. The runtime
// owns the rest of what the old Graphics panel did: Auto and the level
// choice, render scale and the pixel-ratio cap, adaptive resolution, the
// frame-rate limit and readout. The per-category overrides of the old panel
// are not offered (the runtime's Options choose a level).
import { levelSettings, type GraphicsLevel, type LevelSettings, type QualityTier } from "starhermit:engine";
import type { AntialiasMode } from "starhermit:scene";

export interface Budget {
  /** Ground, obstacles and props: Lambert (Low) or standard; clear-coated physical where "physical". */
  material: "lambert" | "standard" | "physical";
  /** Pavement texture size in px, within the level's largest texture. */
  ground: number;
  /** Round-geometry LOD multiplier. */
  segments: number;
  motes: number;
  /** Multiplies the particle pool. */
  sparks: number;
}
export interface Look {
  preset: QualityTier;
  /** The level's key-light shadow map size, 0 when the level draws no shadows. */
  shadows: number;
  /** The level's ambient occlusion (null: off). */
  ao: { resolution: number; samples: number; denoiseSamples: number } | null;
  /** The level's bloom resolution (null: off). */
  bloom: number | null;
  grade: boolean;
  antialias: AntialiasMode;
  /** Event bursts and boost trails: off, low (400) or high (1200) particles. */
  particles: "off" | "low" | "high";
  /** Ground relief, hedges, fountain detail, prop finish, the image-based lighting. */
  detailed: boolean;
  /** Drifting motes, the void swirl, the water shimmer. */
  atmosphere: boolean;
  budget: Budget;
}

type Art = Pick<Look, "particles" | "detailed" | "atmosphere">;
const ART: Record<QualityTier, Art> = {
  low: { particles: "off", detailed: false, atmosphere: false },
  balanced: { particles: "low", detailed: true, atmosphere: true },
  high: { particles: "high", detailed: true, atmosphere: true },
  ultra: { particles: "high", detailed: true, atmosphere: true },
};
const BUDGETS: Record<QualityTier, Budget> = {
  low: { material: "lambert", ground: 256, segments: 0.5, motes: 60, sparks: 0.5 },
  balanced: { material: "standard", ground: 1024, segments: 0.75, motes: 120, sparks: 0.75 },
  high: { material: "physical", ground: 1024, segments: 1, motes: 180, sparks: 1 },
  ultra: { material: "physical", ground: 2048, segments: 1.5, motes: 300, sparks: 1.5 },
};
export const MAX_MOTES = 600;
export const PARTICLE_BUDGET = { off: 0, low: 400, high: 1200 };
/** The level whose settings are each tier's preset. */
const ANCHOR: Record<QualityTier, GraphicsLevel> = { low: "quantum", balanced: "molecular", high: "terrestrial", ultra: "galactic" };

/** The look for a graphics level (the frame's by default). */
export function lookFor(s: LevelSettings = levelSettings()): Look {
  const preset = s.quality;
  const b = { ...BUDGETS[preset] };
  // Motes and sparks grow with the level's particle budget above the tier's anchor, at most 2×.
  const k = Math.min(2, s.particles / levelSettings(ANCHOR[preset]).particles);
  b.ground = Math.min(b.ground, s.maxTextureSize);
  b.motes = Math.min(MAX_MOTES, Math.round(b.motes * k));
  b.sparks = Math.round(b.sparks * k * 100) / 100;
  return {
    preset, ...ART[preset],
    shadows: s.shadows ? s.shadowMapSize : 0,
    ao: s.ao && { resolution: s.ao.resolution, samples: s.ao.samples, denoiseSamples: s.ao.denoiseSamples },
    bloom: s.bloom ? s.bloom.resolution : null,
    grade: s.grade,
    // Engine 1.36.1 bug: antialias "off" recolours fog, haze and translucent overlays; the old Low's MSAA
    // stays until engine 1.36.2 (drop this clamp when pinning 1.36.2+).
    antialias: s.antialias === "off" ? "msaa" : s.antialias,
    budget: b,
  };
}
/** Particle pool size for the look (0 when particles are off). */
export function particleBudget(look: Look): number {
  return Math.round(PARTICLE_BUDGET[look.particles] * look.budget.sparks);
}
