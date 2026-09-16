/**
 * Print the weekly scorecard to the terminal.
 *
 * This is the feedback loop for phases 1-4: the full model runs and is
 * inspectable long before any UI exists.
 *
 * Usage:
 *   npm run scorecard
 *   npm run scorecard -- --week 5 --lambda 1.5 --all
 */
import { buildProbMatrix, dataFreshness, matchupsForWeek } from "@/lib/db/repo/probabilities";
import { availableTeams, getConfig, livesRemaining } from "@/lib/db/repo/picks";
import { currentWeek } from "@/lib/ingest/week";
import { scoreTeams } from "@/lib/model/engine";
import type { ScoredTeam } from "@/lib/model/types";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

const pct = (v: number | null) => (v === null ? "  --  " : `${(v * 100).toFixed(1)}%`);
const signed = (v: number | null) =>
  v === null ? "  --  " : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}`;

function pad(s: string, width: number, right = false) {
  return right ? s.padStart(width) : s.padEnd(width);
}

function renderRow(r: ScoredTeam): string {
  const matchup =
    r.opponent === null ? "BYE" : `${r.isHome ? "vs" : "@ "} ${r.opponent}`;
  const derived = r.silverIsDerived ? "~" : " ";
  // Single-book lines are marked so a DraftKings-only number is never mistaken
  // for a multi-book median.
  const oneBook = r.vegasBooks === 1 && r.vegasProb !== null ? "°" : " ";
  const diff =
    r.sourceDelta === null
      ? "  --  "
      : `${signed(r.sourceDelta)}${r.discrepancy ? "!" : " "}`;
  const later =
    r.pickLater > 0 && r.pickLaterWeek !== null
      ? `${(r.pickLater * 100).toFixed(1)} (w${r.pickLaterWeek})`
      : "  --  ";

  return [
    pad(r.rank === 0 ? "-" : String(r.rank), 4, true),
    pad(r.team, 5),
    pad(matchup, 8),
    pad(pct(r.vegasProb) + oneBook, 8, true),
    pad(pct(r.silverProb) + derived, 8, true),
    pad(diff, 8, true),
    pad(pct(r.blendedProb), 7, true),
    pad(signed(r.pickNow), 8, true),
    pad(later, 12, true),
    pad(r.score === null ? "  --  " : (r.score * 100).toFixed(1), 7, true),
    "  " + r.recommendation,
  ].join(" ");
}

async function main() {
  const season = Number(arg("season") ?? process.env.SEASON ?? 2026);
  const config = await getConfig();
  const lambdaOverride = arg("lambda");
  if (lambdaOverride !== undefined) config.lambda = Number(lambdaOverride);

  const week = Number(arg("week") ?? (await currentWeek(season)));
  const available = await availableTeams(season);
  const { matrix } = await buildProbMatrix(season, week, week + config.horizon);
  const matchups = await matchupsForWeek(season, week);
  const rows = scoreTeams(matrix, week, available, matchups, config);

  const fresh = await dataFreshness();
  const lives = await livesRemaining(season);

  console.log("");
  console.log(
    `NFL Survivor -- season ${season}, week ${week}   ` +
      `lambda=${config.lambda}  weights=${config.weights.vegas}/${config.weights.silver}  ` +
      `horizon=${config.horizon}w`,
  );
  console.log(
    `${available.length} teams available   ${lives} lives remaining`,
  );
  console.log(
    `lookahead: weeks ${week + 1}-${week + config.horizon}`,
  );
  console.log(
    `odds: ${fresh.odds ?? "never"}   silver: ${fresh.silver ?? "never"}` +
      (fresh.silverMethod === "derived" ? "  (~ = derived fallback, not Silver)" : ""),
  );

  // Check the lookahead window for actual data rather than assuming it can
  // only come from Silver. ESPN publishes moneylines ~8 weeks out, so the
  // window is normally fed by market data alone.
  let forwardGames = 0;
  for (let w = week + 1; w <= week + config.horizon; w++) {
    for (const inputs of matrix.get(w)?.values() ?? []) {
      if (inputs.vegas !== undefined || inputs.silver !== undefined) forwardGames++;
    }
  }

  if (forwardGames === 0) {
    console.log("");
    console.log(
      "NOTE: no forward-week data loaded. PickLater is 0 for every team, so",
    );
    console.log(
      "      Score collapses to this week's win probability. Load lookahead",
    );
    console.log("      lines with `npm run ingest:odds:espn`.");
  }

  console.log("");
  console.log(
    [
      pad("RANK", 4, true),
      pad("TEAM", 5),
      pad("MATCHUP", 8),
      pad("VEGAS", 8, true),
      pad("SILVER", 8, true),
      pad("DIFF", 8, true),
      pad("BLEND", 7, true),
      pad("PICKNOW", 8, true),
      pad("PICKLATER", 12, true),
      pad("SCORE", 7, true),
      "  REC",
    ].join(" "),
  );
  console.log("-".repeat(96));

  const showAll = process.argv.includes("--all");
  const visible = showAll ? rows : rows.slice(0, 15);
  for (const r of visible) console.log(renderRow(r));
  if (!showAll && rows.length > visible.length) {
    console.log(`... ${rows.length - visible.length} more (--all to show)`);
  }
  console.log("");
  console.log(
    "DIFF = Silver - Vegas (+ = Silver higher than market)   " +
      "! = 5%+ disagreement",
  );
  console.log(
    "° = single-book line, not a median   ~ = derived, not real Silver data",
  );
  console.log("");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
