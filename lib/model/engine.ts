import {
  DEFAULT_CONFIG,
  type BlendWeights,
  type ModelConfig,
  type PickLaterStrategy,
  type ProbInputs,
  type ProbMatrix,
  type Recommendation,
  type ScoredTeam,
} from "./types";

/**
 * Blend Vegas and Silver into a single win probability.
 *
 * Per the brief: "If only one source has data for (T, w), use that source
 * alone." This matters far more than it looks. The Odds API only publishes
 * lines for the current round, so in weeks N+1..N+4 — the entire lookahead
 * window that PickLater depends on — `vegas` is undefined and the blend falls
 * through to Silver alone. Silver (or the derived-ratings fallback standing in
 * for it) is what actually drives the opportunity-cost model.
 */
export function blendProb(
  inputs: ProbInputs | undefined,
  weights: BlendWeights = DEFAULT_CONFIG.weights,
): number | null {
  if (!inputs) return null;
  const { vegas, silver } = inputs;
  const hasVegas = typeof vegas === "number" && Number.isFinite(vegas);
  const hasSilver = typeof silver === "number" && Number.isFinite(silver);

  if (hasVegas && hasSilver) {
    const total = weights.vegas + weights.silver;
    if (total <= 0) throw new Error("Blend weights must sum to a positive number");
    return (weights.vegas * vegas! + weights.silver * silver!) / total;
  }
  if (hasVegas) return vegas!;
  if (hasSilver) return silver!;
  return null;
}

/**
 * p_alt(w, T) — the best probability available in week w among teams we still
 * hold, excluding T.
 *
 * Returns 0 when no alternative exists (last team standing, or every other
 * available team is on bye). Zero is the right identity here: with no fallback,
 * T's full probability is its marginal value, so PickNow reduces to p(T, N).
 */
export function pAlt(
  matrix: ProbMatrix,
  week: number,
  excludeTeam: string,
  available: Iterable<string>,
  weights: BlendWeights = DEFAULT_CONFIG.weights,
): number {
  const weekProbs = matrix.get(week);
  if (!weekProbs) return 0;

  let best = 0;
  for (const team of available) {
    if (team === excludeTeam) continue;
    const p = blendProb(weekProbs.get(team), weights);
    if (p !== null && p > best) best = p;
  }
  return best;
}

/** edge(T, w) = max(0, p(T,w) - p_alt(w,T)). Clipped: no edge worth saving for. */
export function edge(
  matrix: ProbMatrix,
  week: number,
  team: string,
  available: Iterable<string>,
  weights: BlendWeights = DEFAULT_CONFIG.weights,
): number {
  const p = blendProb(matrix.get(week)?.get(team), weights);
  // No game that week (bye) or no data: the team cannot be used, so no edge.
  if (p === null) return 0;
  return Math.max(0, p - pAlt(matrix, week, team, available, weights));
}

function aggregate(
  edges: Array<{ week: number; value: number }>,
  strategy: PickLaterStrategy,
): { value: number; week: number | null } {
  if (edges.length === 0) return { value: 0, week: null };

  if (strategy.kind === "max") {
    let best = { week: null as number | null, value: 0 };
    for (const e of edges) {
      if (e.value > best.value) best = { week: e.week, value: e.value };
    }
    return { value: best.value, week: best.week };
  }

  // topK: geometrically decayed sum of the K largest future edges. Captures the
  // "full portfolio of future spots" refinement the brief names as a candidate.
  const sorted = [...edges].sort((a, b) => b.value - a.value).slice(0, strategy.k);
  let total = 0;
  for (const [i, e] of sorted.entries()) total += e.value * strategy.decay ** i;
  return { value: total, week: sorted[0]?.week ?? null };
}

/** PickLater(T) over the lookahead window {N+1 .. N+horizon}. */
export function pickLater(
  matrix: ProbMatrix,
  currentWeek: number,
  team: string,
  available: Iterable<string>,
  config: ModelConfig = DEFAULT_CONFIG,
): { value: number; week: number | null } {
  const availableList = [...available];
  const edges: Array<{ week: number; value: number }> = [];
  for (let w = currentWeek + 1; w <= currentWeek + config.horizon; w++) {
    edges.push({
      week: w,
      value: edge(matrix, w, team, availableList, config.weights),
    });
  }
  return aggregate(edges, config.pickLater);
}

function label(
  rank: number,
  pickLaterValue: number,
  score: number | null,
  config: ModelConfig,
): Recommendation {
  if (score === null) return "AVAILABLE";
  if (rank === 1) return "TOP PICK";
  if (pickLaterValue >= config.saveThreshold) return "SAVE";
  if (rank <= 5) return "STRONG";
  return "AVAILABLE";
}

export interface WeekMatchup {
  opponent: string;
  isHome: boolean;
}

/**
 * Score and rank every available team for the current week.
 *
 * Score(T) = p(T,N) - lambda * PickLater(T), ranked descending.
 *
 * Teams with no game this week (bye) or no probability data get a null score
 * and sort to the bottom — they are not pickable now, but their PickLater is
 * still computed, because it is informative to see what you are holding.
 */
export function scoreTeams(
  matrix: ProbMatrix,
  currentWeek: number,
  available: string[],
  matchups: Map<string, WeekMatchup>,
  config: ModelConfig = DEFAULT_CONFIG,
): ScoredTeam[] {
  const rows = available.map((team) => {
    const inputs = matrix.get(currentWeek)?.get(team);
    const blended = blendProb(inputs, config.weights);
    const later = pickLater(matrix, currentWeek, team, available, config);

    const vegasProb = inputs?.vegas ?? null;
    const silverProb = inputs?.silver ?? null;

    // Signed: positive means Silver rates this team above the market.
    const sourceDelta =
      vegasProb !== null && silverProb !== null ? silverProb - vegasProb : null;
    const discrepancy =
      sourceDelta !== null &&
      Math.abs(sourceDelta) >= config.discrepancyThreshold;

    const now =
      blended === null
        ? null
        : blended - pAlt(matrix, currentWeek, team, available, config.weights);

    const matchup = matchups.get(team) ?? null;

    return {
      team,
      opponent: matchup?.opponent ?? null,
      isHome: matchup?.isHome ?? null,
      vegasProb,
      silverProb,
      silverIsDerived: inputs?.silverIsDerived ?? false,
      vegasSource: inputs?.vegasSource ?? null,
      vegasBooks: inputs?.vegasBooks ?? null,
      blendedProb: blended,
      sourceDelta,
      discrepancy,
      pickNow: now,
      pickLater: later.value,
      pickLaterWeek: later.week,
      score: blended === null ? null : blended - config.lambda * later.value,
      rank: 0,
      recommendation: "AVAILABLE" as Recommendation,
    };
  });

  rows.sort((a, b) => {
    if (a.score === null && b.score === null) return a.team.localeCompare(b.team);
    if (a.score === null) return 1;
    if (b.score === null) return -1;
    if (b.score !== a.score) return b.score - a.score;
    return a.team.localeCompare(b.team);
  });

  let nextRank = 1;
  for (const row of rows) {
    row.rank = row.score === null ? 0 : nextRank++;
    row.recommendation = label(row.rank, row.pickLater, row.score, config);
  }
  return rows;
}
