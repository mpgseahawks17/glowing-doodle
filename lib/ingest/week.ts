import { and, desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";

/**
 * The week you are currently picking for.
 *
 * NOT "the lowest week with an unplayed game" -- that was the original rule and
 * it is wrong for a pick tool. On the Monday after week 1, the Monday night
 * game is still unplayed, so that rule reports week 1 while the week 1 deadline
 * (Sunday 10:00 a.m. PT) passed the previous morning and you are in fact
 * choosing your week 2 team.
 *
 * Rule used instead: the lowest week where **most games are still unplayed**.
 * A week whose main slate has already kicked off is locked and behind you; a
 * week where nearly everything is still to come is the one you are deciding.
 *
 * This deliberately avoids timezone arithmetic. Deriving the real Sunday
 * 10:00 a.m. PT deadline per week would mean handling PT/PDT, international
 * games in London and Munich, and Yahoo's per-group deadline override -- all to
 * decide a default the `--week` flag and the UI dropdown can already change.
 * Counting unplayed games gets the same answer from data we already store.
 */
export async function currentWeek(season: number): Promise<number> {
  const rows = await db
    .select({
      week: schema.games.week,
      total: sql<number>`count(*)`,
      unplayed: sql<number>`sum(case when ${schema.games.homeScore} is null then 1 else 0 end)`,
    })
    .from(schema.games)
    .where(eq(schema.games.season, season))
    .groupBy(schema.games.week)
    .orderBy(schema.games.week);

  for (const row of rows) {
    if (Number(row.unplayed) * 2 > Number(row.total)) return row.week;
  }

  // Every week has started: the regular season is effectively over.
  const [last] = await db
    .select({ week: schema.games.week })
    .from(schema.games)
    .where(eq(schema.games.season, season))
    .orderBy(desc(schema.games.week))
    .limit(1);

  return last?.week ?? 1;
}

/** Games in a week that have not been played yet -- used by the freshness UI. */
export async function weekProgress(
  season: number,
  week: number,
): Promise<{ total: number; unplayed: number }> {
  const [row] = await db
    .select({
      total: sql<number>`count(*)`,
      unplayed: sql<number>`sum(case when ${schema.games.homeScore} is null then 1 else 0 end)`,
    })
    .from(schema.games)
    .where(and(eq(schema.games.season, season), eq(schema.games.week, week)));

  return {
    total: Number(row?.total ?? 0),
    unplayed: Number(row?.unplayed ?? 0),
  };
}
