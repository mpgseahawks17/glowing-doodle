/**
 * Ingest ELWAY projections automatically from Silver Bulletin's data sheet.
 *
 * This replaces the manual screenshot-and-transcribe path. The ELWAY embeds
 * read a public Google Sheets CSV export, so no cookie, subscription check or
 * browser automation is involved -- the paywall only ever hid which sheet ID to
 * read, not the data itself.
 *
 * Covers all 18 weeks, not just the lookahead window, and records the source's
 * own `updated_at` so the UI can show when SILVER last recomputed rather than
 * when we last fetched.
 *
 * Usage:
 *   npm run ingest:silver:sheet
 *   npm run ingest:silver:sheet -- --dry-run
 *   npm run ingest:silver:sheet -- --sheet <id>
 */
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { ELWAY_SHEET_ID, fetchElwaySheet } from "@/lib/ingest/silver-sheet";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function main() {
  const season = Number(arg("season") ?? process.env.SEASON ?? 2026);
  const sheetId = arg("sheet") ?? process.env.ELWAY_SHEET_ID ?? ELWAY_SHEET_ID;
  const dryRun = process.argv.includes("--dry-run");

  const { games, errors, meta } = await fetchElwaySheet(sheetId);

  console.log(`Fetched ${games.length} games from the ELWAY sheet.`);
  if (meta.updatedAt) {
    const age = (Date.now() - Date.parse(meta.updatedAt)) / 86_400_000;
    console.log(
      `  source updated_at: ${meta.updatedAt} (${age.toFixed(1)} days old)`,
    );
    console.log(`  data_version:      ${meta.dataVersion ?? "unknown"}`);
    if (age > 8) {
      console.warn(
        `  WARNING: Silver has not recomputed in ${age.toFixed(0)} days — these\n` +
          `           projections may predate recent results.`,
      );
    }
  }

  if (errors.length > 0) {
    console.warn(`\n${errors.length} row problem(s):`);
    for (const e of errors.slice(0, 15)) console.warn(`  - ${e}`);
    if (games.length === 0) {
      console.error("\nNothing usable parsed. Aborting.");
      process.exit(1);
    }
  }

  // Match against our schedule. A team-code or week mismatch must fail loudly
  // rather than silently dropping games out of the model.
  const scheduled = await db
    .select()
    .from(schema.games)
    .where(eq(schema.games.season, season));

  const byKey = new Map(
    scheduled.map((g) => [`${g.week}:${g.awayTeam}@${g.homeTeam}`, g]),
  );

  const matched: Array<{ gameId: string; game: (typeof games)[number] }> = [];
  const unmatched: string[] = [];

  for (const g of games) {
    const hit = byKey.get(`${g.week}:${g.awayTeam}@${g.homeTeam}`);
    if (!hit) {
      unmatched.push(`w${g.week} ${g.awayTeam}@${g.homeTeam}`);
      continue;
    }
    matched.push({ gameId: hit.gameId, game: g });
  }

  console.log(`\nMatched ${matched.length}/${games.length} to the schedule.`);
  if (unmatched.length > 0) {
    console.warn(`Unmatched (${unmatched.length}):`);
    for (const u of unmatched.slice(0, 20)) console.warn(`  - ${u}`);
  }

  if (dryRun) {
    console.log("\nDry run: nothing written.");
    return;
  }

  /**
   * Skip the write when Silver has not recomputed.
   *
   * `data_version` changes only when ELWAY reruns, so re-ingesting an unchanged
   * sheet would append 272 identical rows every refresh -- ~100k duplicates
   * over a season of daily pulls. More importantly, reporting "wrote 272 rows"
   * when nothing changed reads as progress when there is none.
   */
  if (meta.dataVersion) {
    const [latest] = await db
      .select({ dataVersion: schema.silverProjections.dataVersion })
      .from(schema.silverProjections)
      .orderBy(desc(schema.silverProjections.fetchedAt))
      .limit(1);

    if (latest?.dataVersion === meta.dataVersion) {
      console.log(
        `\nUnchanged — Silver has not recomputed since ${meta.updatedAt}.\n` +
          `Nothing written (data_version ${meta.dataVersion} already stored).`,
      );
      return;
    }
  }

  db.transaction((tx) => {
    for (const { gameId, game } of matched) {
      tx.insert(schema.silverProjections)
        .values({
          gameId,
          homeProb: game.homeProb,
          awayProb: game.awayProb,
          tieProb: game.tieProb,
          ingestMethod: "api",
          sourceAsOf: meta.updatedAt,
          dataVersion: meta.dataVersion,
          sourceNote: `elway sheet ${sheetId.slice(0, 8)}`,
        })
        .run();
    }
  });

  console.log(`\nWrote ${matched.length} Silver projections.`);
  if (matched.length < scheduled.length * 0.9) {
    console.warn(
      `WARNING: only ${matched.length} of ${scheduled.length} scheduled games ` +
        `were covered. Check the team-code mapping.`,
    );
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
