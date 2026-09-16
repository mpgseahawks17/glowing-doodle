import { describe, expect, it } from "vitest";
import {
  blendProb,
  edge,
  pAlt,
  pickLater,
  scoreTeams,
  type WeekMatchup,
} from "@/lib/model/engine";
import {
  DEFAULT_CONFIG,
  type ModelConfig,
  type ProbMatrix,
} from "@/lib/model/types";

/** Build a ProbMatrix from a plain literal: week -> team -> inputs. */
function matrixOf(
  spec: Record<number, Record<string, { vegas?: number; silver?: number }>>,
): ProbMatrix {
  const m: ProbMatrix = new Map();
  for (const [week, teams] of Object.entries(spec)) {
    m.set(Number(week), new Map(Object.entries(teams)));
  }
  return m;
}

function matchupsOf(spec: Record<string, string>): Map<string, WeekMatchup> {
  return new Map(
    Object.entries(spec).map(([team, opp]) => [
      team,
      { opponent: opp, isHome: true },
    ]),
  );
}

const cfg = (over: Partial<ModelConfig> = {}): ModelConfig => ({
  ...DEFAULT_CONFIG,
  ...over,
});

describe("blendProb", () => {
  it("weights both sources when both are present", () => {
    expect(blendProb({ vegas: 0.6, silver: 0.8 })).toBeCloseTo(0.7, 10);
    expect(
      blendProb({ vegas: 0.6, silver: 0.8 }, { vegas: 0.75, silver: 0.25 }),
    ).toBeCloseTo(0.65, 10);
  });

  it("uses the lone available source rather than halving it", () => {
    // The brief: "If only one source has data for (T, w), use that source
    // alone." This matters more than it looks -- getting it wrong would
    // silently halve every forward-week probability, because Vegas data does
    // not exist beyond the current week.
    expect(blendProb({ silver: 0.8 })).toBeCloseTo(0.8, 10);
    expect(blendProb({ vegas: 0.62 })).toBeCloseTo(0.62, 10);
  });

  it("returns null when there is no data at all", () => {
    expect(blendProb({})).toBeNull();
    expect(blendProb(undefined)).toBeNull();
  });
});

describe("pAlt", () => {
  const m = matrixOf({
    1: { A: { vegas: 0.8 }, B: { vegas: 0.79 }, C: { vegas: 0.5 } },
  });

  it("returns the best alternative, excluding the subject team", () => {
    expect(pAlt(m, 1, "A", ["A", "B", "C"])).toBeCloseTo(0.79, 10);
    expect(pAlt(m, 1, "B", ["A", "B", "C"])).toBeCloseTo(0.8, 10);
  });

  it("returns 0 when no alternative exists", () => {
    expect(pAlt(m, 1, "A", ["A"])).toBe(0);
    expect(pAlt(m, 99, "A", ["A", "B"])).toBe(0);
  });
});

describe("edge", () => {
  const m = matrixOf({
    3: { A: { silver: 0.95 }, B: { silver: 0.5 } },
    4: { A: { silver: 0.4 }, B: { silver: 0.9 } },
  });

  it("measures advantage over the best alternative", () => {
    expect(edge(m, 3, "A", ["A", "B"])).toBeCloseTo(0.45, 10);
  });

  it("clips at zero when the team is not the best that week", () => {
    expect(edge(m, 4, "A", ["A", "B"])).toBe(0);
  });

  it("is zero on a bye week (team absent from that week)", () => {
    expect(edge(m, 5, "A", ["A", "B"])).toBe(0);
  });
});

