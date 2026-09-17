import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/**
 * Schema notes
 * ------------
 * Probability tables (`oddsSnapshots`, `silverProjections`) are APPEND-ONLY.
 * We never update a row in place; each ingest run writes a new snapshot keyed by
 * `fetchedAt`. That keeps line movement inspectable ("the Bills drifted from -140
 * to -175 after Wednesday's injury report"), which is the whole reason the brief
 * asks for a daily refresh rather than a single pull.
 *
 * Reads that want "the current number" go through the repo layer, which selects
 * the max `fetchedAt` per game. See lib/db/repo/probabilities.ts.
 */

export const teams = sqliteTable("teams", {
  abbr: text("abbr").primaryKey(),
  name: text("name").notNull(),
  conference: text("conference").notNull(),
  division: text("division").notNull(),
});

export const games = sqliteTable(
  "games",
  {
    gameId: text("game_id").primaryKey(),
    season: integer("season").notNull(),
    week: integer("week").notNull(),
    gameType: text("game_type").notNull(),
    homeTeam: text("home_team").notNull().references(() => teams.abbr),
    awayTeam: text("away_team").notNull().references(() => teams.abbr),
    kickoffUtc: text("kickoff_utc"),
    /** nflverse `location`: "Home", or "Neutral" for a neutral-site game. */
    location: text("location"),
    /** Venue name, e.g. "Wembley Stadium". Display only. */
    stadium: text("stadium"),
    /**
     * nflverse venue code, e.g. "LON00". This is what identifies an
     * international game -- see `INTERNATIONAL_VENUES`. Note the code is not a
     * team prefix: Rogers Centre in Toronto is "BUF01".
     */
    stadiumId: text("stadium_id"),
    homeScore: integer("home_score"),
    awayScore: integer("away_score"),
  },
  (t) => ({
    seasonWeekIdx: index("games_season_week_idx").on(t.season, t.week),
    homeIdx: index("games_home_idx").on(t.season, t.homeTeam),
    awayIdx: index("games_away_idx").on(t.season, t.awayTeam),
  }),
);

export const oddsSnapshots = sqliteTable(
  "odds_snapshots",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    gameId: text("game_id").notNull().references(() => games.gameId),
    fetchedAt: text("fetched_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    /**
     * Where the line came from. These are NOT equal quality:
     *   odds-api  — median across ~10 US books, but current round only
     *   espn      — single book (DraftKings), covers ~8 weeks ahead
     *   nflverse  — single closing line, current round only
     * ESPN is the only source that reaches the lookahead window, so PickLater
     * runs on single-book numbers while the current week uses a median.
     */
    /**
     * Deliberately has NO default. A default let the nflverse ingest silently
     * inherit "odds-api", which both mislabelled the data and made a
     * source-scoped delete remove the wrong rows. Without a default, Drizzle's
     * insert type requires every call site to state its source.
     */
    source: text("source", {
      enum: ["odds-api", "espn", "nflverse", "manual"],
    }).notNull(),
    bookCount: integer("book_count").notNull(),
    homeMlMedian: real("home_ml_median"),
    awayMlMedian: real("away_ml_median"),
    /** De-vigged. homeProbDevig + awayProbDevig === 1.0 */
    homeProbDevig: real("home_prob_devig"),
    awayProbDevig: real("away_prob_devig"),
    rawJson: text("raw_json"),
  },
  (t) => ({
    gameFetchedIdx: index("odds_game_fetched_idx").on(t.gameId, t.fetchedAt),
  }),
);

/**
 * `ingestMethod` distinguishes real Silver numbers from our own fallback:
 *   api     — scraped from Silver Bulletin
 *   manual  — pasted in by hand via --from-file
 *   derived — computed from our Elo-style ratings because Silver was unavailable
 * The UI must visually distinguish `derived`, so a broken scrape is never
 * mistaken for a real second opinion.
 */
export const silverProjections = sqliteTable(
  "silver_projections",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    gameId: text("game_id").notNull().references(() => games.gameId),
    fetchedAt: text("fetched_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    /**
     * Nullable, and the two do NOT sum to 1.
     *
     * ELWAY is a win/loss/TIE model: homeProb + awayProb + tieProb = 1. So the
     * opponent's probability cannot be derived as 1 - p; doing so would inflate
     * it by the tie probability on every game. Each side must be supplied
     * independently, and either may be absent.
     */
    homeProb: real("home_prob"),
    awayProb: real("away_prob"),
    /** 1 - homeProb - awayProb, stored when both sides are known. */
    tieProb: real("tie_prob"),
    ingestMethod: text("ingest_method", {
      enum: ["api", "manual", "derived"],
    }).notNull(),
    /**
     * When the SOURCE computed this, not when we ingested it -- the two differ
     * by days and conflating them is actively misleading. ELWAY's sheet
     * publishes `updated_at` in its `_embed_metadata` tab; on 2026-09-14 the
     * live data was still stamped 2026-09-09, i.e. it had not yet priced week 1.
     * Null for hand-entered rows unless `--as-of` is passed.
     */
    sourceAsOf: text("source_as_of"),
    /**
     * The source's own version string, e.g. "forecasts-v1-16649-8e7e4e3f".
     *
     * Recorded for provenance only -- do NOT use it to detect a recompute.
     * Silver updates the sheet's Data tab without reliably bumping this field:
     * on 2026-09-16 all 256 games had moved while this string and `sourceAsOf`
     * both still read as of 2026-09-09. Use `contentHash` instead.
     */
    dataVersion: text("data_version"),
    /**
     * Our own fingerprint of the parsed games -- the authoritative
     * change-detection key. See contentHash() in lib/ingest/silver-sheet.ts.
     */
    contentHash: text("content_hash"),
    sourceNote: text("source_note"),
  },
  (t) => ({
    gameFetchedIdx: index("silver_game_fetched_idx").on(t.gameId, t.fetchedAt),
  }),
);

/** Elo-style ratings derived from accumulated de-vigged market probabilities. */
export const teamRatings = sqliteTable(
  "team_ratings",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    team: text("team").notNull().references(() => teams.abbr),
    asOf: text("as_of").notNull().default(sql`CURRENT_TIMESTAMP`),
    rating: real("rating").notNull(),
  },
  (t) => ({ teamAsOfIdx: index("ratings_team_asof_idx").on(t.team, t.asOf) }),
);

export const myPicks = sqliteTable(
  "my_picks",
  {
    season: integer("season").notNull(),
    week: integer("week").notNull(),
    team: text("team").notNull().references(() => teams.abbr),
    /** null = not yet played */
    result: text("result", { enum: ["win", "loss", "push"] }),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.season, t.week] }),
    // A team may be used at most once per season — the core survivor rule.
    seasonTeamIdx: uniqueIndex("my_picks_season_team_idx").on(t.season, t.team),
  }),
);

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export type Team = typeof teams.$inferSelect;
export type Game = typeof games.$inferSelect;
export type OddsSnapshot = typeof oddsSnapshots.$inferSelect;
export type SilverProjection = typeof silverProjections.$inferSelect;
export type MyPick = typeof myPicks.$inferSelect;
