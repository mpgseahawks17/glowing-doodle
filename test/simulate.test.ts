import { describe, expect, it } from "vitest";
import { planSurvival, type PlanInput } from "@/lib/model/plan";
import {
  buildSimulatedPlan,
  pinnableTeams,
  survivalWithLives,
  type Simulation,
} from "@/lib/model/simulate";
import { DEFAULT_CONFIG, type ProbMatrix } from "@/lib/model/types";
import type { WeekMatchup } from "@/lib/model/engine";

function matrixOf(spec: Record<number, Record<string, number>>): ProbMatrix {
  const m: ProbMatrix = new Map();
  for (const [week, teams] of Object.entries(spec)) {
    m.set(
      Number(week),
      new Map(Object.entries(teams).map(([t, p]) => [t, { vegas: p }])),
    );
  }
  return m;
}

function matchupsOf(
  spec: Record<number, string[]>,
): Record<string, Record<string, WeekMatchup>> {
  const out: Record<string, Record<string, WeekMatchup>> = {};
  for (const [week, teams] of Object.entries(spec)) {
    out[week] = Object.fromEntries(
      teams.map((t) => [t, { opponent: "OPP", isHome: true }]),
    );
  }
  return out;
}

const sim = (
  forced: Record<number, string> = {},
  banned: string[] = [],
): Simulation => ({
  forced: new Map(Object.entries(forced).map(([w, t]) => [Number(w), t])),
  banned: new Set(banned),
});

/**
 * The same trap `plan.test.ts` uses, one week wider so there is something for
 * a pin to disturb.
 *
 *        wk1    wk2    wk3
 *   A    0.80   0.90   0.50
 *   B    0.79   0.20   0.50
 *   C    0.60   0.60   0.95
 *
 * Unconstrained optimal takes B, A, C -> 0.79 * 0.90 * 0.95 = 0.675450.
 */
const matrix = matrixOf({
  1: { A: 0.8, B: 0.79, C: 0.6 },
  2: { A: 0.9, B: 0.2, C: 0.6 },
  3: { A: 0.5, B: 0.5, C: 0.95 },
});

const input: PlanInput = {
  matrix,
  weeks: [1, 2, 3],
  available: ["A", "B", "C"],
  matchups: matchupsOf({ 1: ["A", "B", "C"], 2: ["A", "B", "C"], 3: ["A", "B", "C"] }),
  config: { ...DEFAULT_CONFIG, lambda: 0 },
};

describe("survivalWithLives", () => {
  it("with one life is the plain product", () => {
    const probs = [0.8, 0.7, 0.9];
    expect(survivalWithLives(probs, 1)).toBeCloseTo(0.8 * 0.7 * 0.9, 10);
  });

  it("matches a hand-computed three-week, three-life tail", () => {
    // With three lives and only three games you cannot be eliminated: that
    // needs a third loss, and surviving requires at most two.
    expect(survivalWithLives([0.8, 0.7, 0.9], 3)).toBeCloseTo(
      1 - 0.2 * 0.3 * 0.1,
      10,
    );
  });

  it("matches a hand-computed two-life tail", () => {
    // P(0 losses) + P(exactly 1 loss).
    const p = [0.8, 0.7, 0.9];
    const zero = 0.8 * 0.7 * 0.9;
    const one =
      0.2 * 0.7 * 0.9 + 0.8 * 0.3 * 0.9 + 0.8 * 0.7 * 0.1;
    expect(survivalWithLives(p, 2)).toBeCloseTo(zero + one, 10);
  });

  it("is monotonic in lives", () => {
    const p = [0.8, 0.7, 0.9, 0.6];
    expect(survivalWithLives(p, 2)).toBeGreaterThan(survivalWithLives(p, 1));
    expect(survivalWithLives(p, 3)).toBeGreaterThan(survivalWithLives(p, 2));
  });

  it("returns 0 with no lives left", () => {
    expect(survivalWithLives([0.9], 0)).toBe(0);
  });
});

