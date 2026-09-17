import type { ProbMatrix } from "./types";

/**
 * Which sources actually cover each week.
 *
 * The horizon can now reach the end of the season, but the data behind those
 * weeks is not uniform: ESPN publishes a lookahead only a few weeks out, so
 * the far end of a long window is ELWAY alone. A plan that spans both should
 * say where the market stops rather than presenting 17 weeks as equally
 * grounded.
 *
 * Derived from the matrix on every render, so it moves on its own as ESPN
 * prices more weeks -- there is nothing to update by hand.
 */

export interface WeekCoverage {
  week: number;
  /** A bookmaker price exists for at least one game. */
  market: boolean;
  /** An ELWAY projection exists for at least one game. */
  silver: boolean;
}

export interface CoverageSummary {
  weeks: WeekCoverage[];
  /** Weeks priced by both a bookmaker and ELWAY. */
  both: number[];
  /** Weeks ELWAY covers but no bookmaker has priced yet. */
  silverOnly: number[];
  /** Weeks with a market price but no ELWAY projection. */
  marketOnly: number[];
  /** Weeks with nothing at all. */
  none: number[];
  /** Last week any bookmaker has priced. null when none have. */
  lastMarketWeek: number | null;
}

export function coverageFor(
  matrix: ProbMatrix,
  fromWeek: number,
  toWeek: number,
): CoverageSummary {
  const weeks: WeekCoverage[] = [];

  for (let w = fromWeek; w <= toWeek; w++) {
    const teams = matrix.get(w);
    let market = false;
    let silver = false;
    for (const inputs of teams?.values() ?? []) {
      if (inputs.vegas !== undefined) market = true;
      if (inputs.silver !== undefined) silver = true;
      if (market && silver) break;
    }
    weeks.push({ week: w, market, silver });
  }

  const pick = (fn: (c: WeekCoverage) => boolean) =>
    weeks.filter(fn).map((c) => c.week);

  const marketWeeks = pick((c) => c.market);

  return {
    weeks,
    both: pick((c) => c.market && c.silver),
    silverOnly: pick((c) => !c.market && c.silver),
    marketOnly: pick((c) => c.market && !c.silver),
    none: pick((c) => !c.market && !c.silver),
    lastMarketWeek: marketWeeks.at(-1) ?? null,
  };
}

/**
 * Render a week list as compact ranges: [11,12,13,15] -> "11-13, 15".
 *
 * Coverage is usually contiguous, so listing every week wastes the line and
 * makes a gap -- which is the interesting case -- harder to spot, not easier.
 */
export function formatWeekRanges(weeks: number[]): string {
  if (weeks.length === 0) return "none";

  const sorted = [...weeks].sort((a, b) => a - b);
  const parts: string[] = [];
  let start = sorted[0]!;
  let prev = start;

  for (const w of sorted.slice(1)) {
    if (w === prev + 1) {
      prev = w;
      continue;
    }
    parts.push(start === prev ? `${start}` : `${start}–${prev}`);
    start = w;
    prev = w;
  }
  parts.push(start === prev ? `${start}` : `${start}–${prev}`);

  return parts.join(", ");
}
