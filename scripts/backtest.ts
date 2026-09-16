/**
 * How far ahead should the model look?
 *
 * Replays completed seasons as survivor pools, once per horizon, and measures
 * how long each survives. Every horizon sees exactly the same information; the
 * only difference is how many weeks ahead it plans over.
 *
 * AVOIDING LOOKAHEAD BIAS -- the whole experiment turns on this:
 *
 *   current week    actual de-vigged closing moneyline (you would have had it)
 *   future weeks    Elo projection from games completed BEFORE this week only
 *
 * Using the recorded closing lines for future weeks would hand long horizons
 * perfect knowledge of games that had not been priced yet, which is exactly
 * the advantage being tested. Elo is warmed up on seasons preceding the test
 * window so week 1 of the first test season already has real ratings.
 *
 * Pool rules follow the brief: one team per week, never reused, a tie counts
 * as a loss, three lives before elimination.
 *
 * Usage:
 *   npx tsx scripts/backtest.ts
 *   npx tsx scripts/backtest.ts --from 2010 --to 2025 --horizons 1,2,4,6,9
 */
import { readFile } from "node:fs/promises";
import { numOrNull, parseCsv } from "@/lib/ingest/csv";
import { consensusFromBooks } from "@/lib/model/probability";
import {
  eloWinProb,
  newRatings,
  regressBetweenSeasons,
  updateRatings,
  type Ratings,
} from "@/lib/model/elo";
import { buildPlan } from "@/lib/model/plan";
import { DEFAULT_CONFIG, type ProbMatrix } from "@/lib/model/types";
import type { WeekMatchup } from "@/lib/model/engine";
import { TEAMS } from "@/lib/data/teams";

const SOURCE_URL = "http://www.habitatring.com/games.csv";
const LIVES = 3;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

interface Game {
  season: number;
  week: number;
  home: string;
  away: string;
  homeMl: number | null;
  awayMl: number | null;
  /** home score minus away score; null if unplayed */
  margin: number | null;
}

async function loadGames(): Promise<Game[]> {
  const file = arg("from-file");
  const text = file
    ? await readFile(file, "utf8")
    : await (await fetch(SOURCE_URL)).text();

  return parseCsv(text)
    .filter((r) => r.game_type === "REG")
    .map((r) => {
      const hs = numOrNull(r.home_score);
      const as = numOrNull(r.away_score);
      return {
        season: Number(r.season),
        week: Number(r.week),
        home: r.home_team!,
        away: r.away_team!,
        homeMl: numOrNull(r.home_moneyline),
        awayMl: numOrNull(r.away_moneyline),
        margin: hs === null || as === null ? null : hs - as,
      };
    })
    .filter((g) => Number.isFinite(g.season) && Number.isFinite(g.week));
}

/** De-vigged market probability for the home team, or null. */
function marketHomeProb(g: Game): number | null {
  if (g.homeMl === null || g.awayMl === null) return null;
  const c = consensusFromBooks([
    { bookmaker: "close", homeMl: g.homeMl, awayMl: g.awayMl },
  ]);
  return c?.homeProbDevig ?? null;
}

/**
 * A strategy is defined by how far it looks and how much it values saving.
 *
 *   myopic   greedy with lambda 0 -- always take the best team now
 *   greedy   Score = blend - lambda * PickLater
 *   optimal  Hungarian assignment; ignores lambda by construction
 *   oracle   optimal, but future weeks priced with their ACTUAL closing lines
 *
 * `oracle` is deliberately cheating. It is the control that separates "saving
 * is not worth much" from "saving is worth something but our forward estimates
 * are too weak to capture it" -- which matters because production runs on ESPN
 * lookahead lines, not the Elo used here.
 */
export interface Strategy {
  label: string;
  kind: "greedy" | "optimal";
  lambda: number;
  oracle: boolean;
}

