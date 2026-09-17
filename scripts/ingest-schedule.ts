/**
 * Load the full-season NFL schedule from nflverse.
 *
 * Why not The Odds API: its /odds endpoint "mirrors events that are listed by
 * major bookmakers", i.e. the current round only. Verified against the 2026
 * season -- week 1 has 16 moneylines, weeks 2-18 have zero. It cannot populate
 * a 32x18 grid. games.csv carries all 272 regular-season games, including ones
 * not yet played, with home/away and kickoff times.
 *
 * Idempotent: re-running updates existing rows (scores fill in as games are
 * played) and inserts any that are new.
 *
 * Usage:
 *   npm run ingest:schedule
 *   npm run ingest:schedule -- --season 2026 --from-file ./data/games.csv
 */
import { readFile } from "node:fs/promises";
import { db, schema } from "@/lib/db/client";
import { numOrNull, parseCsv } from "@/lib/ingest/csv";

const SOURCE_URL = "http://www.habitatring.com/games.csv";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function loadCsv(): Promise<string> {
  const file = arg("from-file");
  if (file) {
    console.log(`Reading schedule from ${file}`);
    return readFile(file, "utf8");
  }
  console.log(`Fetching schedule from ${SOURCE_URL}`);
  const res = await fetch(SOURCE_URL);
  if (!res.ok) {
    throw new Error(
      `Schedule fetch failed: ${res.status} ${res.statusText}. ` +
        `Download it manually and pass --from-file.`,
    );
  }
  return res.text();
}

async function main() {
  const season = Number(arg("season") ?? process.env.SEASON ?? 2026);
  const rows = parseCsv(await loadCsv()).filter(
    (r) => Number(r.season) === season && r.game_type === "REG",
  );

  if (rows.length === 0) {
    throw new Error(`No REG games found for season ${season}.`);
  }

  const games = rows.map((r) => ({
    gameId: r.game_id!,
    season,
    week: Number(r.week),
    gameType: r.game_type!,
    homeTeam: r.home_team!,
    awayTeam: r.away_team!,
    kickoffUtc:
      r.gameday && r.gametime ? `${r.gameday}T${r.gametime}:00` : (r.gameday ?? null),
    // Venue, for the international-game badge. `stadium_id` is the identifying
    // field; `stadium` is shown to the reader and `location` marks neutral
    // sites, which include domestic ones. See lib/model/matchup-context.ts.
    location: r.location ?? null,
    stadium: r.stadium ?? null,
    stadiumId: r.stadium_id ?? null,
    homeScore: numOrNull(r.home_score),
    awayScore: numOrNull(r.away_score),
  }));

  db.transaction((tx) => {
    for (const g of games) {
      tx.insert(schema.games)
        .values(g)
        .onConflictDoUpdate({
          target: schema.games.gameId,
          set: {
            week: g.week,
            homeTeam: g.homeTeam,
            awayTeam: g.awayTeam,
            kickoffUtc: g.kickoffUtc,
            location: g.location,
            stadium: g.stadium,
            stadiumId: g.stadiumId,
            homeScore: g.homeScore,
            awayScore: g.awayScore,
          },
        })
        .run();
    }
  });

  // Sanity checks. Every team plays 17 games across an 18-week season, so any
  // other count means the source changed shape or a team code failed to map.
  const perTeam = new Map<string, number>();
  for (const g of games) {
    perTeam.set(g.homeTeam, (perTeam.get(g.homeTeam) ?? 0) + 1);
    perTeam.set(g.awayTeam, (perTeam.get(g.awayTeam) ?? 0) + 1);
  }
  const weeks = new Set(games.map((g) => g.week));
  const odd = [...perTeam.entries()].filter(([, n]) => n !== 17);

  console.log(`Loaded ${games.length} games for ${season}.`);
  console.log(`  teams: ${perTeam.size}  weeks: ${weeks.size}`);
  if (perTeam.size !== 32 || weeks.size !== 18 || odd.length > 0) {
    console.warn(
      `  WARNING: expected 32 teams / 18 weeks / 17 games each. ` +
        `Anomalies: ${odd.map(([t, n]) => `${t}=${n}`).join(", ") || "none"}`,
    );
  } else {
    console.log(`  OK: 32 teams, 18 weeks, 17 games each (one bye apiece).`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
