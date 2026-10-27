// The browser build's pure game modules — the deterministic rules
// (src/rules.js), the content (src/content.js), the seeded streams
// (src/rng.js) and the session with its replay envelope, progression and
// achievements (src/session.js) — imported unchanged (allowJs) and typed here
// with the shapes this client reads.
import * as RulesJs from "../src/rules.js";
import * as ContentJs from "../src/content.js";
import * as SessionJs from "../src/session.js";
import * as RngJs from "../src/rng.js";

export interface Obstacle { x: number; y: number; hw: number; hh: number; kind: string }
export interface Goal { type: string; target: number; progress: number; done: boolean }
export interface GoalDef { type: string; target: number }
export interface Rival { name: string; skill: number; massScale: number }
export interface Theme {
  id: string; name: string; sky: number; fog: number; ground: number; groundLine: number; obstacle: number; obstacleTop: number;
  key: number; fill: number; accent: number; propColors: Record<string, number>; ambience: string;
}
export interface Step { text: string; hint?: string; require: { type: string; count?: number; kind?: string } }
export interface Stage {
  id: string; kind: string; version: number; seed: number; name: string; theme: string; arenaHalf: number; obstacles: Obstacle[];
  durationSec: number; rivals: Rival[]; emberCount?: number; propTarget?: number; propWeights?: Record<string, number>; goals: GoalDef[];
  boost: string; boostLimit?: number; moveLimit?: number; description?: string; index?: number; mastery?: boolean; dateKey?: string;
  excluded?: boolean; unrated?: boolean; undoAllowed?: boolean; steps?: Step[]; countdownSec?: number;
}
export interface Prop { id: number; x: number; y: number; m: number; k: string }
export interface Void {
  id: number; name: string; ai: boolean; x: number; y: number; vx: number; vy: number; mass: number; startMass: number; r: number;
  alive: boolean; respawnTicks: number; protectTicks: number; input: { dx: number; dy: number; boost: boolean };
  moveTicksUsed: number; boostsUsed: number; propMass: number; gemMass: number; rivalMass: number; gemsEaten: number; rivalsEaten: number;
  deaths: number; invalid: number;
}
export interface State {
  tick: number; phase: string; countdownTicks: number; terminalReason: string | null; arena: { half: number; obstacles: Obstacle[] };
  config: { durationTicks: number; moveLimit: number; boost: string; boostLimit: number };
  props: Prop[]; voids: Void[]; goals: Goal[]; stats: { spawned: number; eaten: number };
}
export interface RulesEvent { t: string; id?: number; victim?: number; m?: number; ids?: number[]; goal?: string; reason?: string; gain?: number }
export interface Query {
  phase: string; canMove: boolean; moveReason: string | null; canBoost: boolean; boostReason: string | null;
  edible: { kind: string; id: number; mass: number; d: number }[]; hazards: { kind: string; id: number; why: string }[];
  moveTicksLeft: number | null; boostsLeft: number | null;
}
export interface Breakdown {
  props: number; gems: number; rivals: number; gemCount: number; rivalCount: number; survivalBonus: number; invalidPenalty: number;
  massCollected: number; total: number; primaryGoalDone: boolean;
}
export interface Ranking { id: number; name: string; ai: boolean; breakdown: Breakdown; massCollected: number; place: number; deaths: number; invalid: number }
export interface Replay { schema: number; seed: number; stageId: string; commands: number[][]; hashes: unknown[]; result: { reason: string; finalHash: string } | null }
export interface Results { stage: Stage; rankings: Ranking[]; breakdown: Breakdown; terminalReason: string; goals: Goal[]; replay: Replay }
export interface SaveDoc {
  profile: { name: string; guest: boolean };
  journey: Record<string, { stars: number; best: number }>;
  tutorialsDone: Record<string, boolean>;
  daily: Record<string, { score: number; place: number }>;
  challenges: Record<string, { done: boolean; best: number }>;
  achievements: Record<string, { at: number }>;
  cosmetics: { theme: string | null; trail: string };
  masteryXp: number; sessionsPlayed: number; lastDailyKey: string | null; playDays?: string[]; dailyExcluded?: string[];
}
export interface Hooks { onEvents?: (events: RulesEvent[], state: State) => void; onPhase?: (phase: string, reason: string | null) => void }
export interface Session {
  stage: Stage; state: State; paused: boolean; undoUsed?: boolean; undoAllowed: boolean;
  tickOnce(): void;
  submitMove(dx: number, dy: number, boost: boolean): { ok: boolean; reason?: string; deduped?: boolean };
  canUndo(): boolean; undo(): { ok: boolean; reason?: string };
  pause(reason?: string): void; resume(): void; query(): Query; finish(): Results; awaySummary(): string; destroy(): void;
}

interface RulesApi {
  TICK_RATE: number;
  isTerminal(s: State): boolean;
}
interface ContentApi {
  THEMES: Record<string, Theme>;
  JOURNEY_COUNT: number;
  journeyAll(): Stage[];
  challenges(): Stage[];
  practiceStage(d: string): Stage;
  tutorials(): Stage[];
  dailyStage(key: string, excluded?: boolean): Stage;
}
interface SessionApi {
  Session: new (stage: Stage, opts: { playerName: string; hooks: Hooks }) => Session;
  ACHIEVEMENTS: Record<string, { name: string; desc: string }>;
  loadSave(): SaveDoc;
  mergeSaves(local: SaveDoc, remote: SaveDoc): SaveDoc;
  parseSaveDoc(raw: unknown, defaults: SaveDoc): SaveDoc | null;
  envelopeJson(data: unknown): string;
  recordResult(save: SaveDoc, session: Session, results: Results): unknown;
  verifyReplay(replay: Replay, stage: Stage): { ok: boolean; why: string | null };
}

export const Rules = RulesJs as unknown as RulesApi;
export const Content = ContentJs as unknown as ContentApi;
export const Sess = SessionJs as unknown as SessionApi;
export const mulberry32 = RngJs.mulberry32 as (seed: number) => () => number;