interface Pick {
  /**
   * Required for pairing. Pick logs are flattened across seasons, so keying a
   * paired comparison on week alone silently collides week 1 of every season
   * and compares unrelated decisions.
   */
  season: number;
  week: number;
  team: string;
  /** Closing-line probability of the picked team, for scoring. */
  prob: number;
  won: boolean;
}

interface SeasonResult {
  weeksSurvived: number;
  eliminated: boolean;
  correct: number;
  picks: number;
  livesLeft: number;
  /** Every pick made, tagged with its week, for the by-week breakdown. */
  log: Pick[];
}

function runSeason(
  seasonGames: Game[],
  ratingsAtStart: Ratings,
  horizon: number,
  strategy: Strategy,
  /** Play all 18 weeks regardless of losses, so strategies are comparable. */
  noElimination: boolean,
): { result: SeasonResult; ratingsAfter: Ratings } {
  const ratings: Ratings = new Map(ratingsAtStart);
  const weeks = [...new Set(seasonGames.map((g) => g.week))].sort((a, b) => a - b);
  const byWeek = new Map<number, Game[]>();
  for (const g of seasonGames) {
    const list = byWeek.get(g.week);
    if (list) list.push(g);
    else byWeek.set(g.week, [g]);
  }

  const pool = new Set(TEAMS.map((t) => t.abbr));
  let lives = LIVES;
  let correct = 0;
  let picks = 0;
  let weeksSurvived = 0;
  const log: Pick[] = [];

  for (const week of weeks) {
    if (lives <= 0 && !noElimination) break;

    // Build the information set available at this point in the season.
    const matrix: ProbMatrix = new Map();
    const matchups: Record<string, Record<string, WeekMatchup>> = {};
    const planWeeks: number[] = [];

    for (let w = week; w < week + horizon; w++) {
      const games = byWeek.get(w);
      if (!games) break;
      planWeeks.push(w);

      const teamProbs = new Map<string, { vegas?: number }>();
      const weekMatchups: Record<string, WeekMatchup> = {};

      for (const g of games) {
        /**
         * Current week always uses the real closing line -- you would have had
         * it before kickoff. Future weeks use Elo built only from completed
         * games, because using their recorded closing lines would be lookahead
         * bias and would flatter every saving strategy.
         *
         * The `oracle` strategy deliberately breaks that rule for future weeks.
         * It is not a valid strategy, it is the ceiling: it shows what saving
         * would be worth given perfect forward knowledge.
         */
        const useMarket = w === week || strategy.oracle;
        const homeProb =
          (useMarket ? marketHomeProb(g) : null) ??
          eloWinProb(ratings, g.home, g.away);
        teamProbs.set(g.home, { vegas: homeProb });
        teamProbs.set(g.away, { vegas: 1 - homeProb });
        weekMatchups[g.home] = { opponent: g.away, isHome: true };
        weekMatchups[g.away] = { opponent: g.home, isHome: false };
      }
      matrix.set(w, teamProbs);
      matchups[String(w)] = weekMatchups;
    }

    const available = [...pool];
    if (planWeeks.length === 0 || available.length === 0) break;

    const plan = buildPlan(
      {
        matrix,
        weeks: planWeeks,
        available,
        matchups,
        config: { ...DEFAULT_CONFIG, horizon, lambda: strategy.lambda },
      },
      strategy.kind,
    );

    const pick = plan[0]?.team ?? null;
    if (!pick) break;

    const game = (byWeek.get(week) ?? []).find(
      (g) => g.home === pick || g.away === pick,
    );
    if (!game || game.margin === null) break;

    const won =
      game.home === pick ? game.margin > 0 : game.margin < 0; // tie = loss

    /**
     * Score the pick with the closing line, always. Strategies DECIDE on
     * contemporaneous information only; evaluating them with the best
     * retrospective estimate is not lookahead bias, and using probability
     * rather than the realised result removes coin-flip noise -- which is
     * where the statistical power comes from.
     */
    const homeClose = marketHomeProb(game);
    const prob =
      homeClose === null
        ? null
        : game.home === pick
          ? homeClose
          : 1 - homeClose;

    picks++;
    weeksSurvived = week;
    if (won) correct++;
    else lives--;
    if (prob !== null && prob > 0) {
      log.push({ season: game.season, week, team: pick, prob, won });
    }

    pool.delete(pick);

    // Only now do this week's results become known.
    for (const g of byWeek.get(week) ?? []) {
      if (g.margin !== null) updateRatings(ratings, g.home, g.away, g.margin);
    }
  }

  return {
    result: {
      weeksSurvived,
      eliminated: lives <= 0,
      correct,
      picks,
      livesLeft: Math.max(0, lives),
      log,
    },
    ratingsAfter: ratings,
  };
}

