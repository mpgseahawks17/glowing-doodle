import { blendProb, type WeekMatchup } from "./engine";
import {
  buildPlan,
  planSurvival,
  type PlanInput,
  type PlanRow,
} from "./plan";

/**
 * "What does it cost me to take the team I want anyway?"
 *
 * The Plan tab already answers "what is optimal". This answers the question
 * people actually argue about: you want SF this week regardless of what the
 * solver says, so what does that do to the rest of the season?
 *
 * Nothing here touches the solver. Pinning team T to week W decomposes
 * cleanly:
 *
 *   - drop T from `available` and W from `weeks`
 *   - solve the remainder with the existing optimal assignment
 *   - splice the pinned rows back in for display
 *   - total survival = p(T,W) x (optimal over what is left)
 *
 * That is exact, and `lib/model/assign.ts` never learns the feature exists.
 * Banning is the same trick with only the `available` half.
 */

export interface Simulation {
  /** week -> the team pinned to it. */
  forced: Map<number, string>;
  /** Teams treated as unusable, without being assigned to any week. */
  banned: Set<string>;
}

export const EMPTY_SIMULATION: Simulation = {
  forced: new Map(),
  banned: new Set(),
};

export function isEmpty(sim: Simulation): boolean {
  return sim.forced.size === 0 && sim.banned.size === 0;
}

export interface PlanOutcome {
  rows: PlanRow[];
  /** P(win every week in the window). What the assignment maximises. */
  survival: number;
  /** P(at most `lives - 1` losses). What the pool actually scores. */
  livesSurvival: number;
}

export interface KnockOn {
  week: number;
  before: number;
  after: number;
}

export interface SimulatedPlan extends PlanOutcome {
  /** Weeks whose pick was pinned rather than solved for. */
  forcedWeeks: Set<number>;
  baseline: PlanOutcome;
  /** Drop in P(run the table) versus the unconstrained plan. */
  cost: number;
  /** Drop in P(survive with lives). Can be negative -- see below. */
  livesCost: number;
  /** Weeks that got worse than baseline, biggest damage first. */
  knockOn: KnockOn[];
  /**
   * Anything that makes the numbers above untrustworthy. Non-empty means the
   * UI should show the problem rather than a confident delta.
   */
  problems: string[];
}

/**
 * P(at most `lives - 1` losses) across independent weeks.
 *
 * The assignment maximises the product of win probabilities, i.e. the chance
 * of a perfect run. But this pool grants three lives, so the objective it
 * really scores is "still alive at the end", which tolerates two losses. Those
 * are different targets, and a pinned pick can raise one while lowering the
 * other -- which is exactly the sort of thing this feature exists to show.
 *
 * This is the Poisson-binomial tail, computed exactly. Iterating j downward
 * lets the array be updated in place: dp[j] still holds the previous week's
 * value when it is read.
 *
 * Not a win probability. It is the chance of surviving the window; with ~50
 * entrants, surviving is necessary but nowhere near sufficient.
 */
export function survivalWithLives(probs: number[], lives: number): number {
  if (lives <= 0) return 0;

  // dp[j] = P(exactly j losses so far).
  const dp = new Array<number>(lives).fill(0);
  dp[0] = 1;

  for (const p of probs) {
    for (let j = lives - 1; j >= 0; j--) {
      dp[j] = dp[j]! * p + (j > 0 ? dp[j - 1]! * (1 - p) : 0);
    }
  }

  return dp.reduce((a, b) => a + b, 0);
}

/** The win probabilities a plan actually stakes, skipping unassigned weeks. */
function probsOf(rows: PlanRow[]): number[] {
  return rows
    .map((r) => r.prob)
    .filter((p): p is number => p !== null && p > 0);
}

function outcome(rows: PlanRow[], lives: number): PlanOutcome {
  return {
    rows,
    survival: planSurvival(rows),
    livesSurvival: survivalWithLives(probsOf(rows), lives),
  };
}

function matchupFor(
  input: PlanInput,
  week: number,
  team: string,
): WeekMatchup | undefined {
  return input.matchups[String(week)]?.[team];
}

/**
 * Teams that can legally be pinned to a week: still in the pool, not banned,
 * playing that week, and priced. Ordered best-first so the picker reads like a
 * ranking rather than an alphabetical list.
 */
export function pinnableTeams(
  input: PlanInput,
  week: number,
  sim: Simulation,
): Array<{ team: string; prob: number }> {
  const weekProbs = input.matrix.get(week);
  if (!weekProbs) return [];

  const spent = new Set(
    [...sim.forced.entries()]
      .filter(([w]) => w !== week)
      .map(([, team]) => team),
  );

  return input.available
    .filter((t) => !spent.has(t) && !sim.banned.has(t))
    .filter((t) => matchupFor(input, week, t) !== undefined)
    .map((team) => ({ team, prob: blendProb(weekProbs.get(team), input.config.weights) }))
    .filter((x): x is { team: string; prob: number } => x.prob !== null)
    .sort((a, b) => b.prob - a.prob);
}

