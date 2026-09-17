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

/**
 * A week whose PICK changed identity, which is a different question from
 * whether it got worse.
 *
 * Spending a team early forces the solver to reshuffle later weeks, and the
 * reshuffle is the part worth seeing: "week 4 is now MIN instead of BAL" says
 * what actually happened, where a probability delta only says how much it
 * cost. A week can also swap teams and barely move, or even improve.
 */
export interface TeamChange {
  week: number;
  before: string | null;
  after: string | null;
  /** True for the week the user pinned, false for knock-on reshuffles. */
  pinned: boolean;
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
   * Weeks whose pick changed identity, in week order.
   *
   * Deliberately separate from `knockOn`: that list answers "how much did this
   * cost", this one answers "what moved". A week can swap teams without
   * getting worse, so neither list is a subset of the other.
   */
  changes: TeamChange[];
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
    context: matchup.context ?? null,
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
      changes: [],
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

  /**
   * Two per-week comparisons against the baseline, answering different
   * questions:
   *
   *   knockOn - which weeks got WORSE, and by how much. Sorted worst-first,
   *             because the headline is the biggest casualty.
   *   changes - which weeks now hold a DIFFERENT TEAM. Sorted by week,
   *             because it reads as a narrative down the table.
   *
   * Neither contains the other. Spending a team early can hand a later week a
   * different opponent at nearly the same price -- a change with no damage --
   * and the reshuffle can even improve a week, which is a change that is the
   * opposite of a knock-on.
   */
  const priorProb = new Map(baseline.rows.map((r) => [r.week, r.prob]));
  const priorTeam = new Map(baseline.rows.map((r) => [r.week, r.team]));

  const knockOn: KnockOn[] = [];
  const changes: TeamChange[] = [];

  for (const row of merged) {
    const wasProb = priorProb.get(row.week);
    if (wasProb != null && row.prob != null && row.prob < wasProb - 1e-9) {
      knockOn.push({ week: row.week, before: wasProb, after: row.prob });
    }

    // `has` rather than `get`, so a week absent from the baseline entirely is
    // not mistaken for one whose pick was null.
    if (priorTeam.has(row.week)) {
      const wasTeam = priorTeam.get(row.week) ?? null;
      if (wasTeam !== row.team) {
        changes.push({
          week: row.week,
          before: wasTeam,
          after: row.team,
          pinned: forced.has(row.week),
        });
      }
    }
  }

  knockOn.sort((a, b) => b.before - b.after - (a.before - a.after));
  changes.sort((a, b) => a.week - b.week);

  return {
    ...simulated,
    forcedWeeks: new Set(forced.keys()),
    baseline,
    cost: baseline.survival - simulated.survival,
    livesCost: baseline.livesSurvival - simulated.livesSurvival,
    knockOn,
    changes,
    problems,
  };
}
