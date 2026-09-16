"use client";

import { useMemo, useState } from "react";
import { buildPlan, planSurvival, type PlanStrategy } from "@/lib/model/plan";
import type { ModelConfig, ProbMatrix } from "@/lib/model/types";
import type { WeekMatchup } from "@/lib/model/engine";
import { probColor } from "./scorecard-table";

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

export function PlanTable({
  matrix,
  matchups,
  available,
  weeks,
  config,
}: {
  matrix: ProbMatrix;
  matchups: Record<string, Record<string, WeekMatchup>>;
  available: string[];
  weeks: number[];
  config: ModelConfig;
}) {
  const [strategy, setStrategy] = useState<PlanStrategy>("optimal");

  const input = useMemo(
    () => ({ matrix, weeks, available, matchups, config }),
    [matrix, weeks, available, matchups, config],
  );

  const rows = useMemo(() => buildPlan(input, strategy), [input, strategy]);

  // Always compute both so the cost of picking week-by-week is visible.
  const greedySurvival = useMemo(
    () => planSurvival(buildPlan(input, "greedy")),
    [input],
  );
  const optimalSurvival = useMemo(
    () => planSurvival(buildPlan(input, "optimal")),
    [input],
  );
  const gap = optimalSurvival - greedySurvival;

  if (weeks.length === 0) {
    return (
      <p className="rounded-lg border border-amber-900/50 bg-amber-950/30 px-4 py-3 text-sm text-amber-200">
        No weeks have probability data yet. Run{" "}
        <code className="rounded bg-amber-900/40 px-1">
          npm run ingest:odds:espn
        </code>{" "}
        to load lookahead lines.
      </p>
    );
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-4">
        <div className="flex gap-1 rounded-lg bg-slate-900 p-1">
          {(["optimal", "greedy"] as PlanStrategy[]).map((s) => (
            <button
              key={s}
              onClick={() => setStrategy(s)}
              className={`rounded-md px-3 py-1.5 text-sm capitalize transition ${
                strategy === s
                  ? "bg-slate-700 text-white"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              {s}
            </button>
          ))}
        </div>

        {strategy === "optimal" && (
          <span
            className="text-xs text-slate-500"
            title="Optimal works from blended probabilities. PickLater approximates the value of saving a team; the assignment solves that exactly, so applying lambda would count it twice."
          >
            λ does not affect this plan — it solves the future directly
          </span>
        )}

        <div className="text-sm">
          <span className="text-slate-400">
            Survive weeks {weeks[0]}–{weeks[weeks.length - 1]}:{" "}
          </span>
          <span className="font-semibold text-emerald-300 nums">
            {pct(strategy === "optimal" ? optimalSurvival : greedySurvival)}
          </span>
          {gap > 0.0005 && (
            <span className="ml-3 text-xs text-amber-300">
              optimal beats week-by-week by {(gap * 100).toFixed(1)} points
            </span>
          )}
          {gap <= 0.0005 && (
            <span className="ml-3 text-xs text-slate-500">
              week-by-week picking costs nothing here
            </span>
          )}
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg ring-1 ring-slate-800">
        <table className="w-full min-w-[760px] border-collapse text-sm nums">
          <thead>
            <tr className="bg-slate-900/80 text-left text-xs uppercase tracking-wide text-slate-400">
              <th className="px-3 py-2.5 font-medium">Week</th>
              <th className="px-3 py-2.5 font-medium">Pick</th>
              <th className="px-3 py-2.5 font-medium">Matchup</th>
              <th className="px-3 py-2.5 text-right font-medium">Win</th>
              <th
                className="px-3 py-2.5 text-right font-medium"
                title="Chance of surviving every week through this one"
              >
                Survive through
              </th>
              <th className="px-3 py-2.5 font-medium">Next best</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.week}
                className="border-t border-slate-800/70 hover:bg-slate-800/30"
              >
                <td className="px-3 py-2 text-slate-500">w{r.week}</td>
                <td className="px-3 py-2 text-base font-semibold">
                  {r.team ?? <span className="text-slate-600">—</span>}
                </td>
                <td className="px-3 py-2 text-slate-400">
                  {r.team === null ? (
                    <span className="text-amber-400/80">{r.note}</span>
                  ) : (
                    <>
                      <span className="text-slate-500">
                        {r.isHome ? "vs" : "@"}
                      </span>{" "}
                      {r.opponent}
                    </>
                  )}
                </td>
                <td
                  className="px-3 py-2 text-right font-medium"
                  style={r.prob === null ? undefined : { background: probColor(r.prob) }}
                >
                  {r.prob === null ? "—" : pct(r.prob)}
                </td>
                <td className="px-3 py-2 text-right text-slate-300">
                  {pct(r.cumulativeSurvival)}
                </td>
                <td className="px-3 py-2 text-xs text-slate-500">
                  {r.alternatives
                    .map((a) => `${a.team} ${(a.prob * 100).toFixed(0)}`)
                    .join("   ") || "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 space-y-1 text-xs text-slate-500">
        <p>
          <strong className="text-slate-400">Optimal</strong> solves all{" "}
          {weeks.length} weeks at once, maximising the chance of surviving every
          one — it will spend a weaker team now to keep a strong one for a week
          that needs it.{" "}
          <strong className="text-slate-400">Greedy</strong> takes the
          Scorecard&rsquo;s top pick each week in turn, so its first row always
          matches the Scorecard.
        </p>
        <p>
          The window follows the <strong className="text-slate-400">Horizon</strong>{" "}
          control, capped by how far the data reaches. Backtesting 2010–2025 could
          not distinguish horizons from 1 to 12 weeks, so treat a longer window as
          a flag that a team is valuable later, not as a reason to override a
          strong pick now.
        </p>
        <p>
          This is a plan, not a commitment. Lines move, and only the current
          week&rsquo;s numbers are firm — later weeks are single-book lookahead
          prices. Re-check it each week.
        </p>
      </div>
    </div>
  );
}