/** Price a pinned week and turn it into a display row. */
function forcedRow(
  input: PlanInput,
  week: number,
  team: string,
  problems: string[],
): PlanRow {
  const prob = blendProb(input.matrix.get(week)?.get(team), input.config.weights);
  const matchup = matchupFor(input, week, team);

  if (matchup === undefined || prob === null) {
    /**
     * A bye or unpriced pin must not pass silently. `planSurvival` scores a
     * null-probability row as 1.0 -- a free week -- so an unpriced pin would
     * make the simulation look BETTER than the baseline it is being compared
     * against. The picker should never offer such a team; this is the backstop.
     */
    problems.push(
      `${team} has no priced game in week ${week}, so it cannot be pinned there. ` +
        `Survival figures below exclude that week and are not comparable.`,
    );
    return {
      week,
      team,
      opponent: matchup?.opponent ?? null,
      isHome: matchup?.isHome ?? null,
      prob: null,
      alternatives: [],
      cumulativeSurvival: 0,
      note: matchup === undefined ? "on bye this week" : "no probability data",
    };
  }

  return {
    week,
    team,
    opponent: matchup.opponent,
    isHome: matchup.isHome,
    prob,
    alternatives: [],
    cumulativeSurvival: 0,
  };
}

/** Restate cumulative survival across a merged row list. */
function withCumulative(rows: PlanRow[]): PlanRow[] {
  let running = 1;
  return rows.map((r) => {
    if (r.prob !== null) running *= r.prob;
    return { ...r, cumulativeSurvival: running };
  });
}

export function buildSimulatedPlan(
  input: PlanInput,
  sim: Simulation,
  lives: number,
): SimulatedPlan {
  const problems: string[] = [];
  const baseline = outcome(buildPlan(input, "optimal"), lives);

  if (isEmpty(sim)) {
    return {
      ...baseline,
      forcedWeeks: new Set(),
      baseline,
      cost: 0,
      livesCost: 0,
      knockOn: [],
      problems,
    };
  }

  // Only pins inside the planned window mean anything; a pin on a week the
  // horizon no longer covers would otherwise silently distort the totals.
  const inWindow = new Set(input.weeks);
  const forced = new Map(
    [...sim.forced.entries()].filter(([w]) => inWindow.has(w)),
  );
  if (forced.size < sim.forced.size) {
    problems.push(
      "Some pinned weeks fall outside the current horizon and are being ignored. " +
        "Widen the Horizon control to include them.",
    );
  }

  const spent = new Set(forced.values());
  const remainingWeeks = input.weeks.filter((w) => !forced.has(w));
  const remainingTeams = input.available.filter(
    (t) => !spent.has(t) && !sim.banned.has(t),
  );

  /**
   * `optimalPlan` quietly falls back to greedy when it has more weeks than
   * teams, and returns a suboptimal plan without saying so. Banning is the one
   * control that can shrink the pool without shrinking the schedule, so say it
   * out loud rather than letting the comparison degrade invisibly.
   */
  if (remainingWeeks.length > remainingTeams.length) {
    problems.push(
      `Only ${remainingTeams.length} teams left for ${remainingWeeks.length} ` +
        `weeks, so the rest of the plan falls back to week-by-week picking ` +
        `rather than a solved path. Un-ban a team or shorten the horizon.`,
    );
  }

  const solved =
    remainingWeeks.length > 0
      ? buildPlan(
          { ...input, weeks: remainingWeeks, available: remainingTeams },
          "optimal",
        )
      : [];

  const merged = withCumulative(
    [
      ...solved,
      ...[...forced.entries()].map(([week, team]) =>
        forcedRow(input, week, team, problems),
      ),
    ].sort((a, b) => a.week - b.week),
  );

  const simulated = outcome(merged, lives);

  // Per-week comparison: what does week 12 look like now versus before? The
  // teams differ between the two plans, which is the point -- the question is
  // whether that week got worse, not whether it kept the same team.
  const before = new Map(baseline.rows.map((r) => [r.week, r.prob]));
  const knockOn: KnockOn[] = [];
  for (const row of merged) {
    const prior = before.get(row.week);
    if (prior == null || row.prob == null) continue;
    if (row.prob < prior - 1e-9) {
      knockOn.push({ week: row.week, before: prior, after: row.prob });
    }
  }
  knockOn.sort((a, b) => b.before - b.after - (a.before - a.after));

  return {
    ...simulated,
    forcedWeeks: new Set(forced.keys()),
    baseline,
    cost: baseline.survival - simulated.survival,
    livesCost: baseline.livesSurvival - simulated.livesSurvival,
    knockOn,
    problems,
  };
}
