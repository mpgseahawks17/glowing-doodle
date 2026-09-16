"use client";

import { useMemo, useState } from "react";
import { blendProb } from "@/lib/model/engine";
import type { BlendWeights, ProbMatrix } from "@/lib/model/types";
import type { SerializedMatchups } from "@/lib/model/serialize";
import { probColor } from "./scorecard-table";

const WEEKS = Array.from({ length: 18 }, (_, i) => i + 1);

export function ScheduleGrid({
  matrix,
  matchups,
  allTeams,
  available,
  currentWeek,
  horizon,
  weights,
}: {
  matrix: ProbMatrix;
  matchups: Record<string, SerializedMatchups>;
  allTeams: string[];
  available: Set<string>;
  currentWeek: number;
  horizon: number;
  weights: BlendWeights;
}) {
  const [onlyAvailable, setOnlyAvailable] = useState(false);
  const [sortWeek, setSortWeek] = useState<number | null>(null);

  const inWindow = (w: number) => w >= currentWeek && w <= currentWeek + horizon;

  const teams = useMemo(() => {
    const list = allTeams.filter((t) => !onlyAvailable || available.has(t));
    if (sortWeek === null) return [...list].sort();

    return [...list].sort((a, b) => {
      const pa = blendProb(matrix.get(sortWeek)?.get(a), weights);
      const pb = blendProb(matrix.get(sortWeek)?.get(b), weights);
      if (pa === null && pb === null) return a.localeCompare(b);
      if (pa === null) return 1; // byes and missing data sink
      if (pb === null) return -1;
      return pb - pa;
    });
  }, [allTeams, onlyAvailable, available, sortWeek, matrix, weights]);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-4 text-sm">
        <label className="flex cursor-pointer items-center gap-2 text-slate-300">
          <input
            type="checkbox"
            checked={onlyAvailable}
            onChange={(e) => setOnlyAvailable(e.target.checked)}
            className="accent-emerald-500"
          />
          Only unused teams
        </label>
        {sortWeek !== null && (
          <button
            onClick={() => setSortWeek(null)}
            className="rounded bg-slate-800 px-2 py-1 text-xs text-slate-300 hover:bg-slate-700"
          >
            Sorted by week {sortWeek} — reset to A–Z
          </button>
        )}
        <span className="text-xs text-slate-500">
          Click a week header to sort by that week&rsquo;s probability
        </span>
      </div>

      <div className="overflow-x-auto rounded-lg ring-1 ring-slate-800">
        <table className="border-collapse text-xs nums">
          <thead>
            <tr className="bg-slate-900/80">
              <th className="sticky left-0 z-10 bg-slate-900 px-3 py-2 text-left font-medium text-slate-400">
                Team
              </th>
              {WEEKS.map((w) => (
                <th
                  key={w}
                  onClick={() => setSortWeek(sortWeek === w ? null : w)}
                  className={`cursor-pointer px-2 py-2 text-center font-medium transition hover:bg-slate-700/50 ${
                    inWindow(w)
                      ? "bg-sky-950/60 text-sky-300"
                      : "text-slate-500"
                  } ${sortWeek === w ? "underline" : ""}`}
                  title={inWindow(w) ? "Inside the rolling window" : undefined}
                >
                  {w}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {teams.map((team) => {
              const used = !available.has(team);
              return (
                <tr key={team} className="border-t border-slate-800/70">
                  <td
                    className={`sticky left-0 z-10 bg-slate-950 px-3 py-1.5 font-semibold ${
                      used ? "text-slate-600 line-through" : "text-slate-200"
                    }`}
                  >
                    {team}
                  </td>
                  {WEEKS.map((w) => {
                    const m = matchups[String(w)]?.[team];
                    const p = blendProb(matrix.get(w)?.get(team), weights);

                    if (!m) {
                      return (
                        <td
                          key={w}
                          className={`px-2 py-1.5 text-center text-slate-700 ${
                            inWindow(w) ? "bg-sky-950/20" : "bg-slate-900/40"
                          }`}
                          title="Bye week"
                        >
                          ·
                        </td>
                      );
                    }

                    return (
                      <td
                        key={w}
                        className={`px-2 py-1.5 text-center ${
                          inWindow(w) ? "ring-1 ring-inset ring-sky-900/50" : ""
                        } ${used ? "opacity-40" : ""}`}
                        style={p === null ? undefined : { background: probColor(p) }}
                        title={`${team} ${m.isHome ? "vs" : "@"} ${m.opponent}${
                          p === null ? " — no data" : ` — ${(p * 100).toFixed(1)}%`
                        }`}
                      >
                        <div className="text-[10px] leading-tight text-slate-400">
                          {m.isHome ? "" : "@"}
                          {m.opponent}
                        </div>
                        <div className="leading-tight font-medium">
                          {p === null ? (
                            <span className="text-slate-600">—</span>
                          ) : (
                            (p * 100).toFixed(0)
                          )}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs text-slate-500">
        Blue-tinted columns are the current week plus the next {horizon} — the
        window PickLater searches. Dots are byes. Struck-through teams are
        already used.
      </p>
    </div>
  );
}
