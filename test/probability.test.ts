import { describe, expect, it } from "vitest";
import {
  americanToImplied,
  consensusFromBooks,
  devigPair,
  impliedToAmerican,
  median,
} from "@/lib/model/probability";

describe("americanToImplied", () => {
  it("converts favorites (negative odds)", () => {
    expect(americanToImplied(-150)).toBeCloseTo(0.6, 10);
    expect(americanToImplied(-200)).toBeCloseTo(2 / 3, 10);
    expect(americanToImplied(-110)).toBeCloseTo(110 / 210, 10);
  });

  it("converts underdogs (positive odds)", () => {
    expect(americanToImplied(150)).toBeCloseTo(0.4, 10);
    expect(americanToImplied(100)).toBeCloseTo(0.5, 10);
  });

  it("rejects zero and non-finite input", () => {
    expect(() => americanToImplied(0)).toThrow();
    expect(() => americanToImplied(Number.NaN)).toThrow();
  });
});

describe("impliedToAmerican", () => {
  it("inverts americanToImplied away from even money", () => {
    for (const ml of [-350, -200, -150, -110, 101, 145, 240, 600]) {
      expect(impliedToAmerican(americanToImplied(ml))).toBeCloseTo(ml, 8);
    }
  });

  it("canonicalises even money, which has no unique inverse", () => {
    // +100 and -100 are the same bet: both imply exactly 0.5. Nothing can
    // recover which form the book quoted, so we always emit -100.
    expect(americanToImplied(100)).toBeCloseTo(0.5, 12);
    expect(americanToImplied(-100)).toBeCloseTo(0.5, 12);
    expect(impliedToAmerican(0.5)).toBe(-100);
  });

  it("rejects probabilities outside (0,1)", () => {
    expect(() => impliedToAmerican(0)).toThrow();
    expect(() => impliedToAmerican(1)).toThrow();
  });
});

describe("median", () => {
  it("returns the middle value for odd counts", () => {
    expect(median([3, 1, 2])).toBe(2);
  });

  it("averages the two middle values for even counts", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
});

describe("devigPair", () => {
  it("normalizes a pair to sum to exactly 1.0", () => {
    // A -110/-110 market: each side implies 0.5238, total 1.0476 (4.76% vig).
    const implied = americanToImplied(-110);
    const { home, away } = devigPair(implied, implied);
    expect(home).toBeCloseTo(0.5, 12);
    expect(away).toBeCloseTo(0.5, 12);
    expect(home + away).toBeCloseTo(1, 12);
  });
});

describe("consensusFromBooks", () => {
  it("takes the median across books then de-vigs", () => {
    // Median home ML is -200 (implied 0.666667), median away is +170 (0.370370).
    // Total 1.037037 -> home 0.642857, away 0.357143.
    const result = consensusFromBooks([
      { bookmaker: "a", homeMl: -200, awayMl: 170 },
      { bookmaker: "b", homeMl: -210, awayMl: 175 },
      { bookmaker: "c", homeMl: -190, awayMl: 165 },
    ]);
    expect(result).not.toBeNull();
    expect(result!.bookCount).toBe(3);
    expect(result!.homeProbDevig).toBeCloseTo(0.642857, 6);
    expect(result!.awayProbDevig).toBeCloseTo(0.357143, 6);
    expect(result!.homeProbDevig + result!.awayProbDevig).toBeCloseTo(1, 12);
    expect(result!.homeMlMedian).toBeCloseTo(-200, 6);
  });

  it("handles an even book count straddling the +/-100 boundary", () => {
    // The reason we median in probability space: the mean of -105 and +102 as
    // raw American odds is -1.5, which is not a valid moneyline.
    const result = consensusFromBooks([
      { bookmaker: "a", homeMl: -105, awayMl: -115 },
      { bookmaker: "b", homeMl: 102, awayMl: -122 },
    ]);
    expect(result).not.toBeNull();
    expect(result!.homeProbDevig).toBeGreaterThan(0);
    expect(result!.homeProbDevig).toBeLessThan(1);
    expect(result!.homeProbDevig + result!.awayProbDevig).toBeCloseTo(1, 12);
    // Median implied: home (0.5121951+0.4950495)/2, away (0.5348837+0.5495495)/2
    expect(result!.homeProbDevig).toBeCloseTo(0.481548, 5);
  });

  it("ignores unusable quotes and returns null when none remain", () => {
    expect(
      consensusFromBooks([{ bookmaker: "a", homeMl: 0, awayMl: 0 }]),
    ).toBeNull();
    expect(consensusFromBooks([])).toBeNull();
  });
});
