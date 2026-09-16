/**
 * Ingest hand-entered ELWAY projections and validate them against the schedule.
 *
 * ELWAY's numbers sit inside a Substack code-embed iframe that Cloudflare will
 * not serve to a scripted client (Node's TLS handshake is rejected), and the
 * post's body_html never contains them regardless of subscription. So they are
 * transcribed each week into a text file and loaded here.
 *
 * IMPORTANT: ELWAY is a win/loss/TIE model, so for any game
 *
 *     homeProb + awayProb + tieProb = 1
 *
 * The opponent's probability therefore CANNOT be derived as 1 - p. Both sides
 * of a game must be transcribed independently. If only one side is given we
 * store just that side and leave the other null rather than inventing it --
 * the model treats a missing probability as "no data for this team this week",
 * which is correct, where a fabricated 1 - p would be silently wrong.
 *
 * Usage:
 *   npm run ingest:silver -- --from-file data/silver/week2.txt --dry-run
 *   npm run ingest:silver -- --from-file data/silver/week2.txt
 */
import { readFile } from "node:fs/promises";
import { and, eq, gte, lte } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { parseSilverText } from "@/lib/ingest/silver-parse";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

/**
 * Sanity bounds on the implied tie probability, 1 - home - away.
 *
 * NFL ties are rare -- roughly one or two a season, well under 1% of games --
 * so a legitimate ELWAY tie probability is a fraction of a point. A small
 * negative value is just rounding in the published figures. Anything beyond
 * these bounds means the two numbers do not belong to the same game.
 */
const TIE_MIN = -0.005;
const TIE_MAX = 0.05;

interface Resolved {
  gameId: string;
  week: number;
  homeTeam: string;
  awayTeam: string;
  homeProb: number | null;
  awayProb: number | null;
  tieProb: number | null;
  note: string;
}

async function main() {
  const file = arg("from-file");
  if (!file) {
    throw new Error(
      "Pass --from-file <path>. See data/silver/TEMPLATE.txt for the format.",
    );
  }
  const season = Number(arg("season") ?? process.env.SEASON ?? 2026);
  const dryRun = process.argv.includes("--dry-run");

  const { projections, errors } = parseSilverText(await readFile(file, "utf8"));

  if (errors.length > 0) {
    console.error(`Parse problems in ${file}:`);
    for (const e of errors) console.error(`  - ${e}`);
    console.error("\nNothing was written. Fix the file and re-run.");
    process.exit(1);
  }
  if (projections.length === 0) {
    throw new Error(`No projections found in ${file}.`);
  }

  const weeks = [...new Set(projections.map((p) => p.week))].sort((a, b) => a - b);
  const games = await db
    .select()
    .from(schema.games)
    .where(
      and(
        eq(schema.games.season, season),
        gte(schema.games.week, Math.min(...weeks)),
        lte(schema.games.week, Math.max(...weeks)),
      ),
    );

  const byWeekTeam = new Map<string, (typeof games)[number]>();
  for (const g of games) {
    byWeekTeam.set(`${g.week}:${g.homeTeam}`, g);
    byWeekTeam.set(`${g.week}:${g.awayTeam}`, g);
  }

  const resolved = new Map<string, Resolved>();
  const problems: string[] = [];

  for (const p of projections) {
    const game = byWeekTeam.get(`${p.week}:${p.team}`);
    if (!game) {
      problems.push(
        `line ${p.line}: ${p.team} has no week ${p.week} game ` +
          `(bye week, or the team code is wrong)`,
      );
      continue;
    }

    const entry =
      resolved.get(game.gameId) ??
      ({
        gameId: game.gameId,
        week: game.week,
        homeTeam: game.homeTeam,
        awayTeam: game.awayTeam,
        homeProb: null,
        awayProb: null,
        tieProb: null,
        note: "manual transcription",
      } satisfies Resolved);

    if (game.homeTeam === p.team) entry.homeProb = p.prob;
    else entry.awayProb = p.prob;

    resolved.set(game.gameId, entry);
  }

  // Now that both sides are collected, check they can coexist in one game.
  for (const r of resolved.values()) {
    if (r.homeProb === null || r.awayProb === null) continue;
    const tie = 1 - r.homeProb - r.awayProb;
    if (tie < TIE_MIN || tie > TIE_MAX) {
      problems.push(
        `${r.awayTeam}@${r.homeTeam} week ${r.week}: ` +
          `home ${(r.homeProb * 100).toFixed(1)}% + away ${(r.awayProb * 100).toFixed(1)}% ` +
          `implies a ${(tie * 100).toFixed(1)}% tie, which is out of range. ` +
          `Check both numbers belong to this game.`,
      );
      continue;
    }
    r.tieProb = Math.max(0, tie);
  }

  if (problems.length > 0) {
    console.error("Validation failed against the schedule:");
    for (const p of problems) console.error(`  - ${p}`);
    console.error("\nNothing was written.");
    process.exit(1);
  }

  // Coverage report. Silence about missing sides is how a half-filled week
  // quietly degrades the model.
  console.log(`Parsed ${projections.length} team entries from ${file}\n`);
  let oneSided = 0;
  for (const w of weeks) {
    const weekGames = games.filter((g) => g.week === w);
    const got = [...resolved.values()].filter((r) => r.week === w);
    const complete = got.filter((r) => r.homeProb !== null && r.awayProb !== null);
    const partial = got.filter((r) => r.homeProb === null || r.awayProb === null);
    oneSided += partial.length;

    console.log(
      `  week ${w}: ${complete.length}/${weekGames.length} games complete` +
        (partial.length > 0 ? `, ${partial.length} one-sided` : ""),
    );
    for (const r of partial) {
      const missing = r.homeProb === null ? r.homeTeam : r.awayTeam;
      console.log(`      one-sided: ${r.awayTeam}@${r.homeTeam} (missing ${missing})`);
    }
    for (const g of weekGames.filter((g) => !resolved.has(g.gameId))) {
      console.log(`      missing:   ${g.awayTeam}@${g.homeTeam}`);
    }
  }

  if (oneSided > 0) {
    console.log(
      `\nNOTE: ${oneSided} game(s) have only one side. The missing team will ` +
        `have no\n      Silver number for that week (its blend falls back to ` +
        `Vegas, or to nothing\n      in the forward window). ELWAY includes a ` +
        `tie probability, so the other\n      side cannot be derived as 1 - p.`,
    );
  }

  if (dryRun) {
    console.log("\nDry run: nothing written.");
    return;
  }

  db.transaction((tx) => {
    for (const r of resolved.values()) {
      tx.insert(schema.silverProjections)
        .values({
          gameId: r.gameId,
          homeProb: r.homeProb,
          awayProb: r.awayProb,
          tieProb: r.tieProb,
          ingestMethod: "manual",
          sourceNote: r.note,
        })
        .run();
    }
  });

  console.log(`\nWrote ${resolved.size} Silver projections.`);
  console.log("Run `npm run scorecard` to see the model with PickLater engaged.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
