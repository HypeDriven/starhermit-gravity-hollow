// The look per graphics level: the browser build's four presets and budgets
// (src/gfx.js TABLE / BUDGETS, each tuned to hold 60 FPS on the weakest GPU
// its Auto gave it) keyed by the runtime's quality tier (frame().quality),
// with the drifting motes and the spark pool scaled within the tier by the
// level (frame().levelIndex), as the browser build scaled them by its
// hardware level (at most 2×). The runtime owns the rest of what the old
// Graphics panel did: Auto and the level choice, render scale and the
// pixel-ratio cap, adaptive resolution, the frame-rate limit and readout.
// The per-category overrides of the old panel are not offered (the runtime's
// Options choose a level).
import type { QualityTier } from "starhermit:engine";
import type { AntialiasMode } from "starhermit:scene";

export interface Budget {
  /** Ground, obstacles and props: Lambert (Low) or standard; clear-coated physical where "physical". */
  material: "lambert" | "standard" | "physical";
  /** Pavement texture size in px. */
  ground: number;
  /** Round-geometry LOD multiplier. */
  segments: number;
  motes: number;
  /** Multiplies the particle pool. */
  sparks: number;
  bloomRes: number;
  aoRes: number;
}
export interface Look {
  preset: QualityTier;
  /** Key-light shadow map (0 = off). */
  shadows: 0 | 1024 | 2048 | 4096;
  ao: "off" | "on" | "high";
  bloom: boolean;
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

const TABLE: Record<QualityTier, Omit<Look, "preset" | "budget">> = {
  low: { shadows: 0, ao: "off", bloom: false, grade: false, antialias: "msaa", particles: "off", detailed: false, atmosphere: false },
  balanced: { shadows: 1024, ao: "off", bloom: true, grade: true, antialias: "fxaa", particles: "low", detailed: true, atmosphere: true },
  high: { shadows: 2048, ao: "on", bloom: true, grade: true, antialias: "smaa", particles: "high", detailed: true, atmosphere: true },
  ultra: { shadows: 4096, ao: "high", bloom: true, grade: true, antialias: "msaa", particles: "high", detailed: true, atmosphere: true },
};
const BUDGETS: Record<QualityTier, Budget> = {
  low: { material: "lambert", ground: 256, segments: 0.5, motes: 60, sparks: 0.5, bloomRes: 0.5, aoRes: 0.5 },
  balanced: { material: "standard", ground: 1024, segments: 0.75, motes: 120, sparks: 0.75, bloomRes: 0.5, aoRes: 0.5 },
  high: { material: "physical", ground: 1024, segments: 1, motes: 180, sparks: 1, bloomRes: 0.5, aoRes: 0.5 },
  ultra: { material: "physical", ground: 2048, segments: 1.5, motes: 300, sparks: 1.5, bloomRes: 1, aoRes: 1 },
};
export const MAX_MOTES = 600;
export const PARTICLE_BUDGET = { off: 0, low: 400, high: 1200 };
/** The first level index of each tier (quantum, molecular, terrestrial, galactic). */
const TIER_FLOOR: Record<QualityTier, number> = { low: 0, balanced: 2, high: 4, ultra: 7 };

/** The look for a quality tier at a level index (0 quantum … 9 infinite). */
export function lookFor(preset: QualityTier, levelIndex: number): Look {
  const b = { ...BUDGETS[preset] };
  // Levels are about 1.64× apart in GPU throughput: motes and sparks grow
  // with the level above the tier's first, at most 2× the tier's budget.
  const k = Math.min(2, Math.pow(1.64, Math.max(0, levelIndex - TIER_FLOOR[preset])));
  b.motes = Math.min(MAX_MOTES, Math.round(b.motes * k));
  b.sparks = Math.round(b.sparks * k * 100) / 100;
  return { preset, ...TABLE[preset], budget: b };
}
/** Particle pool size for the look (0 when particles are off). */
export function particleBudget(look: Look): number {
  return Math.round(PARTICLE_BUDGET[look.particles] * look.budget.sparks);
}
