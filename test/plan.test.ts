import { describe, expect, it } from "vitest";
import { solveAssignment, solveAssignmentMax } from "@/lib/model/assign";
import { buildPlan, planSurvival } from "@/lib/model/plan";
import { DEFAULT_CONFIG, type ProbMatrix } from "@/lib/model/types";
import type { WeekMatchup } from "@/lib/model/engine";

/** Exhaustive search, for checking the solver on small inputs. */
function bruteForceMin(cost: number[][]): number {
  const n = cost.length;
  const m = cost[0]!.length;
  const cols = [...Array(m).keys()];
  let best = Infinity;

  const walk = (row: number, used: Set<number>, total: number) => {
    if (row === n) {
      best = Math.min(best, total);
      return;
    }
    for (const c of cols) {
      if (used.has(c)) continue;
      used.add(c);
      walk(row + 1, used, total + cost[row]![c]!);
      used.delete(c);
    }
  };
  walk(0, new Set(), 0);
  return best;
}

const totalOf = (cost: number[][], assignment: number[]) =>
  assignment.reduce((sum, col, row) => sum + cost[row]![col]!, 0);

describe("solveAssignment", () => {
  it("solves a small square problem", () => {
    const cost = [
      [4, 1, 3],
      [2, 0, 5],
      [3, 2, 2],
    ];
    const a = solveAssignment(cost);
    expect(new Set(a).size).toBe(3);
    expect(totalOf(cost, a)).toBe(bruteForceMin(cost));
  });

  it("solves rectangular problems (fewer weeks than teams)", () => {
    const cost = [
      [7, 2, 9, 4],
      [5, 8, 1, 6],
    ];
    const a = solveAssignment(cost);
    expect(a).toHaveLength(2);
    expect(new Set(a).size).toBe(2);
    expect(totalOf(cost, a)).toBe(bruteForceMin(cost));
  });

  it("matches brute force across random instances", () => {
    let seed = 12345;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % 100;
    };
    for (let trial = 0; trial < 25; trial++) {
      const rows = 3;
      const cols = 5;
      const cost = Array.from({ length: rows }, () =>
        Array.from({ length: cols }, () => rnd()),
      );
      const a = solveAssignment(cost);
      expect(totalOf(cost, a)).toBe(bruteForceMin(cost));
    }
  });

  it("maximises when asked to", () => {
    const value = [
      [1, 9],
      [9, 1],
    ];
    const a = solveAssignmentMax(value);
    expect(totalOf(value, a)).toBe(18);
  });

  it("rejects more rows than columns", () => {
    expect(() => solveAssignment([[1], [2]])).toThrow();
  });
});

function matrixOf(
  spec: Record<number, Record<string, number>>,
): ProbMatrix {
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

describe("buildPlan", () => {
  /**
   * The trap greedy falls into. A is marginally better than B in week 1, but B
   * is useless in week 2 while A is the only good option there.
   *
   *        wk1    wk2
   *   A    0.80   0.90
   *   B    0.79   0.20
   *
   * Greedy takes A in week 1 and is left with B's 0.20 -> 0.80 * 0.20 = 0.16.
   * Optimal takes B first -> 0.79 * 0.90 = 0.711.
   */
  const matrix = matrixOf({
    1: { A: 0.8, B: 0.79 },
    2: { A: 0.9, B: 0.2 },
  });
  const input = {
    matrix,
    weeks: [1, 2],
    available: ["A", "B"],
    matchups: matchupsOf({ 1: ["A", "B"], 2: ["A", "B"] }),
    config: { ...DEFAULT_CONFIG, lambda: 0 },
  };

  it("greedy takes the best team each week and can strand a later week", () => {
    const rows = buildPlan(input, "greedy");
    expect(rows.map((r) => r.team)).toEqual(["A", "B"]);
    expect(planSurvival(rows)).toBeCloseTo(0.16, 10);
  });

  it("optimal sacrifices week 1 to protect week 2", () => {
    const rows = buildPlan(input, "optimal");
    expect(rows.map((r) => r.team)).toEqual(["B", "A"]);
    expect(planSurvival(rows)).toBeCloseTo(0.711, 10);
  });

  it("never reuses a team", () => {
    const bigger = {
      ...input,
      weeks: [1, 2, 3],
      available: ["A", "B", "C", "D"],
      matrix: matrixOf({
        1: { A: 0.8, B: 0.7, C: 0.6, D: 0.5 },
        2: { A: 0.75, B: 0.7, C: 0.65, D: 0.5 },
        3: { A: 0.7, B: 0.68, C: 0.6, D: 0.55 },
      }),
      matchups: matchupsOf({
        1: ["A", "B", "C", "D"],
        2: ["A", "B", "C", "D"],
        3: ["A", "B", "C", "D"],
      }),
    };
    for (const strategy of ["greedy", "optimal"] as const) {
      const teams = buildPlan(bigger, strategy).map((r) => r.team);
      expect(new Set(teams).size).toBe(teams.length);
    }
  });

  it("reports a week with no feasible pick instead of inventing one", () => {
    const rows = buildPlan(
      {
        ...input,
        weeks: [1, 2, 3],
        matchups: matchupsOf({ 1: ["A", "B"], 2: ["A", "B"] }),
      },
      "optimal",
    );
    expect(rows[2]!.team).toBeNull();
    expect(rows[2]!.note).toBeTruthy();
  });

  it("compounds survival probability across weeks", () => {
    const rows = buildPlan(input, "optimal");
    expect(rows[0]!.cumulativeSurvival).toBeCloseTo(0.79, 10);
    expect(rows[1]!.cumulativeSurvival).toBeCloseTo(0.711, 10);
  });

  it("treats a bye week as unavailable rather than a zero-probability pick", () => {
    const m = matrixOf({ 1: { A: 0.8, B: 0.7 }, 2: { B: 0.6 } });
    const rows = buildPlan(
      {
        matrix: m,
        weeks: [1, 2],
        available: ["A", "B"],
        matchups: matchupsOf({ 1: ["A", "B"], 2: ["B"] }),
        config: { ...DEFAULT_CONFIG, lambda: 0 },
      },
      "optimal",
    );
    // B is the only team playing in week 2, so A must take week 1.
    expect(rows.map((r) => r.team)).toEqual(["A", "B"]);
  });
});
