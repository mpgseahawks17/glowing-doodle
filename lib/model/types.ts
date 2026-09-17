import type { MatchupContext } from "./matchup-context";

/** Per-team, per-week probability inputs from each source. */
export interface ProbInputs {
  vegas?: number;
  silver?: number;
  /** True when `silver` is actually our derived-ratings fallback, not Silver. */
  silverIsDerived?: boolean;
  /** Which feed the vegas number came from, for display and auditing. */
  vegasSource?: string;
  /** How many bookmakers went into it. 1 = single book, ~10 = a real median. */
  vegasBooks?: number;
}

/** week -> team -> inputs. A team absent from a week is on bye (or has no data). */
export type ProbMatrix = Map<number, Map<string, ProbInputs>>;

export interface BlendWeights {
  vegas: number;
  silver: number;
}

/**
 * PickLater aggregation strategy.
 *
 * `max` is the brief's spec: the single best future spot. The brief flags its
 * own limitation ("considers only the single best future spot, not the full
 * portfolio") and names the refinement — so `topK` is implemented here behind
 * the same interface, ready to switch on without touching callers.
 */
export type PickLaterStrategy =
  | { kind: "max" }
  | { kind: "topK"; k: number; decay: number };

export interface ModelConfig {
  weights: BlendWeights;
  /** Opportunity-cost multiplier. Default 1.0. */
  lambda: number;
  /** Weeks of lookahead beyond the current week. Default 4. */
  horizon: number;
  pickLater: PickLaterStrategy;
  /** |vegas - silver| at or above this flags a discrepancy. Default 0.05. */
  discrepancyThreshold: number;
  /** PickLater at or above this earns a SAVE label. Default 0.05. */
  saveThreshold: number;
}

export const DEFAULT_CONFIG: ModelConfig = {
  weights: { vegas: 0.5, silver: 0.5 },
  lambda: 1.0,
  horizon: 4,
  pickLater: { kind: "max" },
  discrepancyThreshold: 0.05,
  saveThreshold: 0.05,
};

export type Recommendation = "TOP PICK" | "STRONG" | "AVAILABLE" | "SAVE";

export interface ScoredTeam {
  team: string;
  /** Opponent this week, with home/away. null when on bye. */
  opponent: string | null;
  isHome: boolean | null;
  /** Rest/timing/familiarity flags for the badges. Absent when on bye. */
  context: MatchupContext | null;
  vegasProb: number | null;
  silverProb: number | null;
  silverIsDerived: boolean;
  vegasSource: string | null;
  vegasBooks: number | null;
  blendedProb: number | null;
  /**
   * Silver minus Vegas, in probability units. Positive means Silver is higher
   * on this team than the market. Null when either source is missing.
   */
  sourceDelta: number | null;
  /** |sourceDelta| >= the configured threshold. */
  discrepancy: boolean;
  pickNow: number | null;
  pickLater: number;
  /** Week in the lookahead window where pickLater peaks. null if no edge. */
  pickLaterWeek: number | null;
  score: number | null;
  rank: number;
  recommendation: Recommendation;
}
