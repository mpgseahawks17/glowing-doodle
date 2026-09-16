import { describe, expect, it } from "vitest";

/**
 * The week-detection rule, extracted so it can be tested without a database.
 * Mirrors the loop in lib/ingest/week.ts: the first week where most games are
 * still unplayed is the week you are picking for.
 */
function pickWeek(
  rows: Array<{ week: number; total: number; unplayed: number }>,
  fallback: number,
): number {
  for (const r of rows) {
    if (r.unplayed * 2 > r.total) return r.week;
  }
  return fallback;
}

describe("current pick week", () => {
  it("advances past a finished week even with the Monday game outstanding", () => {
    // The exact case that was wrong: Monday after week 1, MNF still to play.
    const week = pickWeek(
      [
        { week: 1, total: 16, unplayed: 1 },
        { week: 2, total: 16, unplayed: 16 },
      ],
      18,
    );
    expect(week).toBe(2);
  });

  it("stays on the current week after its Thursday game", () => {
    // Saturday of week 2: TNF played, deadline is Sunday morning, still week 2.
    const week = pickWeek(
      [
        { week: 1, total: 16, unplayed: 0 },
        { week: 2, total: 16, unplayed: 15 },
        { week: 3, total: 16, unplayed: 16 },
      ],
      18,
    );
    expect(week).toBe(2);
  });

  it("advances once the main slate has been played", () => {
    // Sunday evening: most of week 2 is done, so week 3 is the live decision.
    const week = pickWeek(
      [
        { week: 1, total: 16, unplayed: 0 },
        { week: 2, total: 16, unplayed: 3 },
        { week: 3, total: 16, unplayed: 16 },
      ],
      18,
    );
    expect(week).toBe(3);
  });

  it("handles a short week correctly (byes)", () => {
    const week = pickWeek(
      [
        { week: 5, total: 15, unplayed: 2 },
        { week: 6, total: 14, unplayed: 14 },
      ],
      18,
    );
    expect(week).toBe(6);
  });

  it("returns week 1 before any game is played", () => {
    const week = pickWeek(
      [
        { week: 1, total: 16, unplayed: 16 },
        { week: 2, total: 16, unplayed: 16 },
      ],
      18,
    );
    expect(week).toBe(1);
  });

  it("falls back to the final week once the season is over", () => {
    const week = pickWeek(
      [
        { week: 17, total: 16, unplayed: 0 },
        { week: 18, total: 16, unplayed: 0 },
      ],
      18,
    );
    expect(week).toBe(18);
  });

  it("treats an exactly-half-played week as started", () => {
    // 8 of 16 unplayed is not a majority, so the week has begun.
    const week = pickWeek(
      [
        { week: 2, total: 16, unplayed: 8 },
        { week: 3, total: 16, unplayed: 16 },
      ],
      18,
    );
    expect(week).toBe(3);
  });
});
