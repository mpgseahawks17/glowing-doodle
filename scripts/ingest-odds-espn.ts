/**
 * Pull NFL moneylines from ESPN's scoreboard API, including FUTURE weeks.
 *
 * This is the source that makes the opportunity-cost model work. The Odds API
 * and nflverse both carry only the current round, so PickLater -- which
 * searches weeks N+1..N+4 -- had nothing to run on. ESPN publishes lookahead
 * lines roughly 8 weeks out, covering the whole window.
 *
 * Quality caveat, recorded on every row as source='espn': these are single-book
 * (DraftKings) lines, not a median across ~10 books like the Odds API gives for
 * the current week. Good enough to rank future spots, but the current week
 * should still prefer `npm run ingest:odds` when a key is available.
 *
 * Endpoint (undocumented but public, no key):
 *   site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard
 *     ?week=N&seasontype=2&dates=<season>
 *
 * Politeness: one request per week with a small delay, run at most daily.
 *
 * Usage:
 *   npm run ingest:odds:espn
 *   npm run ingest:odds:espn -- --from 2 --to 6 --dry-run
 */
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { consensusFromBooks } from "@/lib/model/probability";
import { fromEspnAbbr } from "@/lib/ingest/team-map";
import { currentWeek } from "@/lib/ingest/week";

const ENDPOINT =
  "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard";

interface EspnScoreboard {
  events?: Array<{
    competitions?: Array<{
      competitors?: Array<{
        homeAway?: string;
        team?: { abbreviation?: string };
      }>;
      odds?: Array<{
        provider?: { name?: string };
        moneyline?: {
          home?: { close?: { odds?: string }; open?: { odds?: string } };
          away?: { close?: { odds?: string }; open?: { odds?: string } };
        };
      }>;
    }>;
  }>;
  week?: { teamsOnBye?: Array<{ abbreviation?: string }> };
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

/** ESPN writes "+170" / "-205" / occasionally "EVEN". */
function parseOdds(raw: string | undefined): number | null {
  if (!raw) return null;
  const cleaned = raw.trim().toUpperCase();
  if (cleaned === "EVEN" || cleaned === "EV") return 100;
  const n = Number(cleaned.replace("+", ""));
  return Number.isFinite(n) && n !== 0 ? n : null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const season = Number(arg("season") ?? process.env.SEASON ?? 2026);
  const dryRun = process.argv.includes("--dry-run");

  const now = await currentWeek(season);
  const from = Number(arg("from") ?? now);
  /**
   * Default past the 4-week model horizon on purpose: ESPN publishes lines
   * roughly 8 weeks out, the horizon control in the UI goes to 6, and the grid
   * is more useful full. Weeks with no lines yet simply report 0 games.
   */
  const to = Number(arg("to") ?? Math.min(18, now + 8));

  console.log(`Fetching ESPN odds for ${season} weeks ${from}-${to}\n`);

  let written = 0;
  const skipped: string[] = [];

  for (let week = from; week <= to; week++) {
    const url = `${ENDPOINT}?week=${week}&seasontype=2&dates=${season}`;
    const res = await fetch(url, {
      headers: { accept: "application/json" },
    });
    if (!res.ok) {
      skipped.push(`week ${week}: HTTP ${res.status}`);
      continue;
    }

    const board = (await res.json()) as EspnScoreboard;
    const events = board.events ?? [];
    let weekWritten = 0;
    let noOdds = 0;

    for (const event of events) {
      const comp = event.competitions?.[0];
      if (!comp) continue;

      const home = comp.competitors?.find((c) => c.homeAway === "home");
      const away = comp.competitors?.find((c) => c.homeAway === "away");
      if (!home?.team?.abbreviation || !away?.team?.abbreviation) continue;

      const homeAbbr = fromEspnAbbr(home.team.abbreviation);
      const awayAbbr = fromEspnAbbr(away.team.abbreviation);

      const book = comp.odds?.[0];
      const homeMl =
        parseOdds(book?.moneyline?.home?.close?.odds) ??
        parseOdds(book?.moneyline?.home?.open?.odds);
      const awayMl =
        parseOdds(book?.moneyline?.away?.close?.odds) ??
        parseOdds(book?.moneyline?.away?.open?.odds);

      if (homeMl === null || awayMl === null) {
        noOdds++;
        continue;
      }

      const consensus = consensusFromBooks([
        { bookmaker: book?.provider?.name ?? "espn", homeMl, awayMl },
      ]);
      if (!consensus) {
        noOdds++;
        continue;
      }

      // Match to our schedule by season + week + team pair. Anchoring on week
      // as well as the pair means a divisional rematch cannot be mismatched.
      const [game] = await db
        .select()
        .from(schema.games)
        .where(
          and(
            eq(schema.games.season, season),
            eq(schema.games.week, week),
            eq(schema.games.homeTeam, homeAbbr),
            eq(schema.games.awayTeam, awayAbbr),
          ),
        );

      if (!game) {
        skipped.push(`week ${week}: ${awayAbbr}@${homeAbbr} not in schedule`);
        continue;
      }

      if (!dryRun) {
        await db.insert(schema.oddsSnapshots).values({
          gameId: game.gameId,
          source: "espn",
          bookCount: 1,
          homeMlMedian: consensus.homeMlMedian,
          awayMlMedian: consensus.awayMlMedian,
          homeProbDevig: consensus.homeProbDevig,
          awayProbDevig: consensus.awayProbDevig,
          rawJson: JSON.stringify({
            provider: book?.provider?.name,
            homeMl,
            awayMl,
          }),
        });
      }
      weekWritten++;
      written++;
    }

    const byes = (board.week?.teamsOnBye ?? [])
      .map((t) => fromEspnAbbr(t.abbreviation ?? ""))
      .filter(Boolean);

    console.log(
      `  week ${week}: ${weekWritten}/${events.length} games with moneylines` +
        (noOdds > 0 ? `, ${noOdds} without` : "") +
        (byes.length > 0 ? `  (byes: ${byes.join(", ")})` : ""),
    );

    if (week < to) await sleep(400);
  }

  console.log(
    dryRun ? `\nDry run: ${written} would be written.` : `\nWrote ${written} odds snapshots.`,
  );
  if (skipped.length > 0) {
    console.warn(`\nSkipped ${skipped.length}:`);
    for (const s of skipped.slice(0, 20)) console.warn(`  - ${s}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
