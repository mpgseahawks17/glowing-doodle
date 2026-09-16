import { and, asc, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { db, schema } from "../client";

/**
 * Side-by-side view of what each feed currently says about one week's games.
 *
 * The scorecard deliberately collapses the feeds into a single blended number,
 * which hides disagreements and hides staleness. This view does the opposite:
 * one row per game, one column per source, so a feed that has not refreshed
 * (or that disagrees sharply with the market) is obvious at a glance.
 */

export interface SourceReading {
  home: number | null;
  away: number | null;
  fetchedAt: string;
  /**
   * When the SOURCE computed this, where it tells us — distinct from
   * `fetchedAt`, which is only when we pulled it. ELWAY publishes an
   * `updated_at` that has run days behind our ingest time, and showing the
   * ingest time would report the stalest feed as the freshest.
   */
  sourceAsOf?: string | null;
  /** Bookmakers behind the number. 1 = single book, ~10 = a real median. */
  books?: number;
}

export interface GameSources {
  gameId: string;
  week: number;
  homeTeam: string;
  awayTeam: string;
  kickoffUtc: string | null;
  played: boolean;
  silver: SourceReading | null;
  espn: SourceReading | null;
  oddsApi: SourceReading | null;
  nflverse: SourceReading | null;
}

export type SourceKey = "silver" | "espn" | "oddsApi" | "nflverse";

export interface SourceSummary {
  fromWeek: number;
  toWeek: number;
  games: GameSources[];
  /** Newest fetch time per source, and how many games in range it covers. */
  coverage: Record<SourceKey, { games: number; newest: string | null }>;
}

/**
 * Compare sources across a range of weeks.
 *
 * The range matters because the feeds have different reach: ELWAY and ESPN both
 * publish a lookahead covering many weeks, while the Odds API only ever returns
 * the current round. Its column is therefore legitimately empty for future
 * weeks -- that is the API's shape, not missing data.
 */
export async function sourceComparison(
  season: number,
  fromWeek: number,
  toWeek: number,
): Promise<SourceSummary> {
  const games = await db
    .select()
    .from(schema.games)
    .where(
      and(
        eq(schema.games.season, season),
        gte(schema.games.week, fromWeek),
        lte(schema.games.week, toWeek),
      ),
    )
    .orderBy(
      asc(schema.games.week),
      asc(schema.games.kickoffUtc),
      asc(schema.games.gameId),
    );

  // Typed explicitly rather than with `satisfies`: inference would narrow
  // `newest` to `null` and reject the timestamps assigned later.
  const empty: SourceSummary["coverage"] = {
    silver: { games: 0, newest: null },
    espn: { games: 0, newest: null },
    oddsApi: { games: 0, newest: null },
    nflverse: { games: 0, newest: null },
  };

  if (games.length === 0) {
    return { fromWeek, toWeek, games: [], coverage: empty };
  }

  const ids = games.map((g) => g.gameId);

  // Ascending so the last row written per (game, source) wins.
  const odds = await db
    .select()
    .from(schema.oddsSnapshots)
    .where(inArray(schema.oddsSnapshots.gameId, ids))
    .orderBy(asc(schema.oddsSnapshots.fetchedAt));

  const silverRows = await db
    .select()
    .from(schema.silverProjections)
    .where(inArray(schema.silverProjections.gameId, ids))
    .orderBy(asc(schema.silverProjections.fetchedAt));

  const bySource = new Map<string, Map<string, (typeof odds)[number]>>();
  for (const row of odds) {
    const m = bySource.get(row.source) ?? new Map();
    m.set(row.gameId, row);
    bySource.set(row.source, m);
  }

  const latestSilver = new Map<string, (typeof silverRows)[number]>();
  for (const row of silverRows) latestSilver.set(row.gameId, row);

  const reading = (
    row: (typeof odds)[number] | undefined,
  ): SourceReading | null =>
    row
      ? {
          home: row.homeProbDevig,
          away: row.awayProbDevig,
          fetchedAt: row.fetchedAt,
          books: row.bookCount,
        }
      : null;

  const coverage = structuredClone(empty);
  const bump = (key: SourceKey, fetchedAt: string | undefined) => {
    if (!fetchedAt) return;
    coverage[key].games += 1;
    if (!coverage[key].newest || fetchedAt > coverage[key].newest!) {
      coverage[key].newest = fetchedAt;
    }
  };

  const rows: GameSources[] = games.map((g) => {
    const s = latestSilver.get(g.gameId);
    const espn = reading(bySource.get("espn")?.get(g.gameId));
    const oddsApi = reading(bySource.get("odds-api")?.get(g.gameId));
    const nflverse = reading(bySource.get("nflverse")?.get(g.gameId));
    const silver: SourceReading | null = s
      ? {
          home: s.homeProb,
          away: s.awayProb,
          fetchedAt: s.fetchedAt,
          sourceAsOf: s.sourceAsOf,
        }
      : null;

    // Age ELWAY by when Silver computed it, falling back to our fetch time for
    // hand-entered rows that carry no vintage.
    bump("silver", silver?.sourceAsOf ?? silver?.fetchedAt);
    bump("espn", espn?.fetchedAt);
    bump("oddsApi", oddsApi?.fetchedAt);
    bump("nflverse", nflverse?.fetchedAt);

    return {
      gameId: g.gameId,
      week: g.week,
      homeTeam: g.homeTeam,
      awayTeam: g.awayTeam,
      kickoffUtc: g.kickoffUtc,
      played: g.homeScore !== null,
      silver,
      espn,
      oddsApi,
      nflverse,
    };
  });

  return { fromWeek, toWeek, games: rows, coverage };
}

/**
 * Last week holding any probability data, so callers can scope a range to what
 * actually exists rather than to a fixed lookahead.
 */
export async function lastWeekWithData(season: number): Promise<number> {
  const [row] = await db
    .select({ week: schema.games.week })
    .from(schema.games)
    .innerJoin(
      schema.oddsSnapshots,
      eq(schema.oddsSnapshots.gameId, schema.games.gameId),
    )
    .where(eq(schema.games.season, season))
    .orderBy(desc(schema.games.week))
    .limit(1);

  return row?.week ?? 1;
}
