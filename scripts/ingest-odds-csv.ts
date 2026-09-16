/**
 * Fallback Vegas ingest: read moneylines from the nflverse games.csv.
 *
 * This is the manual-override path for market data -- useful when the Odds API
 * key is missing, the monthly credits are exhausted, or the service is down.
 * It is a SINGLE closing-line source rather than a median across books, so
 * snapshots land with bookCount = 1 and should be treated as lower quality than
 * a real Odds API pull.
 *
 * Same coverage limit as the live API: nflverse only carries moneylines for the
 * current round, so this fills week N and nothing beyond it.
 *
 * Usage:
 *   npx tsx scripts/ingest-odds-csv.ts
 *   npx tsx scripts/ingest-odds-csv.ts -- --from-file ./data/games.csv --week 3
 */
import { readFile } from "node:fs/promises";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { numOrNull, parseCsv } from "@/lib/ingest/csv";
import { consensusFromBooks } from "@/lib/model/probability";

const SOURCE_URL = "http://www.habitatring.com/games.csv";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function loadCsv(): Promise<string> {
  const file = arg("from-file");
  if (file) return readFile(file, "utf8");
  const res = await fetch(SOURCE_URL);
  if (!res.ok) throw new Error(`Schedule fetch failed: ${res.status}`);
  return res.text();
}

async function main() {
  const season = Number(arg("season") ?? process.env.SEASON ?? 2026);
  const weekFilter = arg("week") ? Number(arg("week")) : null;

  const rows = parseCsv(await loadCsv()).filter(
    (r) =>
      Number(r.season) === season &&
      r.game_type === "REG" &&
      (weekFilter === null || Number(r.week) === weekFilter),
  );

  let written = 0;
  let skipped = 0;

  for (const r of rows) {
    const homeMl = numOrNull(r.home_moneyline);
    const awayMl = numOrNull(r.away_moneyline);
    if (homeMl === null || awayMl === null) {
      skipped++;
      continue;
    }

    const consensus = consensusFromBooks([
      { bookmaker: "nflverse-closing", homeMl, awayMl },
    ]);
    if (!consensus) {
      skipped++;
      continue;
    }

    const [game] = await db
      .select()
      .from(schema.games)
      .where(
        and(eq(schema.games.season, season), eq(schema.games.gameId, r.game_id!)),
      );
    if (!game) {
      skipped++;
      continue;
    }

    await db.insert(schema.oddsSnapshots).values({
      gameId: game.gameId,
      source: "nflverse",
      bookCount: 1,
      homeMlMedian: consensus.homeMlMedian,
      awayMlMedian: consensus.awayMlMedian,
      homeProbDevig: consensus.homeProbDevig,
      awayProbDevig: consensus.awayProbDevig,
      rawJson: JSON.stringify({
        source: "nflverse games.csv",
        homeMl,
        awayMl,
      }),
    });
    written++;
  }

  console.log(
    `Wrote ${written} odds snapshots from games.csv ` +
      `(${skipped} rows had no moneyline).`,
  );
  if (written > 0) {
    console.log(
      "NOTE: single-source closing lines, not a median across books. " +
        "Prefer `npm run ingest:odds` when the API key is available.",
    );
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
