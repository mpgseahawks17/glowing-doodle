import { blendProb, scoreTeams, type WeekMatchup } from "./engine";
import { INFEASIBLE, solveAssignment } from "./assign";
import type { ModelConfig, ProbMatrix } from "./types";
import type { MatchupContext } from "./matchup-context";

/**
 * Build a multi-week pick plan.
 *
 * Two strategies, because they answer different questions:
 *
 *   greedy  - what the app would tell you each week if you followed it and
 *             never looked further than its own recommendation. Week N here
 *             always matches the Scorecard's TOP PICK.
 *   optimal - the best achievable path, solving all weeks at once so that
 *             surviving every week is as likely as possible.
 *
 * Comparing them is the useful part. If they agree, week-by-week picking costs
 * you nothing. Where they diverge, greedy has spent a team that a later week
 * needed badly.
 */

export interface PlanAlternative {
  team: string;
  prob: number;
}

export interface PlanRow {
  week: number;
  team: string | null;
  opponent: string | null;
  isHome: boolean | null;
  /** Rest/timing/familiarity flags for the badges. Null on unassigned weeks. */
  context?: MatchupContext | null;
  prob: number | null;
  /** Runners-up for that week, after earlier weeks have taken their teams. */
  alternatives: PlanAlternative[];
  /** Probability of surviving every week up to and including this one. */
  cumulativeSurvival: number;
  /** Set when no team could be assigned (no data, or the pool ran dry). */
  note?: string;
}

export type PlanStrategy = "greedy" | "optimal";

export interface PlanInput {
  matrix: ProbMatrix;
  /** Weeks to plan, in order. */
  weeks: number[];
  /** Teams still available at the start of the plan. */
  available: string[];
  /** week -> team -> matchup. */
  matchups: Record<string, Record<string, WeekMatchup>>;
  config: ModelConfig;
}

function matchupsFor(
  input: PlanInput,
  week: number,
): Map<string, WeekMatchup> {
  return new Map(Object.entries(input.matchups[String(week)] ?? {}));
}

function alternativesFor(
  input: PlanInput,
  week: number,
  pool: string[],
  chosen: string | null,
  limit = 3,
): PlanAlternative[] {
  const weekProbs = input.matrix.get(week);
  if (!weekProbs) return [];
  return pool
    .filter((t) => t !== chosen)
    .map((team) => ({
      team,
      prob: blendProb(weekProbs.get(team), input.config.weights),
    }))
    .filter((x): x is PlanAlternative => x.prob !== null)
    .sort((a, b) => b.prob - a.prob)
    .slice(0, limit);
}

function greedyPlan(input: PlanInput): PlanRow[] {
  const pool = [...input.available];
  const rows: PlanRow[] = [];
  let survival = 1;

  for (const week of input.weeks) {
    // Exactly the Scorecard computation, on the pool left after earlier weeks.
    const scored = scoreTeams(
      input.matrix,
      week,
      pool,
      matchupsFor(input, week),
      input.config,
    );
    const top = scored.find((r) => r.score !== null) ?? null;

    if (!top || top.blendedProb === null) {
      rows.push({
        week,
        team: null,
        opponent: null,
        isHome: null,
        prob: null,
        alternatives: [],
        cumulativeSurvival: survival,
        note: pool.length === 0 ? "no teams left" : "no data for this week",
      });
      continue;
    }

    survival *= top.blendedProb;
    rows.push({
      week,
      team: top.team,
      opponent: top.opponent,
      isHome: top.isHome,
      context: top.context,
      prob: top.blendedProb,
      alternatives: alternativesFor(input, week, pool, top.team),
      cumulativeSurvival: survival,
    });
    pool.splice(pool.indexOf(top.team), 1);
  }

  return rows;
}

function optimalPlan(input: PlanInput): PlanRow[] {
  const { weeks, available } = input;

  /**
   * Cost = -log(p), so minimising total cost maximises the product of
   * probabilities, i.e. the chance of surviving every week.
   *
   * A team with no game (bye) or no data that week gets INFEASIBLE, which the
   * solver avoids unless nothing else exists; we detect that afterwards and
   * report the week as unassigned rather than inventing a pick.
   */
  const cost = weeks.map((week) => {
    const weekProbs = input.matrix.get(week);
    return available.map((team) => {
      const p = blendProb(weekProbs?.get(team), input.config.weights);
      if (p === null || p <= 0) return INFEASIBLE;
      return -Math.log(p);
    });
  });

  // The solver requires rows <= cols; with 32 teams and <= 18 weeks that holds,
  // but guard anyway rather than produce a wrong plan.
  if (weeks.length > available.length) {
    return greedyPlan(input);
  }

  const assignment = solveAssignment(cost);
  const used = new Set<string>();
  const rows: PlanRow[] = [];
  let survival = 1;

  for (const [i, week] of weeks.entries()) {
    const col = assignment[i] ?? -1;
    const team = col >= 0 ? available[col]! : null;
    const feasible = col >= 0 && cost[i]![col]! < INFEASIBLE;

    if (!team || !feasible) {
      rows.push({
        week,
        team: null,
        opponent: null,
        isHome: null,
        prob: null,
        alternatives: [],
        cumulativeSurvival: survival,
        note: "no feasible pick for this week",
      });
      continue;
    }

    const prob = blendProb(
      input.matrix.get(week)?.get(team),
      input.config.weights,
    )!;
    survival *= prob;
    used.add(team);

    const matchup = matchupsFor(input, week).get(team) ?? null;
    rows.push({
      week,
      team,
      opponent: matchup?.opponent ?? null,
      isHome: matchup?.isHome ?? null,
      context: matchup?.context ?? null,
      prob,
      alternatives: alternativesFor(
        input,
        week,
        available.filter((t) => !used.has(t)),
        team,
      ),
      cumulativeSurvival: survival,
    });
  }

  return rows;
}

export function buildPlan(input: PlanInput, strategy: PlanStrategy): PlanRow[] {
  return strategy === "optimal" ? optimalPlan(input) : greedyPlan(input);
}

/** Overall chance of surviving the whole plan. */
export function planSurvival(rows: PlanRow[]): number {
  return rows.reduce((acc, r) => (r.prob === null ? acc : acc * r.prob), 1);
}
