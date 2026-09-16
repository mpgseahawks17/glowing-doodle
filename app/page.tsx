import { Dashboard } from "@/components/dashboard";
import {
  allMatchups,
  buildProbMatrix,
  dataFreshness,
} from "@/lib/db/repo/probabilities";
import { lastWeekWithData, sourceComparison } from "@/lib/db/repo/sources";
import { availableTeams, getConfig, usedTeams } from "@/lib/db/repo/picks";
import { currentWeek } from "@/lib/ingest/week";
import { serializeMatrix } from "@/lib/model/serialize";
import { TEAMS } from "@/lib/data/teams";

// Reads a local SQLite file that ingest scripts rewrite behind our back, so
// never cache this page.
export const dynamic = "force-dynamic";

export default async function Page() {
  const season = Number(process.env.SEASON ?? 2026);
  const week = await currentWeek(season);

  // The whole season, so the grid and the lookahead window come from one read.
  const { matrix } = await buildProbMatrix(season, 1, 18);
  const [matchups, available, used, freshness, config, lastWeek] =
    await Promise.all([
      allMatchups(season),
      availableTeams(season),
      usedTeams(season),
      dataFreshness(),
      getConfig(),
      lastWeekWithData(season),
    ]);

  // Sources view spans every week the feeds actually reach, not the model's
  // horizon -- comparing ELWAY against ESPN across the full lookahead is the
  // point of the tab.
  const sources = await sourceComparison(season, week, Math.max(week, lastWeek));

  return (
    <Dashboard
      season={season}
      currentWeek={week}
      matrix={serializeMatrix(matrix)}
      matchups={matchups}
      available={available}
      used={used.map((p) => ({
        week: p.week,
        team: p.team,
        result: p.result ?? null,
      }))}
      allTeams={TEAMS.map((t) => t.abbr)}
      sources={sources}
      freshness={freshness}
      initialConfig={{
        lambda: config.lambda,
        wVegas: config.weights.vegas,
        wSilver: config.weights.silver,
        horizon: config.horizon,
      }}
    />
  );
}