describe("buildSimulatedPlan", () => {
  it("an empty simulation is exactly the unconstrained plan", () => {
    const out = buildSimulatedPlan(input, sim(), 3);
    expect(out.rows.map((r) => r.team)).toEqual(["B", "A", "C"]);
    expect(out.survival).toBeCloseTo(0.79 * 0.9 * 0.95, 10);
    expect(out.cost).toBe(0);
    expect(out.knockOn).toEqual([]);
    expect(out.problems).toEqual([]);
  });

  it("pinning the team optimal already chose costs nothing", () => {
    const out = buildSimulatedPlan(input, sim({ 2: "A" }), 3);
    expect(out.rows.map((r) => r.team)).toEqual(["B", "A", "C"]);
    expect(out.cost).toBeCloseTo(0, 10);
  });

  it("pinning decomposes into p(T,W) x optimal over the rest", () => {
    // Pin A to week 1. The rest solves over {B, C} across weeks 2 and 3, and
    // C,B (0.60 * 0.50 = 0.30) beats B,C (0.20 * 0.95 = 0.19) -- so taking A
    // early costs the plan BOTH of the strong later slots, not just one.
    const out = buildSimulatedPlan(input, sim({ 1: "A" }), 3);
    expect(out.rows.map((r) => r.team)).toEqual(["A", "C", "B"]);
    expect(out.survival).toBeCloseTo(0.8 * 0.6 * 0.5, 10);
    expect(out.cost).toBeCloseTo(0.79 * 0.9 * 0.95 - 0.8 * 0.6 * 0.5, 10);
  });

  it("reports the knock-on weeks worst-first, ignoring weeks that improved", () => {
    const out = buildSimulatedPlan(input, sim({ 1: "A" }), 3);
    // Week 1 improved (0.79 -> 0.80) and must not appear. Week 3 took the
    // bigger hit (0.95 -> 0.50) than week 2 (0.90 -> 0.60), so it leads.
    expect(out.knockOn.map((k) => k.week)).toEqual([3, 2]);
    expect(out.knockOn[0]!.before).toBeCloseTo(0.95, 10);
    expect(out.knockOn[0]!.after).toBeCloseTo(0.5, 10);
  });

  it("reports which teams moved, and which week you pinned", () => {
    const out = buildSimulatedPlan(input, sim({ 1: "A" }), 3);
    // Baseline is B,A,C; pinning A to week 1 gives A,C,B — so all three weeks
    // change hands, but only week 1 is a choice the user made.
    expect(out.changes).toEqual([
      { week: 1, before: "B", after: "A", pinned: true },
      { week: 2, before: "A", after: "C", pinned: false },
      { week: 3, before: "C", after: "B", pinned: false },
    ]);
  });

  it("orders changes by week, unlike knockOn which leads with the damage", () => {
    const out = buildSimulatedPlan(input, sim({ 1: "A" }), 3);
    expect(out.changes.map((c) => c.week)).toEqual([1, 2, 3]);
    expect(out.knockOn.map((k) => k.week)).toEqual([3, 2]);
  });

  it("reports no changes when the pin matches the solved plan", () => {
    expect(buildSimulatedPlan(input, sim({ 2: "A" }), 3).changes).toEqual([]);
  });

  it("an empty simulation reports no changes", () => {
    expect(buildSimulatedPlan(input, sim(), 3).changes).toEqual([]);
  });

  /**
   * The case that proves `changes` and `knockOn` are not redundant.
   *
   *        wk1    wk2
   *   A    0.90   0.80
   *   B    0.60   0.80
   *
   * Optimal is A,B or B,A — both 0.72. Pinning B to week 1 swaps week 2 from
   * B to A at an identical 0.80, so the week changes hands without getting
   * any worse. It belongs in `changes` and must NOT appear in `knockOn`.
   */
  it("a week can change team without getting worse", () => {
    const flat: PlanInput = {
      ...input,
      matrix: matrixOf({ 1: { A: 0.9, B: 0.6 }, 2: { A: 0.8, B: 0.8 } }),
      matchups: matchupsOf({ 1: ["A", "B"], 2: ["A", "B"] }),
      available: ["A", "B"],
      weeks: [1, 2],
    };
    const out = buildSimulatedPlan(flat, sim({ 1: "B" }), 3);

    const wk2 = out.changes.find((c) => c.week === 2);
    expect(wk2).toEqual({ week: 2, before: "B", after: "A", pinned: false });
    expect(out.knockOn.map((k) => k.week)).not.toContain(2);
  });

  it("banning a team re-solves without it", () => {
    const out = buildSimulatedPlan(input, sim({}, ["A"]), 3);
    expect(out.rows.map((r) => r.team)).not.toContain("A");
    expect(out.cost).toBeGreaterThan(0);
  });

  it("flags the silent greedy fallback instead of degrading quietly", () => {
    // Two teams left for three weeks: optimalPlan falls back to greedy and
    // says nothing, so the simulator has to.
    const out = buildSimulatedPlan(input, sim({}, ["A"]), 3);
    expect(out.problems.join(" ")).toMatch(/week-by-week/);
  });

  it("refuses a pin on a week the team does not play", () => {
    const byeInput: PlanInput = {
      ...input,
      matrix: matrixOf({ 1: { A: 0.8, B: 0.79 }, 2: { B: 0.2, C: 0.6 } }),
      available: ["A", "B", "C"],
      matchups: matchupsOf({ 1: ["A", "B"], 2: ["B", "C"] }),
      weeks: [1, 2],
    };
    const out = buildSimulatedPlan(byeInput, sim({ 2: "A" }), 3);
    expect(out.problems.join(" ")).toMatch(/no priced game in week 2/);
    // The row must not be scored as a free week.
    const pinned = out.rows.find((r) => r.week === 2)!;
    expect(pinned.prob).toBeNull();
    expect(pinned.note).toBe("on bye this week");
  });

  it("ignores pins outside the horizon and says so", () => {
    const out = buildSimulatedPlan({ ...input, weeks: [1, 2] }, sim({ 3: "C" }), 3);
    expect(out.problems.join(" ")).toMatch(/outside the current horizon/);
    expect(out.rows.map((r) => r.week)).toEqual([1, 2]);
  });

  it("keeps cumulative survival consistent with the row probabilities", () => {
    const out = buildSimulatedPlan(input, sim({ 1: "A" }), 3);
    expect(out.rows.at(-1)!.cumulativeSurvival).toBeCloseTo(out.survival, 10);
    expect(planSurvival(out.rows)).toBeCloseTo(out.survival, 10);
  });

  /**
   * The reason both metrics are shown: they can rank two paths in opposite
   * orders, so "better" depends on which objective you meant.
   *
   *   flat  = [0.90, 0.90]   product 0.8100   both lost: 0.10 * 0.10 = 0.0100
   *   spiky = [0.99, 0.80]   product 0.7920   both lost: 0.01 * 0.20 = 0.0020
   *
   * The flat path is likelier to run the table. The spiky path is likelier to
   * leave you alive when one loss is survivable, because its near-lock almost
   * never costs a life -- the two mediocre games can both go wrong far more
   * easily than the 99% game can.
   *
   * The assignment solver maximises the product, so it prefers `flat` and
   * cannot see the second column at all. That is the honest reason the UI
   * reports both rather than picking one.
   */
  it("the two objectives can rank the same pair of paths differently", () => {
    const flat = [0.9, 0.9];
    const spiky = [0.99, 0.8];

    // Running the table (what the solver maximises): flat wins.
    expect(survivalWithLives(flat, 1)).toBeCloseTo(0.81, 10);
    expect(survivalWithLives(spiky, 1)).toBeCloseTo(0.792, 10);
    expect(survivalWithLives(flat, 1)).toBeGreaterThan(
      survivalWithLives(spiky, 1),
    );

    // Surviving one loss (closer to what the pool scores): spiky wins.
    expect(survivalWithLives(flat, 2)).toBeCloseTo(0.99, 10);
    expect(survivalWithLives(spiky, 2)).toBeCloseTo(0.998, 10);
    expect(survivalWithLives(spiky, 2)).toBeGreaterThan(
      survivalWithLives(flat, 2),
    );
  });
});

describe("pinnableTeams", () => {
  it("ranks that week's options best-first", () => {
    expect(pinnableTeams(input, 2, sim()).map((x) => x.team)).toEqual([
      "A",
      "C",
      "B",
    ]);
  });

  it("excludes banned teams and teams pinned to another week", () => {
    const teams = pinnableTeams(input, 2, sim({ 1: "A" }, ["C"]));
    expect(teams.map((x) => x.team)).toEqual(["B"]);
  });

  it("still offers the team already pinned to this week", () => {
    const teams = pinnableTeams(input, 2, sim({ 2: "B" }));
    expect(teams.map((x) => x.team)).toContain("B");
  });

  it("excludes teams with no game that week", () => {
    const byeInput: PlanInput = {
      ...input,
      matrix: matrixOf({ 1: { A: 0.8, B: 0.79 }, 2: { B: 0.2, C: 0.6 } }),
      matchups: matchupsOf({ 1: ["A", "B"], 2: ["B", "C"] }),
      weeks: [1, 2],
    };
    expect(pinnableTeams(byeInput, 2, sim()).map((x) => x.team)).toEqual([
      "C",
      "B",
    ]);
  });
});
