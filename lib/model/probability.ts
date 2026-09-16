/**
 * Moneyline -> probability conversions.
 *
 * The brief specifies: "Take median moneyline across bookmakers, convert
 * American to implied prob, de-vig by normalizing home + away to sum to 1.0."
 *
 * We take the median in PROBABILITY space rather than in raw American-odds
 * space. For an odd number of books the two are identical (American odds are
 * monotonic in probability, so the middle element is the same either way), but
 * for an EVEN number of books the median averages the two middle values — and
 * averaging American odds across the +/-100 boundary is meaningless: the mean of
 * -105 and +102 is -1.5, which is not a valid moneyline. In probability space
 * the same pair averages to 0.5035, which is correct. Same rule, safer math.
 */

/** American moneyline -> implied probability (vig included). */
export function americanToImplied(ml: number): number {
  if (!Number.isFinite(ml) || ml === 0) {
    throw new Error(`Invalid American moneyline: ${ml}`);
  }
  return ml < 0 ? -ml / (-ml + 100) : 100 / (ml + 100);
}

/**
 * Implied probability -> American moneyline.
 *
 * Inverts americanToImplied everywhere except exactly 0.5, where the mapping is
 * genuinely ambiguous: +100 and -100 are both even money and imply the same
 * probability, so no inverse can recover which form you started from. We
 * canonicalise 0.5 to -100. This value is display-only, so the choice is
 * cosmetic -- the model always works from the probability, never from this.
 */
export function impliedToAmerican(p: number): number {
  if (!(p > 0 && p < 1)) {
    throw new Error(`Probability out of range (0,1): ${p}`);
  }
  return p >= 0.5 ? -(100 * p) / (1 - p) : (100 * (1 - p)) / p;
}

export function median(values: number[]): number {
  if (values.length === 0) throw new Error("median() of empty array");
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

/**
 * Remove the bookmaker's vig by normalizing the pair to sum to 1.0.
 * This is the "multiplicative" / proportional method — the one the brief asks
 * for. (Shin and power methods exist and shade favorites differently, but
 * proportional is what the sheet used and the difference is <1% at NFL prices.)
 */
export function devigPair(
  homeImplied: number,
  awayImplied: number,
): { home: number; away: number } {
  const total = homeImplied + awayImplied;
  if (total <= 0) throw new Error("De-vig of non-positive total probability");
  return { home: homeImplied / total, away: awayImplied / total };
}

export interface BookQuote {
  bookmaker: string;
  homeMl: number;
  awayMl: number;
}

export interface ConsensusOdds {
  bookCount: number;
  /** Median moneyline, reconstructed from the median probability (display). */
  homeMlMedian: number;
  awayMlMedian: number;
  /** De-vigged, sums to exactly 1.0. */
  homeProbDevig: number;
  awayProbDevig: number;
}

/** Median across books, then de-vig. Returns null if no usable quotes. */
export function consensusFromBooks(quotes: BookQuote[]): ConsensusOdds | null {
  const usable = quotes.filter(
    (q) =>
      Number.isFinite(q.homeMl) &&
      Number.isFinite(q.awayMl) &&
      q.homeMl !== 0 &&
      q.awayMl !== 0,
  );
  if (usable.length === 0) return null;

  const homeMedianImplied = median(usable.map((q) => americanToImplied(q.homeMl)));
  const awayMedianImplied = median(usable.map((q) => americanToImplied(q.awayMl)));
  const devigged = devigPair(homeMedianImplied, awayMedianImplied);

  return {
    bookCount: usable.length,
    homeMlMedian: impliedToAmerican(homeMedianImplied),
    awayMlMedian: impliedToAmerican(awayMedianImplied),
    homeProbDevig: devigged.home,
    awayProbDevig: devigged.away,
  };
}
