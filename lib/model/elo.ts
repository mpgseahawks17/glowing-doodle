/**
 * Minimal NFL Elo, used only by the backtest.
 *
 * Why it exists: `games.csv` carries closing moneylines for every game of a
 * finished season. Using week 9's closing line while deciding week 2 would be
 * lookahead bias -- and it would systematically favour longer horizons, which
 * is precisely the comparison the backtest is trying to make. So future weeks
 * must be projected from information available at the time, which is what a
 * rating carried forward from completed games gives us.
 *
 * Parameters follow the well-known FiveThirtyEight NFL Elo setup: K = 20,
 * home-field worth 65 rating points, a margin-of-victory multiplier, and a
 * regression toward the mean between seasons. It is not meant to beat the
 * market -- it only needs to be a fair stand-in for "what you could have known
 * about week N+5 at the time", applied identically to every horizon.
 */

export const ELO_BASE = 1500;
const K = 20;
const HOME_FIELD = 65;
/** Between seasons, pull a third of the way back to average. */
const SEASON_REGRESSION = 0.67;

export type Ratings = Map<string, number>;

export function newRatings(teams: string[]): Ratings {
  return new Map(teams.map((t) => [t, ELO_BASE]));
}

export function regressBetweenSeasons(ratings: Ratings): Ratings {
  const out: Ratings = new Map();
  for (const [team, r] of ratings) {
    out.set(team, ELO_BASE + (r - ELO_BASE) * SEASON_REGRESSION);
  }
  return out;
}

/** Probability the home team wins, before considering ties. */
export function eloWinProb(
  ratings: Ratings,
  homeTeam: string,
  awayTeam: string,
): number {
  const rh = (ratings.get(homeTeam) ?? ELO_BASE) + HOME_FIELD;
  const ra = ratings.get(awayTeam) ?? ELO_BASE;
  return 1 / (1 + 10 ** (-(rh - ra) / 400));
}

/** Apply one completed game. `margin` is home score minus away score. */
export function updateRatings(
  ratings: Ratings,
  homeTeam: string,
  awayTeam: string,
  margin: number,
): void {
  const expected = eloWinProb(ratings, homeTeam, awayTeam);
  const actual = margin > 0 ? 1 : margin < 0 ? 0 : 0.5;

  // Margin-of-victory multiplier, damped by the favourite's rating edge so
  // blowouts by heavy favourites move ratings less.
  const rh = (ratings.get(homeTeam) ?? ELO_BASE) + HOME_FIELD;
  const ra = ratings.get(awayTeam) ?? ELO_BASE;
  const eloDiffWinner = margin > 0 ? rh - ra : ra - rh;
  const mov =
    Math.log(Math.abs(margin) + 1) * (2.2 / (eloDiffWinner * 0.001 + 2.2));

  const shift = K * mov * (actual - expected);
  ratings.set(homeTeam, (ratings.get(homeTeam) ?? ELO_BASE) + shift);
  ratings.set(awayTeam, (ratings.get(awayTeam) ?? ELO_BASE) - shift);
}