describe("scoreTeams -- deferral behaviour", () => {
  /**
   * The scenario the brief describes: a team that is the best pick now AND has
   * a much stronger future spot should be DEFERRED in favour of a comparable
   * team with no future edge.
   *
   * Week 1: A 0.80, B 0.79, C 0.50
   * Week 3: A 0.95 (a huge future spot), everyone else 0.50
   * All other weeks: everyone 0.50
   *
   *   PickLater(A) = 0.95 - 0.50 = 0.45 ; PickLater(B) = PickLater(C) = 0
   *   Score(A) = 0.80 - 1.0(0.45) = 0.35
   *   Score(B) = 0.79 - 0         = 0.79   <-- wins
   *   Score(C) = 0.50 - 0         = 0.50
   */
  const flat = { A: { silver: 0.5 }, B: { silver: 0.5 }, C: { silver: 0.5 } };
  const m = matrixOf({
    1: { A: { vegas: 0.8 }, B: { vegas: 0.79 }, C: { vegas: 0.5 } },
    2: flat,
    3: { A: { silver: 0.95 }, B: { silver: 0.5 }, C: { silver: 0.5 } },
    4: flat,
    5: flat,
  });
  const available = ["A", "B", "C"];
  const matchups = matchupsOf({ A: "X", B: "Y", C: "Z" });

  it("computes PickNow as probability minus best alternative", () => {
    const rows = scoreTeams(m, 1, available, matchups);
    const byTeam = new Map(rows.map((r) => [r.team, r]));
    expect(byTeam.get("A")!.pickNow).toBeCloseTo(0.01, 10);
    expect(byTeam.get("B")!.pickNow).toBeCloseTo(-0.01, 10);
  });

  it("computes PickLater as the peak future edge and names its week", () => {
    const a = pickLater(m, 1, "A", available);
    expect(a.value).toBeCloseTo(0.45, 10);
    expect(a.week).toBe(3);
    expect(pickLater(m, 1, "B", available).value).toBe(0);
  });

  it("defers the strong-now-and-later team in favour of the runner-up", () => {
    const rows = scoreTeams(m, 1, available, matchups);
    expect(rows.map((r) => r.team)).toEqual(["B", "C", "A"]);
    expect(rows[0]!.score).toBeCloseTo(0.79, 10);
    expect(rows[2]!.score).toBeCloseTo(0.35, 10);
    expect(rows[0]!.recommendation).toBe("TOP PICK");
    expect(rows[2]!.recommendation).toBe("SAVE");
  });

  it("collapses to raw win probability at lambda = 0", () => {
    const rows = scoreTeams(m, 1, available, matchups, cfg({ lambda: 0 }));
    expect(rows.map((r) => r.team)).toEqual(["A", "B", "C"]);
    expect(rows[0]!.score).toBeCloseTo(0.8, 10);
  });

  it("defers harder as lambda rises", () => {
    const low = scoreTeams(m, 1, available, matchups, cfg({ lambda: 0.01 }));
    expect(low.map((r) => r.team)).toEqual(["A", "B", "C"]);
    const high = scoreTeams(m, 1, available, matchups, cfg({ lambda: 2 }));
    expect(high[high.length - 1]!.team).toBe("A");
  });
});

describe("scoreTeams -- data handling", () => {
  it("flags a Vegas/Silver discrepancy at or above the threshold", () => {
    const m = matrixOf({
      1: {
        A: { vegas: 0.6, silver: 0.66 },
        B: { vegas: 0.6, silver: 0.62 },
      },
    });
    const rows = scoreTeams(m, 1, ["A", "B"], matchupsOf({ A: "X", B: "Y" }));
    const byTeam = new Map(rows.map((r) => [r.team, r]));
    expect(byTeam.get("A")!.discrepancy).toBe(true);
    expect(byTeam.get("B")!.discrepancy).toBe(false);
  });

  it("sorts unpickable teams (bye / no data) to the bottom with a null score", () => {
    const m = matrixOf({ 1: { A: { vegas: 0.7 } } });
    const rows = scoreTeams(m, 1, ["A", "BYE"], matchupsOf({ A: "X" }));
    expect(rows[1]!.team).toBe("BYE");
    expect(rows[1]!.score).toBeNull();
    expect(rows[1]!.rank).toBe(0);
    expect(rows[0]!.rank).toBe(1);
  });

  /**
   * Regression guard for the constraint that drives this project's build order:
   * The Odds API publishes lines only for the current round, so every week in
   * the lookahead window carries Silver data alone. PickLater must still work.
   */
  it("computes PickLater from Silver alone in the forward window", () => {
    const m = matrixOf({
      1: { A: { vegas: 0.7, silver: 0.72 }, B: { vegas: 0.69, silver: 0.7 } },
      2: { A: { silver: 0.9 }, B: { silver: 0.5 } },
      3: { A: { silver: 0.5 }, B: { silver: 0.5 } },
      4: { A: { silver: 0.5 }, B: { silver: 0.5 } },
      5: { A: { silver: 0.5 }, B: { silver: 0.5 } },
    });
    const later = pickLater(m, 1, "A", ["A", "B"]);
    expect(later.value).toBeCloseTo(0.4, 10);
    expect(later.week).toBe(2);
  });
});

describe("pickLater strategies", () => {
  const m = matrixOf({
    1: { A: { silver: 0.5 }, B: { silver: 0.5 } },
    2: { A: { silver: 0.9 }, B: { silver: 0.5 } },
    3: { A: { silver: 0.8 }, B: { silver: 0.5 } },
    4: { A: { silver: 0.5 }, B: { silver: 0.5 } },
    5: { A: { silver: 0.5 }, B: { silver: 0.5 } },
  });

  it("max takes only the single best future spot (the brief's spec)", () => {
    expect(pickLater(m, 1, "A", ["A", "B"]).value).toBeCloseTo(0.4, 10);
  });

  it("topK accumulates the portfolio of future spots", () => {
    // Edges are 0.40 (wk2) and 0.30 (wk3); decay 0.5 -> 0.40 + 0.15 = 0.55.
    const value = pickLater(
      m,
      1,
      "A",
      ["A", "B"],
      cfg({ pickLater: { kind: "topK", k: 2, decay: 0.5 } }),
    ).value;
    expect(value).toBeCloseTo(0.55, 10);
  });
});
