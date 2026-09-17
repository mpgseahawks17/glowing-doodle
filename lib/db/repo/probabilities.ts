import { and, asc, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { db, schema } from "../client";
import type { ProbMatrix } from "@/lib/model/types";
import type { WeekMatchup } from "@/lib/model/engine";
import {
  byeTeams,
  foreignVenue,
  isDivisional,
  shortWeekLabel,
} from "@/lib/model/matchup-context";

/**
 * A snapshot is considered stale once it is this much older than the freshest
 * one available for the same game. Matches the UI's staleness threshold.
 */
const STALENESS_HOURS = 36;

type OddsRow = {
  gameId: string;
  fetchedAt: string;
  source: string;
  bookCount: number;
};

/**
 * Choose one odds snapshot per game.
 *
 * Sources are not equal quality. The Odds API returns a median across roughly
 * ten US books; ESPN and nflverse are single-book. So we rank by `bookCount`
 * rather than by recency alone, which means the current week automatically
 * prefers the Odds API median over ESPN's DraftKings line, while the lookahead
 * weeks -- where only ESPN has data -- still work.
 *
 * Ranking by book count rather than a hardcoded source list keeps this correct
 * if another feed is added later.
 *
 * The staleness guard matters: if the Odds API quota runs out mid-season, its
 * last median would otherwise be preferred forever over fresh ESPN lines. Once
 * the richer snapshot is more than STALENESS_HOURS behind the freshest one for
 * that game, freshness wins instead.
 */
export function pickBestOdds<T extends OddsRow>(rows: T[]): Map<string, T> {
  const byGame = new Map<string, T[]>();
  for (const row of rows) {
    const list = byGame.get(row.gameId);
    if (list) list.push(row);
    else byGame.set(row.gameId, [row]);
  }

  const best = new Map<string, T>();
  for (const [gameId, candidates] of byGame) {
    const freshest = candidates.reduce((a, b) =>
      Date.parse(b.fetchedAt) > Date.parse(a.fetchedAt) ? b : a,
    );
    const freshestAt = Date.parse(freshest.fetchedAt);

    const chosen = candidates.reduce((a, b) => {
      const staleness = (row: T) =>
        (freshestAt - Date.parse(row.fetchedAt)) / 3_600_000;
      const aStale = staleness(a) > STALENESS_HOURS;
      const bStale = staleness(b) > STALENESS_HOURS;

      // A stale snapshot loses to a current one regardless of book count.
      if (aStale !== bStale) return aStale ? b : a;
      if (b.bookCount !== a.bookCount) {
        return b.bookCount > a.bookCount ? b : a;
      }
      return Date.parse(b.fetchedAt) > Date.parse(a.fetchedAt) ? b : a;
    });

    best.set(gameId, chosen);
  }
  return best;
}

/**
 * Assemble the week -> team -> {vegas, silver} matrix the model consumes.
 *
 * The probability tables are append-only, so "current" means the newest row per
 * game. We read snapshots in ascending `fetchedAt` order and let later rows
 * overwrite earlier ones in a Map -- cheap, and it keeps the history intact for
 * the line-movement view rather than destroying it on write.
 *
 * A game contributes two entries: the home team at homeProb, the away team at
 * awayProb. Teams on bye simply never appear for that week, which is exactly
 * what the model's null handling expects.
 */
export async function buildProbMatrix(
  season: number,
  fromWeek: number,
  toWeek: number,
): Promise<{ matrix: ProbMatrix; gameIds: string[] }> {
  const games = await db
    .select()
    .from(schema.games)
    .where(
      and(
        eq(schema.games.season, season),
        gte(schema.games.week, fromWeek),
        lte(schema.games.week, toWeek),
      ),
    );

  const matrix: ProbMatrix = new Map();
  for (let w = fromWeek; w <= toWeek; w++) matrix.set(w, new Map());

  if (games.length === 0) return { matrix, gameIds: [] };

  const gameIds = games.map((g) => g.gameId);

  const odds = await db
    .select()
    .from(schema.oddsSnapshots)
    .where(inArray(schema.oddsSnapshots.gameId, gameIds))
    .orderBy(asc(schema.oddsSnapshots.fetchedAt));

  const silver = await db
    .select()
    .from(schema.silverProjections)
    .where(inArray(schema.silverProjections.gameId, gameIds))
    .orderBy(asc(schema.silverProjections.fetchedAt));

  const bestOdds = pickBestOdds(odds);

  const latestSilver = new Map<string, (typeof silver)[number]>();
  for (const row of silver) latestSilver.set(row.gameId, row);

  for (const game of games) {
    const week = matrix.get(game.week);
    if (!week) continue;

    const o = bestOdds.get(game.gameId);
    const s = latestSilver.get(game.gameId);

    const home = week.get(game.homeTeam) ?? {};
    const away = week.get(game.awayTeam) ?? {};

    if (o?.homeProbDevig != null) {
      home.vegas = o.homeProbDevig;
      home.vegasSource = o.source;
      home.vegasBooks = o.bookCount;
    }
    if (o?.awayProbDevig != null) {
      away.vegas = o.awayProbDevig;
      away.vegasSource = o.source;
      away.vegasBooks = o.bookCount;
    }

    // Each side is set independently and may be absent. ELWAY is a
    // win/loss/tie model, so one side's probability says nothing definite
    // about the other's -- never infer the missing one.
    if (s?.homeProb != null) {
      home.silver = s.homeProb;
      home.silverIsDerived = s.ingestMethod === "derived";
    }
    if (s?.awayProb != null) {
      away.silver = s.awayProb;
      away.silverIsDerived = s.ingestMethod === "derived";
    }

    week.set(game.homeTeam, home);
    week.set(game.awayTeam, away);
  }

  return { matrix, gameIds };
}

/**
 * Division lookup for every team, used to flag divisional matchups.
 * 32 rows, so this is a full-table read by design.
 */
async function divisionsByTeam(): Promise<
  Map<string, { conference: string; division: string }>
> {
  const rows = await db
    .select({
      abbr: schema.teams.abbr,
      conference: schema.teams.conference,
      division: schema.teams.division,
    })
    .from(schema.teams);
  return new Map(
    rows.map((r) => [r.abbr, { conference: r.conference, division: r.division }]),
  );
}

/** week -> the set of teams with a game that week. Absence from a week is a bye. */
function playedIndex(
  games: Array<{ week: number; homeTeam: string; awayTeam: string }>,
): Map<number, Set<string>> {
  const out = new Map<number, Set<string>>();
  for (const g of games) {
    let set = out.get(g.week);
    if (!set) out.set(g.week, (set = new Set()));
    set.add(g.homeTeam);
    set.add(g.awayTeam);
  }
  return out;
}

/** team -> opponent + home/away for a single week. Byes are simply absent. */
export async function matchupsForWeek(
  season: number,
  week: number,
): Promise<Map<string, WeekMatchup>> {
  // The previous week comes along so that "off a bye" can be answered; the
  // divisions table is 32 rows. Both are cheap next to the odds joins.
  const [games, divisions] = await Promise.all([
    db
      .select()
      .from(schema.games)
      .where(
        and(
          eq(schema.games.season, season),
          inArray(schema.games.week, [week - 1, week]),
        ),
      ),
    divisionsByTeam(),
  ]);

  const played = playedIndex(games);
  const onBye = byeTeams(played, week - 1, divisions.keys());

  const out = new Map<string, WeekMatchup>();
  for (const g of games) {
    if (g.week !== week) continue;
    const divisional = isDivisional(
      divisions.get(g.homeTeam),
      divisions.get(g.awayTeam),
    );
    const shortWeek = shortWeekLabel(g.kickoffUtc);
    const base = { shortWeek, divisional, foreign: foreignVenue(g.stadiumId) };

    out.set(g.homeTeam, {
      opponent: g.awayTeam,
      isHome: true,
      context: {
        ...base,
        offBye: onBye.has(g.homeTeam),
        oppOffBye: onBye.has(g.awayTeam),
      },
    });
    out.set(g.awayTeam, {
      opponent: g.homeTeam,
      isHome: false,
      context: {
        ...base,
        offBye: onBye.has(g.awayTeam),
        oppOffBye: onBye.has(g.homeTeam),
      },
    });
  }
  return out;
}

/**
 * Every week's matchups at once, for the 32x18 grid.
 * week -> team -> opponent/home-away. A team missing from a week is on bye.
 */
export async function allMatchups(
  season: number,
): Promise<Record<string, Record<string, WeekMatchup>>> {
  const [games, divisions] = await Promise.all([
    db.select().from(schema.games).where(eq(schema.games.season, season)),
    divisionsByTeam(),
  ]);

  const played = playedIndex(games);
  // Bye sets are computed once per week rather than per game: the same
  // previous-week lookup serves all 16 games in a week.
  const byeCache = new Map<number, Set<string>>();
  const byesBefore = (week: number): Set<string> => {
    let set = byeCache.get(week);
    if (!set) byeCache.set(week, (set = byeTeams(played, week - 1, divisions.keys())));
    return set;
  };

  const out: Record<string, Record<string, WeekMatchup>> = {};
  for (const g of games) {
    const week = String(g.week);
    out[week] ??= {};

    const onBye = byesBefore(g.week);
    const base = {
      shortWeek: shortWeekLabel(g.kickoffUtc),
      divisional: isDivisional(
        divisions.get(g.homeTeam),
        divisions.get(g.awayTeam),
      ),
      foreign: foreignVenue(g.stadiumId),
    };

    out[week][g.homeTeam] = {
      opponent: g.awayTeam,
      isHome: true,
      context: {
        ...base,
        offBye: onBye.has(g.homeTeam),
        oppOffBye: onBye.has(g.awayTeam),
      },
    };
    out[week][g.awayTeam] = {
      opponent: g.homeTeam,
      isHome: false,
      context: {
        ...base,
        offBye: onBye.has(g.awayTeam),
        oppOffBye: onBye.has(g.homeTeam),
      },
    };
  }
  return out;
}

/**
 * Freshness for the staleness banner.
 *
 * For Silver this reports WHEN THE NUMBERS LAST CHANGED, which is neither the
 * fetch time nor the source's own stamp.
 *
 * Fetch time is wrong because pressing Refresh re-pulls the same sheet: the
 * clock resets to "now" while the forecast underneath may be a week old.
 *
 * The source's `sourceAsOf` was the obvious substitute and is also wrong -- it
 * is not reliably maintained. On 2026-09-16 all 256 games carried new
 * probabilities and week 1 had been dropped, while `updated_at` still read
 * 2026-09-09. Reporting that stamp told the user ELWAY was a week stale at the
 * exact moment it had just been rewritten.
 *
 * What we can defend is the first time WE saw the current numbers: the earliest
 * fetch carrying the live `contentHash`. That is a lower bound on freshness --
 * the data is no older than the source claims and no newer than when we saw it
 * change -- and unlike the other two it cannot silently lie.
 *
 * Market odds have no separate vintage -- fetching them IS the vintage -- so
 * `odds` stays a fetch time.
 */
export async function dataFreshness(): Promise<{
  odds: string | null;
  /** When the ELWAY numbers last changed. Falls back to fetch time. */
  silver: string | null;
  /** When we last pulled it, for the tooltip. */
  silverFetchedAt: string | null;
  silverMethod: string | null;
  /** The source's own claimed vintage -- shown, but not trusted. See above. */
  silverSourceAsOf: string | null;
  /** True when the numbers moved while the source's stamp did not. */
  silverStampUnreliable: boolean;
}> {
  const [newestOdds] = await db
    .select({ fetchedAt: schema.oddsSnapshots.fetchedAt })
    .from(schema.oddsSnapshots)
    .orderBy(desc(schema.oddsSnapshots.fetchedAt))
    .limit(1);

  const [newestSilver] = await db
    .select({
      fetchedAt: schema.silverProjections.fetchedAt,
      sourceAsOf: schema.silverProjections.sourceAsOf,
      method: schema.silverProjections.ingestMethod,
      contentHash: schema.silverProjections.contentHash,
    })
    .from(schema.silverProjections)
    .orderBy(desc(schema.silverProjections.fetchedAt))
    .limit(1);

  // Earliest fetch still carrying the current fingerprint: when these exact
  // numbers first reached us, rather than when we last re-read them.
  let changedAt: string | null = null;
  if (newestSilver?.contentHash) {
    const [firstSeen] = await db
      .select({ fetchedAt: schema.silverProjections.fetchedAt })
      .from(schema.silverProjections)
      .where(eq(schema.silverProjections.contentHash, newestSilver.contentHash))
      .orderBy(asc(schema.silverProjections.fetchedAt))
      .limit(1);
    changedAt = firstSeen?.fetchedAt ?? null;
  }

  return {
    odds: newestOdds?.fetchedAt ?? null,
    silver: changedAt ?? newestSilver?.sourceAsOf ?? newestSilver?.fetchedAt ?? null,
    silverFetchedAt: newestSilver?.fetchedAt ?? null,
    silverMethod: newestSilver?.method ?? null,
    silverSourceAsOf: newestSilver?.sourceAsOf ?? null,
    silverStampUnreliable:
      changedAt != null &&
      newestSilver?.sourceAsOf != null &&
      Date.parse(changedAt) - Date.parse(newestSilver.sourceAsOf) > 36 * 3600_000,
  };
}
