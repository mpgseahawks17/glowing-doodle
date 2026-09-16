/**
 * Pull NFL moneylines from The Odds API and store a de-vigged snapshot.
 *
 * Cost model: credits = markets x regions. We request one market (h2h) in one
 * region (us), so each run costs exactly 1 credit against the 500/month free
 * tier. The suggested cadence (daily, plus Wed evening and three Sunday pulls)
 * lands around 150/month.
 *
 * The API returns only the current round, so this populates week N alone. The
 * lookahead window is filled by ingest-silver / derive-ratings -- see the build
 * plan's Constraint A.
 *
 * Usage:
 *   npm run ingest:odds
 *   npm run ingest:odds -- --dry-run
 */
import { db, schema } from "@/lib/db/client";
import { consensusFromBooks, type BookQuote } from "@/lib/model/probability";
import { requireAbbr } from "@/lib/ingest/team-map";
import { and, eq } from "drizzle-orm";

const ENDPOINT =
  "https://api.the-odds-api.com/v4/sports/americanfootball_nfl/odds";

interface OddsApiOutcome {
  name: string;
  price: number;
}
interface OddsApiEvent {
  id: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: Array<{
    key: string;
    markets: Array<{ key: string; outcomes: OddsApiOutcome[] }>;
  }>;
}

const dryRun = process.argv.includes("--dry-run");

async function main() {
  const apiKey = process.env.ODDS_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ODDS_API_KEY is not set. Copy .env.example to .env and add your key " +
        "from https://the-odds-api.com/",
    );
  }
  const season = Number(process.env.SEASON ?? 2026);

  const url = new URL(ENDPOINT);
  url.searchParams.set("apiKey", apiKey);
  url.searchParams.set("regions", "us");
  url.searchParams.set("markets", "h2h");
  url.searchParams.set("oddsFormat", "american");

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `Odds API ${res.status} ${res.statusText}: ${await res.text()}`,
    );
  }

  const remaining = res.headers.get("x-requests-remaining");
  const used = res.headers.get("x-requests-used");
  const events = (await res.json()) as OddsApiEvent[];

  console.log(
    `Odds API returned ${events.length} events. ` +
      `Credits used ${used ?? "?"}, remaining ${remaining ?? "?"}.`,
  );

  let written = 0;
  const unmatched: string[] = [];

  for (const event of events) {
    const home = requireAbbr(event.home_team);
    const away = requireAbbr(event.away_team);

    const quotes: BookQuote[] = [];
    for (const book of event.bookmakers) {
      const h2h = book.markets.find((m) => m.key === "h2h");
      if (!h2h) continue;
      const homeOutcome = h2h.outcomes.find(
        (o) => requireAbbr(o.name) === home,
      );
      const awayOutcome = h2h.outcomes.find(
        (o) => requireAbbr(o.name) === away,
      );
      if (!homeOutcome || !awayOutcome) continue;
      quotes.push({
        bookmaker: book.key,
        homeMl: homeOutcome.price,
        awayMl: awayOutcome.price,
      });
    }

    const consensus = consensusFromBooks(quotes);
    if (!consensus) {
      unmatched.push(`${away}@${home} (no usable h2h quotes)`);
      continue;
    }

    // Match to our schedule by team pair. Team pairs are unique within a
    // season for all but a handful of divisional rematches, so disambiguate by
    // picking the game whose kickoff is closest to the event's commence_time.
    const candidates = await db
      .select()
      .from(schema.games)
      .where(
        and(
          eq(schema.games.season, season),
          eq(schema.games.homeTeam, home),
          eq(schema.games.awayTeam, away),
        ),
      );

    if (candidates.length === 0) {
      unmatched.push(`${away}@${home} (not in schedule for ${season})`);
      continue;
    }

    const target = new Date(event.commence_time).getTime();
    const game = candidates.reduce((best, g) => {
      const dist = (x: typeof g) =>
        Math.abs(new Date(x.kickoffUtc ?? 0).getTime() - target);
      return dist(g) < dist(best) ? g : best;
    }, candidates[0]!);

    if (dryRun) {
      console.log(
        `  ${away}@${home} wk${game.week}  ` +
          `${consensus.homeProbDevig.toFixed(4)} / ` +
          `${consensus.awayProbDevig.toFixed(4)}  (${consensus.bookCount} books)`,
      );
      continue;
    }

    await db.insert(schema.oddsSnapshots).values({
      gameId: game.gameId,
      source: "odds-api",
      bookCount: consensus.bookCount,
      homeMlMedian: consensus.homeMlMedian,
      awayMlMedian: consensus.awayMlMedian,
      homeProbDevig: consensus.homeProbDevig,
      awayProbDevig: consensus.awayProbDevig,
      rawJson: JSON.stringify(quotes),
    });
    written++;
  }

  console.log(
    dryRun
      ? "Dry run: nothing written."
      : `Wrote ${written} odds snapshots.`,
  );
  if (unmatched.length > 0) {
    console.warn(`Skipped ${unmatched.length}:`);
    for (const u of unmatched) console.warn(`  - ${u}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