/** Weeks 1-6 / 7-12 / 13-18, to expose an early-vs-late split. */
const BUCKETS: Array<{ label: string; from: number; to: number }> = [
  { label: "wk1-6", from: 1, to: 6 },
  { label: "wk7-12", from: 7, to: 12 },
  { label: "wk13-18", from: 13, to: 18 },
];

/**
 * Effective per-week win probability: exp(mean log p).
 *
 * Survival compounds multiplicatively, so the mean LOG probability is the
 * natural per-pick measure -- maximising it is maximising P(surviving all).
 * Exponentiating makes it readable: "this strategy picks 71.9% teams".
 */
function effectiveProb(picks: Pick[]): number | null {
  if (picks.length === 0) return null;
  const sum = picks.reduce((acc, p) => acc + Math.log(p.prob), 0);
  return Math.exp(sum / picks.length);
}

function inBucket(p: Pick, b: (typeof BUCKETS)[number]) {
  return p.week >= b.from && p.week <= b.to;
}

/** Fraction of picks that actually won. */
function winRate(picks: Pick[]): number | null {
  if (picks.length === 0) return null;
  return picks.filter((p) => p.won).length / picks.length;
}

/**
 * McNemar's test on paired picks.
 *
 * Most lambda values choose the SAME team most weeks, and identical picks carry
 * no information about which strategy is better -- they just inflate n while
 * contributing zero signal. So compare only the weeks where the two strategies
 * diverged, and within those only the DISCORDANT pairs: one won, the other
 * lost. Weeks where both won or both lost are equally uninformative.
 *
 * This is dramatically better powered than comparing overall win rates, which
 * is why an outcome-based test is worth running at all on a sample this small.
 */
function mcnemar(
  a: Pick[],
  b: Pick[],
): { differed: number; aOnly: number; bOnly: number; p: number | null } {
  const key = (p: Pick) => `${p.season}:${p.week}`;
  const bByKey = new Map(b.map((p) => [key(p), p]));

  let differed = 0;
  let aOnly = 0; // a won, b lost
  let bOnly = 0; // b won, a lost

  for (const pa of a) {
    const pb = bByKey.get(key(pa));
    if (!pb || pa.team === pb.team) continue;
    differed++;
    if (pa.won && !pb.won) aOnly++;
    else if (!pa.won && pb.won) bOnly++;
  }

  const n = aOnly + bOnly;
  if (n === 0) return { differed, aOnly, bOnly, p: null };

  // Two-sided exact binomial against p=0.5 on the discordant pairs.
  const logFact = (k: number) => {
    let s = 0;
    for (let i = 2; i <= k; i++) s += Math.log(i);
    return s;
  };
  const binom = (k: number) =>
    Math.exp(logFact(n) - logFact(k) - logFact(n - k) - n * Math.LN2);

  const observed = Math.min(aOnly, bOnly);
  let tail = 0;
  for (let k = 0; k <= observed; k++) tail += binom(k);
  return { differed, aOnly, bOnly, p: Math.min(1, 2 * tail) };
}

