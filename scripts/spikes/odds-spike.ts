/**
 * SPIKE S1 -- How far ahead does The Odds API actually publish NFL lines?
 *
 * The docs say the /odds endpoint "mirrors events that are listed by major
 * bookmakers... usually includes games for the current round". The nflverse
 * schedule agrees: for 2026, week 1 carries 16 moneylines and weeks 2-18 carry
 * zero. This spike confirms it against the live API with your own key, because
 * the entire build order depends on it -- if Vegas covered four weeks ahead,
 * PickLater could run on market data and Silver would be optional.
 *
 * Costs exactly 1 credit. Read-only, writes nothing to the database.
 *
 * Usage:  ODDS_API_KEY=... npm run spike:odds
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve("./data/spike-odds");

interface OddsApiEvent {
  id: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: Array<{ key: string; markets: Array<{ key: string }> }>;
}

async function main() {
  const apiKey = process.env.ODDS_API_KEY;
  if (!apiKey) throw new Error("ODDS_API_KEY is not set.");
  mkdirSync(OUT, { recursive: true });

  const url = new URL(
    "https://api.the-odds-api.com/v4/sports/americanfootball_nfl/odds",
  );
  url.searchParams.set("apiKey", apiKey);
  url.searchParams.set("regions", "us");
  url.searchParams.set("markets", "h2h");
  url.searchParams.set("oddsFormat", "american");

  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${await res.text()}`);

  const events = (await res.json()) as OddsApiEvent[];
  writeFileSync(`${OUT}/odds.json`, JSON.stringify(events, null, 2));

  console.log("--- CREDIT COST ---");
  console.log(`  used this request: ${res.headers.get("x-requests-last") ?? "?"}`);
  console.log(`  used this period:  ${res.headers.get("x-requests-used") ?? "?"}`);
  console.log(`  remaining:         ${res.headers.get("x-requests-remaining") ?? "?"}`);

  console.log("\n--- COVERAGE ---");
  console.log(`  events returned: ${events.length}`);
  if (events.length === 0) {
    console.log("  (no NFL events listed right now)");
    return;
  }

  const times = events.map((e) => new Date(e.commence_time).getTime()).sort();
  const first = new Date(times[0]!);
  const last = new Date(times[times.length - 1]!);
  const spanDays = (last.getTime() - first.getTime()) / 86_400_000;

  console.log(`  earliest kickoff: ${first.toISOString()}`);
  console.log(`  latest kickoff:   ${last.toISOString()}`);
  console.log(`  span:             ${spanDays.toFixed(1)} days`);

  const byDay = new Map<string, number>();
  for (const e of events) {
    const day = e.commence_time.slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + 1);
  }
  console.log("\n  games per kickoff date:");
  for (const [day, n] of [...byDay].sort()) console.log(`    ${day}  ${n}`);

  const books = new Set(events.flatMap((e) => e.bookmakers.map((b) => b.key)));
  console.log(`\n  distinct bookmakers: ${books.size} (${[...books].join(", ")})`);

  console.log("\n--- VERDICT ---");
  if (spanDays <= 9) {
    console.log(
      `  As expected: coverage is ~${spanDays.toFixed(1)} days, i.e. the current\n` +
        "  round only. That is a limit of THIS API, not of the market --\n" +
        "  ESPN publishes lookahead lines ~8 weeks out and feeds the forward\n" +
        "  window (see scripts/ingest-odds-espn.ts). The value of this source\n" +
        `  is precision: ${books.size} books medianed for the current week, versus\n` +
        "  ESPN's single book.",
    );
  } else {
    console.log(
      `  SURPRISE: coverage spans ${spanDays.toFixed(1)} days, reaching past the\n` +
        "  current round. If that holds, this source could replace ESPN for part\n" +
        "  of the lookahead window too -- worth re-checking ingest-odds.ts.",
    );
  }
  console.log(`\nRaw response written to ${OUT}/odds.json`);
}

main().catch((err) => {
  console.error(`\nSPIKE FAILED: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
