import { describe, expect, it } from "vitest";
import { parseSilverText } from "@/lib/ingest/silver-parse";

describe("parseSilverText", () => {
  it("reads week headings and team/probability pairs", () => {
    const { projections, errors } = parseSilverText(`
# ELWAY week 2-3
week 2
KC 58
PHI 71.5

week 3
BUF 0.70
`);
    expect(errors).toEqual([]);
    expect(projections).toEqual([
      { week: 2, team: "KC", prob: 0.58, line: 4 },
      { week: 2, team: "PHI", prob: 0.715, line: 5 },
      { week: 3, team: "BUF", prob: 0.7, line: 8 },
    ]);
  });

  it("accepts percentages, decimals and percent signs interchangeably", () => {
    const { projections, errors } = parseSilverText(
      "week 1\nKC 58\nPHI 58%\nBUF 0.58",
    );
    expect(errors).toEqual([]);
    expect(projections.map((p) => p.prob)).toEqual([0.58, 0.58, 0.58]);
  });

  it("accepts full team names as well as abbreviations", () => {
    const { projections, errors } = parseSilverText(
      "week 1\nKansas City Chiefs 58\nLos Angeles Rams 62",
    );
    expect(errors).toEqual([]);
    expect(projections.map((p) => p.team)).toEqual(["KC", "LA"]);
  });

  it("rejects an unknown team rather than guessing", () => {
    const { errors } = parseSilverText("week 1\nKCX 58");
    expect(errors.some((e) => e.includes('unknown team "KCX"'))).toBe(true);
  });

  it("rejects an entry that appears before any week heading", () => {
    const { errors } = parseSilverText("KC 58");
    expect(errors.some((e) => e.includes("before any"))).toBe(true);
  });

  it("rejects the same team twice in one week", () => {
    const { errors } = parseSilverText("week 1\nKC 58\nKC 60");
    expect(errors.some((e) => e.includes("already given"))).toBe(true);
  });

  it("rejects out-of-range and implausible probabilities", () => {
    expect(parseSilverText("week 1\nKC 0").errors.length).toBe(1);
    expect(parseSilverText("week 1\nKC 100").errors.length).toBe(1);
    // 3% would be an extraordinary NFL line -- almost certainly a slip.
    expect(parseSilverText("week 1\nKC 3").errors.length).toBe(1);
  });

  it("rejects a week outside 1-18", () => {
    const { errors } = parseSilverText("week 22\nKC 58");
    expect(errors.some((e) => e.includes("outside 1-18"))).toBe(true);
  });

  it("ignores comments, blank lines and markdown bullets", () => {
    const { projections, errors } = parseSilverText(`
# pasted from the ELWAY page
## week 2
- KC 58
* PHI 61
`);
    expect(errors).toEqual([]);
    expect(projections.map((p) => p.team)).toEqual(["KC", "PHI"]);
    expect(projections.every((p) => p.week === 2)).toBe(true);
  });

  it("tolerates comma and colon separators", () => {
    const { projections, errors } = parseSilverText("week 1\nKC, 58\nPHI: 61");
    expect(errors).toEqual([]);
    expect(projections.map((p) => p.prob)).toEqual([0.58, 0.61]);
  });
});