async function main() {
  const from = Number(arg("from") ?? 2010);
  const to = Number(arg("to") ?? 2025);
  const horizon = Number(arg("horizon") ?? 6);
  const warmupFrom = Number(arg("warmup") ?? 2002);
  const lambdas = (arg("lambdas") ?? "0,0.25,0.5,0.75,1,1.5,2")
    .split(",")
    .map(Number);

  const strategies: Strategy[] = [
    ...lambdas.map((l) => ({
      label: l === 0 ? "myopic (λ=0)" : `greedy λ=${l}`,
      kind: "greedy" as const,
      lambda: l,
      oracle: false,
    })),
    { label: "optimal", kind: "optimal", lambda: 0, oracle: false },
    { label: "optimal (ORACLE)", kind: "optimal", lambda: 0, oracle: true },
  ];

  const all = await loadGames();
  const seasons = [...new Set(all.map((g) => g.season))].sort((a, b) => a - b);

  console.log(
    `What is saving a strong team worth?  ${from}-${to}, horizon ${horizon}w.\n\n` +
      `Every strategy sees the same information: the real closing line for the\n` +
      `current week, and Elo built only from completed games for future weeks.\n` +
      `The ORACLE row cheats -- it prices future weeks with their actual closing\n` +
      `lines -- and exists to show the ceiling if forward estimates were perfect.\n\n` +
      `Picks are scored by the closing-line probability of the team chosen, not\n` +
      `by whether it won, which removes outcome luck. Elimination is disabled so\n` +
      `every strategy makes all 18 picks and the comparison is like-for-like.\n`,
  );

  // One shared rating history; every strategy branches from the same point each
  // season so none of them sees information the others did not.
  let warm = newRatings(TEAMS.map((t) => t.abbr));
  for (const season of seasons.filter((s) => s >= warmupFrom && s < from)) {
    warm = regressBetweenSeasons(warm);
    for (const g of all
      .filter((x) => x.season === season)
      .sort((a, b) => a.week - b.week)) {
      if (g.margin !== null) updateRatings(warm, g.home, g.away, g.margin);
    }
  }

  const testSeasons = seasons.filter((s) => s >= from && s <= to);
  const bySeason = new Map<string, SeasonResult[]>(
    strategies.map((s) => [s.label, [] as SeasonResult[]]),
  );

  let seasonStart = warm;
  for (const season of testSeasons) {
    seasonStart = regressBetweenSeasons(seasonStart);
    const games = all.filter((g) => g.season === season);

    for (const s of strategies) {
      const { result } = runSeason(games, seasonStart, horizon, s, true);
      bySeason.get(s.label)!.push(result);
    }

    const next: Ratings = new Map(seasonStart);
    for (const g of games.sort((a, b) => a.week - b.week)) {
      if (g.margin !== null) updateRatings(next, g.home, g.away, g.margin);
    }
    seasonStart = next;
  }

  const allPicks = new Map<string, Pick[]>(
    strategies.map((s) => [
      s.label,
      bySeason.get(s.label)!.flatMap((r) => r.log),
    ]),
  );

  const pctOrDash = (v: number | null) =>
    v === null ? "  --  " : `${(v * 100).toFixed(2)}%`;

  console.log("strategy          |  overall  | " + BUCKETS.map((b) => b.label.padStart(8)).join(" | "));
  console.log("-".repeat(62));
  for (const s of strategies) {
    const picks = allPicks.get(s.label)!;
    const cells = BUCKETS.map((b) =>
      pctOrDash(effectiveProb(picks.filter((p) => inBucket(p, b)))).padStart(8),
    );
    console.log(
      `${s.label.padEnd(17)} | ${pctOrDash(effectiveProb(picks)).padStart(8)}  | ${cells.join(" | ")}`,
    );
  }
  console.log(
    "\neffective win % = exp(mean log p) of the teams chosen -- the per-week\n" +
      "win probability the strategy achieves IF the closing line is correct.",
  );

  // ---- What actually happened -------------------------------------------
  // The table above scores picks by the market's price. This one scores them
  // by whether they won. It is the question that matters and the one the
  // probability metric cannot answer -- if the market systematically misprices
  // late-season teams, only this table would show it.
  const totalPicks = allPicks.get(strategies[0]!.label)!.length;
  console.log(
    `\n=== ACTUAL RESULTS (${totalPicks} picks per strategy) ===`,
  );
  console.log(
    "strategy          |  overall  | " +
      BUCKETS.map((b) => b.label.padStart(8)).join(" | "),
  );
  console.log("-".repeat(62));
  for (const s of strategies) {
    const picks = allPicks.get(s.label)!;
    const cells = BUCKETS.map((b) =>
      pctOrDash(winRate(picks.filter((p) => inBucket(p, b)))).padStart(8),
    );
    console.log(
      `${s.label.padEnd(17)} | ${pctOrDash(winRate(picks)).padStart(8)}  | ${cells.join(" | ")}`,
    );
  }

  // Standard error on a bucket rate, so the noise floor is visible rather than
  // implied. n per bucket is roughly totalPicks/3.
  const perBucket = Math.round(totalPicks / BUCKETS.length);
  const se = Math.sqrt((0.78 * 0.22) / perBucket) * 100;
  console.log(
    `\nnoise floor: each bucket holds ~${perBucket} picks, so its standard error is\n` +
      `about ${se.toFixed(1)} points. Differences smaller than roughly ${(2 * se).toFixed(0)} points\n` +
      `between strategies are not distinguishable from chance here.`,
  );

  // ---- The headline: what does saving buy, and when? ----------------------
  const myopic = allPicks.get("myopic (λ=0)");
  const optimal = allPicks.get("optimal");
  const oracle = allPicks.get("optimal (ORACLE)");

  if (myopic && optimal && oracle) {
    console.log("\n=== VALUE OF SAVING (points of win probability per pick) ===");
    console.log("bucket   | optimal − myopic | ORACLE − myopic");
    console.log("-".repeat(50));
    for (const b of BUCKETS) {
      const m = effectiveProb(myopic.filter((p) => inBucket(p, b)));
      const o = effectiveProb(optimal.filter((p) => inBucket(p, b)));
      const r = effectiveProb(oracle.filter((p) => inBucket(p, b)));
      if (m === null || o === null || r === null) continue;
      const d1 = (o - m) * 100;
      const d2 = (r - m) * 100;
      console.log(
        `${b.label.padEnd(8)} |      ${(d1 >= 0 ? "+" : "") + d1.toFixed(2).padStart(6)}      |      ` +
          `${(d2 >= 0 ? "+" : "") + d2.toFixed(2).padStart(6)}`,
      );
    }
    const mAll = effectiveProb(myopic)!;
    console.log(
      `overall  |      ${(((effectiveProb(optimal)! - mAll) * 100) >= 0 ? "+" : "") + ((effectiveProb(optimal)! - mAll) * 100).toFixed(2).padStart(6)}      |      ` +
        `${(((effectiveProb(oracle)! - mAll) * 100) >= 0 ? "+" : "") + ((effectiveProb(oracle)! - mAll) * 100).toFixed(2).padStart(6)}`,
    );
  }

  // ---- Head-to-head on the weeks where strategies actually diverged -------
  const mcBaseline = arg("baseline") ?? "greedy λ=1";
  const mcBase = allPicks.get(mcBaseline);
  if (mcBase) {
    console.log(
      `\n=== HEAD-TO-HEAD vs "${mcBaseline}" (only weeks they picked differently) ===`,
    );
    console.log(
      "strategy          | differed | it won, base lost | base won, it lost | p",
    );
    console.log("-".repeat(78));
    for (const s of strategies) {
      if (s.label === mcBaseline) continue;
      const r = mcnemar(allPicks.get(s.label)!, mcBase);
      const verdict =
        r.p === null
          ? "  n/a"
          : r.aOnly + r.bOnly < 10
            ? `${r.p.toFixed(2)} (too few)`
            : r.p.toFixed(3);
      console.log(
        `${s.label.padEnd(17)} |   ${String(r.differed).padStart(4)}   |` +
          `        ${String(r.aOnly).padStart(3)}        |` +
          `        ${String(r.bOnly).padStart(3)}        | ${verdict}`,
      );
    }
    console.log(
      "\nOnly discordant pairs (one won, one lost) carry information; weeks where\n" +
        "both strategies picked the same team, or both won, tell us nothing. With\n" +
        "fewer than ~10 discordant pairs a p-value is not meaningful.",
    );
  }

  // ---- Is any of it real? -------------------------------------------------
  // Resample SEASONS, not picks: picks within a season share one draining pool
  // and are strongly dependent.
  const baselineLabel = arg("baseline") ?? "greedy λ=1";
  const baseSeasons = bySeason.get(baselineLabel);
  if (!baseSeasons) {
    console.log(`\n(no baseline "${baselineLabel}" to bootstrap against)`);
    return;
  }

  const n = testSeasons.length;
  const DRAWS = 20000;
  let seed = 987654321;
  const rnd = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return Math.abs(seed) / 2147483648;
  };

  const seasonEff = (rs: SeasonResult[]) =>
    rs.map((r) => effectiveProb(r.log) ?? Number.NaN);

  const baseEff = seasonEff(baseSeasons);

  console.log(
    `\nPaired bootstrap vs "${baselineLabel}" (${DRAWS} resamples of ${n} seasons):`,
  );
  console.log("strategy          | mean diff (pts) |       95% CI       | P(better)");
  console.log("-".repeat(72));

  for (const s of strategies) {
    if (s.label === baselineLabel) continue;
    const eff = seasonEff(bySeason.get(s.label)!);
    const diffs = eff.map((v, i) => (v - baseEff[i]!) * 100);

    const means: number[] = [];
    let better = 0;
    for (let d = 0; d < DRAWS; d++) {
      let sum = 0;
      for (let i = 0; i < n; i++) sum += diffs[Math.floor(rnd() * n)]!;
      const m = sum / n;
      means.push(m);
      if (m > 0) better++;
    }
    means.sort((a, b) => a - b);
    const observed = diffs.reduce((a, b) => a + b, 0) / n;

    console.log(
      `${s.label.padEnd(17)} |     ${(observed >= 0 ? "+" : "") + observed.toFixed(2).padStart(6)}      | ` +
        `[${means[Math.floor(DRAWS * 0.025)]!.toFixed(2).padStart(6)}, ${means[Math.floor(DRAWS * 0.975)]!.toFixed(2).padStart(6)}] |   ${((better / DRAWS) * 100).toFixed(0)}%`,
    );
  }
  console.log(
    "\nA 95% CI spanning zero means the difference is indistinguishable from noise.",
  );

  // ---- Secondary: does it actually keep you alive? ------------------------
  if (process.argv.includes("--survival")) {
    console.log("\n=== SURVIVAL (3 lives, elimination on) ===");
    console.log("strategy          | mean weeks | survived all");
    console.log("-".repeat(48));
    let start = warm;
    const surv = new Map<string, number[]>(strategies.map((s) => [s.label, []]));
    const allSurv = new Map<string, boolean[]>(
      strategies.map((s) => [s.label, []]),
    );
    for (const season of testSeasons) {
      start = regressBetweenSeasons(start);
      const games = all.filter((g) => g.season === season);
      for (const s of strategies) {
        const { result } = runSeason(games, start, horizon, s, false);
        surv.get(s.label)!.push(result.weeksSurvived);
        allSurv.get(s.label)!.push(!result.eliminated);
      }
      const next: Ratings = new Map(start);
      for (const g of games.sort((a, b) => a.week - b.week)) {
        if (g.margin !== null) updateRatings(next, g.home, g.away, g.margin);
      }
      start = next;
    }
    for (const s of strategies) {
      const w = surv.get(s.label)!;
      const mean = w.reduce((a, b) => a + b, 0) / w.length;
      const all18 = allSurv.get(s.label)!.filter(Boolean).length;
      console.log(
        `${s.label.padEnd(17)} |   ${mean.toFixed(2).padStart(6)}   |    ${all18}/${w.length}`,
      );
    }
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
