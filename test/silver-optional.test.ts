import { describe, expect, it } from "vitest";
import { blendProb, scoreTeams, type WeekMatchup } from "@/lib/model/engine";
import { DEFAULT_CONFIG, type ProbMatrix } from "@/lib/model/types";

/**
 * Silver is optional: absent, the model runs on market data alone; present, it
 * is folded in according to the weight slider. These lock that behaviour in.
 */
function oneWeek(
  inputs: Record<string, { vegas?: number; silver?: number }>,
): ProbMatrix {
  return new Map([[1, new Map(Object.entries(inputs))]]);
}

const matchups = (teams: string[]): Map<string, WeekMatchup> =>
  new Map(teams.map((t) => [t, { opponent: "OPP", isHome: true }]));

describe("Silver is optional", () => {
  it("uses Vegas alone when no Silver has been uploaded", () => {
    const m = oneWeek({ A: { vegas: 0.7 }, B: { vegas: 0.6 } });
    const rows = scoreTeams(m, 1, ["A", "B"], matchups(["A", "B"]));
    expect(rows[0]!.blendedProb).toBeCloseTo(0.7, 10);
    expect(rows[0]!.silverProb).toBeNull();
    expect(rows[0]!.sourceDelta).toBeNull();
    expect(rows[0]!.discrepancy).toBe(false);
  });

  it("blends once Silver is uploaded, honouring the weight slider", () => {
    const m = oneWeek({ A: { vegas: 0.7, silver: 0.8 } });
    const mid = blendProb(m.get(1)!.get("A"), { vegas: 0.5, silver: 0.5 });
    const vegasHeavy = blendProb(m.get(1)!.get("A"), { vegas: 0.9, silver: 0.1 });
    const silverHeavy = blendProb(m.get(1)!.get("A"), { vegas: 0.1, silver: 0.9 });

    expect(mid).toBeCloseTo(0.75, 10);
    expect(vegasHeavy).toBeCloseTo(0.71, 10);
    expect(silverHeavy).toBeCloseTo(0.79, 10);
  });

  it("ignores the slider entirely for games Silver does not cover", () => {
    // A partially transcribed week is normal. Teams without a Silver number
    // must not move when the slider does.
    const m = oneWeek({ A: { vegas: 0.7 }, B: { vegas: 0.6, silver: 0.9 } });
    const teams = ["A", "B"];

    const atHalf = scoreTeams(m, 1, teams, matchups(teams), {
      ...DEFAULT_CONFIG,
      weights: { vegas: 0.5, silver: 0.5 },
    });
    const atSilverHeavy = scoreTeams(m, 1, teams, matchups(teams), {
      ...DEFAULT_CONFIG,
      weights: { vegas: 0.1, silver: 0.9 },
    });

    const a1 = atHalf.find((r) => r.team === "A")!;
    const a2 = atSilverHeavy.find((r) => r.team === "A")!;
    expect(a1.blendedProb).toBeCloseTo(0.7, 10);
    expect(a2.blendedProb).toBeCloseTo(0.7, 10);

    const b1 = atHalf.find((r) => r.team === "B")!;
    const b2 = atSilverHeavy.find((r) => r.team === "B")!;
    expect(b1.blendedProb).toBeCloseTo(0.75, 10);
    expect(b2.blendedProb).toBeCloseTo(0.87, 10);
  });
});

describe("source difference column", () => {
  it("is signed: positive when Silver rates the team above the market", () => {
    const m = oneWeek({ A: { vegas: 0.6, silver: 0.68 } });
    const rows = scoreTeams(m, 1, ["A"], matchups(["A"]));
    expect(rows[0]!.sourceDelta).toBeCloseTo(0.08, 10);
    expect(rows[0]!.discrepancy).toBe(true);
  });

  it("is negative when Silver is below the market", () => {
    const m = oneWeek({ A: { vegas: 0.7, silver: 0.61 } });
    const rows = scoreTeams(m, 1, ["A"], matchups(["A"]));
    expect(rows[0]!.sourceDelta).toBeCloseTo(-0.09, 10);
    expect(rows[0]!.discrepancy).toBe(true);
  });

  it("flags only at or beyond the threshold", () => {
    const under = scoreTeams(
      oneWeek({ A: { vegas: 0.6, silver: 0.64 } }),
      1,
      ["A"],
      matchups(["A"]),
    );
    expect(under[0]!.discrepancy).toBe(false);

    const exactly = scoreTeams(
      oneWeek({ A: { vegas: 0.6, silver: 0.65 } }),
      1,
      ["A"],
      matchups(["A"]),
    );
    expect(exactly[0]!.discrepancy).toBe(true);
  });

  it("carries the vegas source and book count through for display", () => {
    const m: ProbMatrix = new Map([
      [1, new Map([["A", { vegas: 0.7, vegasSource: "espn", vegasBooks: 1 }]])],
    ]);
    const rows = scoreTeams(m, 1, ["A"], matchups(["A"]));
    expect(rows[0]!.vegasSource).toBe("espn");
    expect(rows[0]!.vegasBooks).toBe(1);
  });
});
