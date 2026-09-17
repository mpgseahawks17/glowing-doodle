import { describe, expect, it } from "vitest";
import { coverageFor, formatWeekRanges } from "@/lib/model/coverage";
import type { ProbMatrix, ProbInputs } from "@/lib/model/types";

/** week -> team -> which sources carry a number. */
function matrixOf(
  spec: Record<number, Record<string, ProbInputs>>,
): ProbMatrix {
  const m: ProbMatrix = new Map();
  for (const [week, teams] of Object.entries(spec)) {
    m.set(Number(week), new Map(Object.entries(teams)));
  }
  return m;
}

describe("formatWeekRanges", () => {
  it("collapses a run", () => {
    expect(formatWeekRanges([11, 12, 13, 14])).toBe("11–14");
  });

  it("keeps gaps visible", () => {
    expect(formatWeekRanges([11, 12, 13, 15])).toBe("11–13, 15");
  });

  it("handles singles and unsorted input", () => {
    expect(formatWeekRanges([7])).toBe("7");
    expect(formatWeekRanges([5, 2, 3])).toBe("2–3, 5");
  });

  it("says none rather than rendering an empty string", () => {
    expect(formatWeekRanges([])).toBe("none");
  });
});

describe("coverageFor", () => {
  /**
   * The shape the live board actually has: ESPN's lookahead runs out partway
   * through, ELWAY covers the rest, and the far weeks are ELWAY alone.
   */
  const matrix = matrixOf({
    2: { SF: { vegas: 0.87, silver: 0.75 }, MIA: { vegas: 0.13, silver: 0.25 } },
    3: { KC: { vegas: 0.74, silver: 0.74 } },
    4: { BAL: { silver: 0.79 } },
    5: { DET: { silver: 0.68 } },
    6: {},
  });

  it("splits weeks by which sources cover them", () => {
    const c = coverageFor(matrix, 2, 6);
    expect(c.both).toEqual([2, 3]);
    expect(c.silverOnly).toEqual([4, 5]);
    expect(c.marketOnly).toEqual([]);
    expect(c.none).toEqual([6]);
  });

  it("reports where the market stops", () => {
    expect(coverageFor(matrix, 2, 6).lastMarketWeek).toBe(3);
  });

  it("treats a week missing from the matrix as uncovered", () => {
    const c = coverageFor(matrix, 2, 8);
    expect(c.none).toEqual([6, 7, 8]);
  });

  it("counts a week as covered when any single game has a number", () => {
    // Only one of the two teams carries a market price; the week still counts
    // as market-covered, because the question is whether ESPN has reached it.
    const partial = matrixOf({
      9: { GB: { vegas: 0.6, silver: 0.6 }, CHI: { silver: 0.4 } },
    });
    const c = coverageFor(partial, 9, 9);
    expect(c.both).toEqual([9]);
  });

  it("reports no market week when nothing is priced", () => {
    const silverOnly = matrixOf({ 12: { JAX: { silver: 0.72 } } });
    const c = coverageFor(silverOnly, 12, 12);
    expect(c.lastMarketWeek).toBeNull();
    expect(c.silverOnly).toEqual([12]);
  });

  it("detects a market week with no ELWAY behind it", () => {
    // Week 1 on the live board: played, priced, and dropped from ELWAY's sheet.
    const m = matrixOf({ 1: { SEA: { vegas: 0.7 } } });
    expect(coverageFor(m, 1, 1).marketOnly).toEqual([1]);
  });
});
