import Database from "better-sqlite3";
import { writeFileSync } from "node:fs";

const db = new Database("./data/survivor.db");

const rows = db
  .prepare(
    `SELECT g.week, g.home_team, g.away_team, g.kickoff_utc,
            g.home_score IS NOT NULL AS played,
            o.home_prob_devig AS o_home, o.away_prob_devig AS o_away,
            o.book_count, o.source AS o_source,
            s.home_prob AS s_home, s.away_prob AS s_away, s.source_as_of
     FROM games g
     LEFT JOIN (
       SELECT game_id, home_prob_devig, away_prob_devig, book_count, source,
              ROW_NUMBER() OVER (PARTITION BY game_id
                ORDER BY book_count DESC, fetched_at DESC) rn
       FROM odds_snapshots
     ) o ON o.game_id = g.game_id AND o.rn = 1
     LEFT JOIN (
       SELECT game_id, home_prob, away_prob, source_as_of,
              ROW_NUMBER() OVER (PARTITION BY game_id ORDER BY fetched_at DESC) rn
       FROM silver_projections
     ) s ON s.game_id = g.game_id AND s.rn = 1
     WHERE g.season = 2026
     ORDER BY g.week, g.kickoff_utc`,
  )
  .all();

const teams = db.prepare("SELECT abbr, name FROM teams ORDER BY abbr").all();

/**
 * Market-primary: use the de-vigged moneyline whenever one exists, and fall
 * back to ELWAY only where the market has not priced the game yet — roughly
 * weeks 11-18, beyond ESPN's lookahead.
 *
 * This differs deliberately from the main app, which blends the two 50/50 per
 * the project brief. The mobile board is a quick-reference view, and market
 * prices are both fresher and better informed than a forecast that can sit a
 * week stale. Changing it here does not affect lib/model/engine.ts.
 */
const blend = (v, s) => v ?? s ?? null;

/**
 * Round to 4 decimals before embedding.
 *
 * The de-vigged values carry full float precision (0.7913616398243045), which
 * costs ~14 characters each across roughly 1,600 numbers. The page never shows
 * more than one decimal of a percentage, so four is already two more than it
 * can display -- and it makes the file small enough to hand to another Claude
 * conversation comfortably.
 */
const round4 = (x) => (x == null ? null : Math.round(x * 1e4) / 1e4);

// week -> team -> cell
const weeks = {};
let silverAsOf = null;
for (const r of rows) {
  weeks[r.week] ??= {};
  if (r.source_as_of) silverAsOf = r.source_as_of;
  const h = blend(r.o_home, r.s_home);
  const a = blend(r.o_away, r.s_away);
  weeks[r.week][r.home_team] = {
    o: r.away_team, h: 1, p: round4(h), v: round4(r.o_home), s: round4(r.s_home),
    b: r.book_count ?? null, pl: r.played ? 1 : 0,
  };
  weeks[r.week][r.away_team] = {
    o: r.home_team, h: 0, p: round4(a), v: round4(r.o_away), s: round4(r.s_away),
    b: r.book_count ?? null, pl: r.played ? 1 : 0,
  };
}

/**
 * When the ELWAY numbers last CHANGED, not what the sheet claims about itself.
 *
 * `source_as_of` is the sheet's own `updated_at`, and it is not maintained
 * reliably -- on 2026-09-16 all 256 games had been rewritten while that field
 * still read 2026-09-09. Printing it told the reader the forecast was a week
 * stale at the moment it had just been refreshed.
 *
 * The earliest fetch carrying the newest `content_hash` is the honest answer:
 * the first time these exact numbers reached us. See dataFreshness() in
 * lib/db/repo/probabilities.ts, which resolves it the same way.
 */
const changed = db
  .prepare(
    `SELECT MIN(fetched_at) AS changed_at FROM silver_projections
     WHERE content_hash = (
       SELECT content_hash FROM silver_projections
       ORDER BY fetched_at DESC LIMIT 1)`,
  )
  .get();
// SQLite's CURRENT_TIMESTAMP is UTC but formatted "YYYY-MM-DD HH:MM:SS" with
// no zone marker, which browsers parse as LOCAL time. Normalise to ISO so the
// page does not shift the date by the reader's offset.
const silverChangedAt = changed?.changed_at
  ? `${changed.changed_at.replace(" ", "T")}Z`
  : null;

const out = {
  season: 2026,
  generatedAt: new Date().toISOString(),
  silverAsOf: silverChangedAt ?? silverAsOf,
  silverSourceStamp: silverAsOf,
  teams: Object.fromEntries(teams.map((t) => [t.abbr, t.name])),
  weeks,
};

writeFileSync("grid-data.json", JSON.stringify(out));
const withData = Object.entries(weeks).filter(([, t]) =>
  Object.values(t).some((c) => c.p != null),
).length;
console.log(
  `teams ${teams.length}  weeks ${Object.keys(weeks).length}  ` +
    `weeks with probabilities ${withData}  ELWAY changed ${silverChangedAt}` +
    `  (sheet claims ${silverAsOf})`,
);
console.log(`bytes ${JSON.stringify(out).length}`);
