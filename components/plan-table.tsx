"use client";

import { useMemo, useState } from "react";
import { buildPlan, planSurvival, type PlanStrategy } from "@/lib/model/plan";
import {
  buildSimulatedPlan,
  isEmpty,
  pinnableTeams,
  type Simulation,
} from "@/lib/model/simulate";
import type { ModelConfig, ProbMatrix } from "@/lib/model/types";
import type { WeekMatchup } from "@/lib/model/engine";
import { MatchupBadges } from "./matchup-badges";
import { probColor } from "./scorecard-table";

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const points = (v: number) => `${(v * 100).toFixed(1)} points`;

/** Unpinned rows carry this instead of a team, so the select has a value. */
const AUTO = "__auto";

export function PlanTable({
  matrix,
  matchups,
  available,
  weeks,
  config,
  livesLeft,
}: {
  matrix: ProbMatrix;
  matchups: Record<string, Record<string, WeekMatchup>>;
  available: string[];
  weeks: number[];
  config: ModelConfig;
  /** Lives left in the pool. Drives the survive-with-lives metric. */
  livesLeft: number;
}) {
  const [strategy, setStrategy] = useState<PlanStrategy>("optimal");
  const [sim, setSim] = useState<Simulation>({
    forced: new Map(),
    banned: new Set(),
  });

  const simActive = !isEmpty(sim);

  const input = useMemo(
    () => ({ matrix, weeks, available, matchups, config }),
    [matrix, weeks, available, matchups, config],
  );

  const plan = useMemo(
    () => buildSimulatedPlan(input, sim, livesLeft),
    [input, sim, livesLeft],
  );

  // Greedy stays available as the unconstrained comparison; a simulation is
  // defined against the assignment, so pinning forces the optimal view.
  const greedyRows = useMemo(() => buildPlan(input, "greedy"), [input]);
  const greedySurvival = useMemo(() => planSurvival(greedyRows), [greedyRows]);
  const showingGreedy = strategy === "greedy" && !simActive;
  const rows = showingGreedy ? greedyRows : plan.rows;
  const gap = plan.baseline.survival - greedySurvival;

  const knockOn = useMemo(
    () => new Map(plan.knockOn.map((k) => [k.week, k])),
    [plan.knockOn],
  );

  function pin(week: number, team: string | null) {
    setSim((prev) => {
      const forced = new Map(prev.forced);
      if (team === null) forced.delete(week);
      else forced.set(week, team);
      return { ...prev, forced };
    });
  }

  function toggleBan(team: string, on: boolean) {
    setSim((prev) => {
      const banned = new Set(prev.banned);
      const forced = new Map(prev.forced);
      if (on) {
        banned.add(team);
        // A banned team cannot also be pinned; drop the contradiction rather
        // than letting the two controls disagree silently.
        for (const [w, t] of forced) if (t === team) forced.delete(w);
      } else {
        banned.delete(team);
      }
      return { forced, banned };
    });
  }

  const reset = () => setSim({ forced: new Map(), banned: new Set() });

  const bannable = available
    .filter((t) => !sim.banned.has(t))
    .sort((a, b) => a.localeCompare(b));

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
              disabled={simActive && s === "greedy"}
              title={
                simActive && s === "greedy"
                  ? "A simulation solves the unpinned weeks as an assignment, so there is no greedy version of it. Reset to compare greedy."
                  : undefined
              }
              className={`rounded-md px-3 py-1.5 text-sm capitalize transition disabled:cursor-not-allowed disabled:opacity-40 ${
                (showingGreedy ? "greedy" : "optimal") === s
                  ? "bg-slate-700 text-white"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              {s}
            </button>
          ))}
        </div>

        {!showingGreedy && !simActive && (
          <span
            className="text-xs text-slate-500"
            title="Optimal works from blended probabilities. PickLater approximates the value of saving a team; the assignment solves that exactly, so applying lambda would count it twice."
          >
            λ does not affect this plan — it solves the future directly
          </span>
        )}

        <div className="text-sm">
          <span className="text-slate-400">
            Run weeks {weeks[0]}–{weeks[weeks.length - 1]}:{" "}
          </span>
          <span className="font-semibold text-emerald-300 nums">
            {pct(showingGreedy ? greedySurvival : plan.survival)}
          </span>
          <span
            className="ml-3 text-slate-400"
            title={
              `Chance of coming out of these weeks still alive, given ${livesLeft} ` +
              `${livesLeft === 1 ? "life" : "lives"} left — it tolerates ` +
              `${livesLeft - 1} ${livesLeft - 1 === 1 ? "loss" : "losses"}. ` +
              `Surviving is not the same as winning: ~50 people are in this pool.`
            }
          >
            still alive:{" "}
            <span className="font-semibold text-sky-300 nums">
              {pct(plan.livesSurvival)}
            </span>
          </span>
          {!simActive && gap > 0.0005 && (
            <span className="ml-3 text-xs text-amber-300">
              optimal beats week-by-week by {(gap * 100).toFixed(1)} points
            </span>
          )}
          {!simActive && gap <= 0.0005 && (
            <span className="ml-3 text-xs text-slate-500">
              week-by-week picking costs nothing here
            </span>
          )}
        </div>

        {simActive && (
          <button
            onClick={reset}
            className="ml-auto rounded-md bg-slate-800 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-700"
          >
            Reset simulation
          </button>
        )}
      </div>

      {simActive && <CostBanner plan={plan} livesLeft={livesLeft} />}

      {plan.problems.map((p) => (
        <p
          key={p}
          className="mb-3 rounded-lg border border-amber-900/50 bg-amber-950/30 px-4 py-2.5 text-xs leading-relaxed text-amber-200"
        >
          {p}
        </p>
      ))}

      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
        <span className="text-slate-500">Assume unavailable:</span>
        {[...sim.banned].sort().map((t) => (
          <span
            key={t}
            className="inline-flex items-center gap-1 rounded bg-amber-500/10 px-2 py-0.5 font-medium text-amber-300 ring-1 ring-amber-500/25"
          >
            {t}
            <button
              onClick={() => toggleBan(t, false)}
              aria-label={`Stop excluding ${t}`}
              className="text-amber-500/70 hover:text-amber-200"
            >
              ×
            </button>
          </span>
        ))}
        <select
          value=""
          onChange={(e) => e.target.value && toggleBan(e.target.value, true)}
          className="rounded bg-slate-800 px-2 py-0.5 text-slate-300"
        >
          <option value="">add a team…</option>
          {bannable.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>

      <div className="overflow-x-auto rounded-lg ring-1 ring-slate-800">
        <table className="w-full min-w-[820px] border-collapse text-sm nums">
          <thead>
            <tr className="bg-slate-900/80 text-left text-xs uppercase tracking-wide text-slate-400">
              <th className="px-3 py-2.5 font-medium">Week</th>
              <th
                className="px-3 py-2.5 font-medium"
                title="Choose a team to pin it to that week. The rest of the plan re-solves around it."
              >
                Pick
              </th>
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
            {rows.map((r) => {
              const pinned = plan.forcedWeeks.has(r.week) && !showingGreedy;
              const hit = showingGreedy ? undefined : knockOn.get(r.week);
              return (
                <tr
                  key={r.week}
                  className={`border-t border-slate-800/70 hover:bg-slate-800/30 ${
                    pinned ? "bg-emerald-950/20 ring-1 ring-inset ring-emerald-500/40" : ""
                  }`}
                >
                  <td className="px-3 py-2 text-slate-500">w{r.week}</td>
                  <td className="px-3 py-2">
                    {showingGreedy ? (
                      <span className="text-base font-semibold">
                        {r.team ?? <span className="text-slate-600">—</span>}
                      </span>
                    ) : (
                      <PickSelect
                        week={r.week}
                        solved={r.team}
                        pinned={pinned}
                        options={pinnableTeams(input, r.week, sim)}
                        onPin={pin}
                      />
                    )}
                  </td>
                  <td className="px-3 py-2 text-slate-400">
                    {r.team === null || r.prob === null ? (
                      <span className="text-amber-400/80">{r.note}</span>
                    ) : (
                      <>
                        <span className="text-slate-500">
                          {r.isHome ? "vs" : "@"}
                        </span>{" "}
                        {r.opponent}
                        <MatchupBadges context={r.context} opponent={r.opponent} />
                      </>
                    )}
                  </td>
                  <td
                    className="px-3 py-2 text-right font-medium"
                    style={
                      r.prob === null ? undefined : { background: probColor(r.prob) }
                    }
                  >
                    {r.prob === null ? "—" : pct(r.prob)}
                  </td>
                  <td className="px-3 py-2 text-right text-slate-300">
                    {pct(r.cumulativeSurvival)}
                    {hit && (
                      <span
                        className="ml-1.5 text-amber-400"
                        title={`Week ${hit.week} fell from ${pct(hit.before)} to ${pct(
                          hit.after,
                        )} because of what you pinned.`}
                      >
                        ▼
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-500">
                    {r.alternatives
                      .map((a) => `${a.team} ${(a.prob * 100).toFixed(0)}`)
                      .join("   ") || "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-3 space-y-1 text-xs text-slate-500">
        <p>
          Pick a team in any row to <strong className="text-slate-400">pin</strong>{" "}
          it to that week; the remaining weeks re-solve around it and the header
          shows what the choice costs. Rows marked{" "}
          <span className="text-amber-400">▼</span> got worse than they were
          before you pinned.
        </p>
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
          prices, and weeks 11–18 have no market at all, so a simulated cost out
          there is built on ELWAY alone. Re-check it each week.
        </p>
      </div>
    </div>
  );
}

function PickSelect({
  week,
  solved,
  pinned,
  options,
  onPin,
}: {
  week: number;
  solved: string | null;
  pinned: boolean;
  options: Array<{ team: string; prob: number }>;
  onPin: (week: number, team: string | null) => void;
}) {
  return (
    <select
      value={pinned && solved !== null ? solved : AUTO}
      onChange={(e) =>
        onPin(week, e.target.value === AUTO ? null : e.target.value)
      }
      className={`w-full rounded bg-slate-800 px-2 py-1 text-base font-semibold focus:outline-none focus-visible:ring-1 focus-visible:ring-sky-500 ${
        pinned ? "text-emerald-200" : "text-slate-100"
      }`}
    >
      <option value={AUTO}>{solved ? `auto — ${solved}` : "auto — none"}</option>
      {options.map((o) => (
        <option key={o.team} value={o.team}>
          {o.team} {(o.prob * 100).toFixed(1)}%
        </option>
      ))}
    </select>
  );
}

function CostBanner({
  plan,
  livesLeft,
}: {
  plan: ReturnType<typeof buildSimulatedPlan>;
  livesLeft: number;
}) {
  const free = Math.abs(plan.cost) < 0.0005 && Math.abs(plan.livesCost) < 0.0005;
  const worst = plan.knockOn[0];

  return (
    <div className="mb-3 rounded-lg bg-slate-900/60 px-4 py-3 text-sm ring-1 ring-slate-800">
      {free ? (
        <p className="text-emerald-300">
          This is already the optimal path — your picks cost nothing.
        </p>
      ) : (
        <p className="leading-relaxed text-slate-300">
          Your picks cost{" "}
          <strong className={plan.cost > 0 ? "text-amber-300" : "text-emerald-300"}>
            {points(Math.abs(plan.cost))}
          </strong>{" "}
          of running the table ({pct(plan.baseline.survival)} →{" "}
          {pct(plan.survival)}) and{" "}
          <strong
            className={plan.livesCost > 0 ? "text-amber-300" : "text-emerald-300"}
          >
            {points(Math.abs(plan.livesCost))}
          </strong>{" "}
          of still being alive with {livesLeft}{" "}
          {livesLeft === 1 ? "life" : "lives"} ({pct(plan.baseline.livesSurvival)}{" "}
          → {pct(plan.livesSurvival)}).
          {plan.cost > 0 !== plan.livesCost > 0 && (
            <span className="text-sky-300">
              {" "}
              The two disagree: this trade is better on one objective and worse
              on the other. The solver only optimises the first.
            </span>
          )}
        </p>
      )}
      {worst && (
        <p className="mt-1.5 text-xs text-slate-400">
          Week {worst.week} is the biggest casualty — {pct(worst.before)} →{" "}
          {pct(worst.after)}.
        </p>
      )}
    </div>
  );
}
