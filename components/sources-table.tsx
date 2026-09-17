"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { GameSources, SourceSummary } from "@/lib/db/repo/sources";

interface RefreshResult {
  source: string;
  status: "ok" | "skipped" | "error";
  detail: string;
}

function parseUtc(iso: string): number {
  return Date.parse(iso.replace(" ", "T") + (iso.endsWith("Z") ? "" : "Z"));
}

function ago(iso: string | null, mounted: boolean): string {
  if (!iso) return "never";
  if (!mounted) return "…";
  const hours = (Date.now() - parseUtc(iso)) / 3_600_000;
  if (!Number.isFinite(hours)) return iso;
  if (hours < 1) return `${Math.max(0, Math.round(hours * 60))}m ago`;
  if (hours < 48) return `${Math.round(hours)}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

const pct = (v: number | null | undefined) =>
  v === null || v === undefined ? null : `${(v * 100).toFixed(1)}`;

const STATUS_STYLE: Record<RefreshResult["status"], string> = {
  ok: "text-emerald-300",
  skipped: "text-slate-400",
  error: "text-red-300",
};

export function SourcesTable({
  summary,
  currentWeek,
}: {
  summary: SourceSummary;
  currentWeek: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<RefreshResult[] | null>(null);
  const [weekFilter, setWeekFilter] = useState<number | "all">("all");

  // Relative times differ between server render and hydration, so hold them
  // back until after mount. Same approach as the freshness banner.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const weeks = useMemo(
    () => [...new Set(summary.games.map((g) => g.week))].sort((a, b) => a - b),
    [summary.games],
  );

  const rows = useMemo(
    () =>
      weekFilter === "all"
        ? summary.games
        : summary.games.filter((g) => g.week === weekFilter),
    [summary.games, weekFilter],
  );

  async function refresh() {
    setRunning(true);
    setResults(null);
    try {
      const res = await fetch("/api/refresh", { method: "POST" });
      const body = (await res.json()) as { results: RefreshResult[] };
      setResults(body.results);
      startTransition(() => router.refresh());
    } catch (err) {
      setResults([
        {
          source: "Refresh",
          status: "error",
          detail: err instanceof Error ? err.message : "request failed",
        },
      ]);
    } finally {
      setRunning(false);
    }
  }

  const cov = summary.coverage;
  const stamp = summary.silverStamp;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-3">
        <button
          onClick={refresh}
          disabled={running || pending}
          className="rounded-md bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-600 disabled:opacity-50"
        >
          {running ? "Refreshing…" : "Refresh all sources"}
        </button>

        <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-400">
          <span
            title={
              "When the ELWAY numbers last changed — not when we fetched them, " +
              "and not the sheet's own timestamp" +
              (stamp.sourceAsOf
                ? `, which reads ${stamp.sourceAsOf.slice(0, 10)}.`
                : ".")
            }
          >
            ELWAY:{" "}
            <span
              className={
                cov.silver.newest &&
                mounted &&
                Date.now() - parseUtc(cov.silver.newest) > 8 * 24 * 3_600_000
                  ? "text-amber-400"
                  : "text-slate-200"
              }
            >
              {ago(cov.silver.newest, mounted)}
            </span>
            <span className="ml-1 text-slate-600">({cov.silver.games} games)</span>
            {stamp.stampUnreliable && (
              <span className="ml-1 cursor-help text-amber-500">*</span>
            )}
          </span>
          <span>
            ESPN:{" "}
            <span className="text-slate-200">{ago(cov.espn.newest, mounted)}</span>
            <span className="ml-1 text-slate-600">({cov.espn.games})</span>
          </span>
          <span>
            Odds API:{" "}
            <span className="text-slate-200">{ago(cov.oddsApi.newest, mounted)}</span>
            <span className="ml-1 text-slate-600">({cov.oddsApi.games})</span>
          </span>
        </div>

        <label className="ml-auto flex items-center gap-2 text-sm">
          <span className="text-slate-400">Week</span>
          <select
            value={String(weekFilter)}
            onChange={(e) =>
              setWeekFilter(e.target.value === "all" ? "all" : Number(e.target.value))
            }
            className="rounded bg-slate-800 px-2 py-1 text-slate-200"
          >
            <option value="all">All</option>
            {weeks.map((w) => (
              <option key={w} value={w}>
                {w}
                {w === currentWeek ? " (current)" : ""}
              </option>
            ))}
          </select>
        </label>
      </div>

      {results && (
        <ul className="mb-4 space-y-1 rounded-lg bg-slate-900/60 px-4 py-3 text-sm ring-1 ring-slate-800">
          {results.map((r) => (
            <li key={r.source}>
              <span className="text-slate-300">{r.source}:</span>{" "}
              <span className={STATUS_STYLE[r.status]}>{r.detail}</span>
            </li>
          ))}
        </ul>
      )}

      {stamp.stampUnreliable && (
        <p className="mb-4 rounded-lg bg-amber-950/30 px-4 py-3 text-xs leading-relaxed text-amber-200/90 ring-1 ring-amber-900/50">
          <span className="font-semibold text-amber-300">
            * ELWAY&rsquo;s sheet under-reports its own age.
          </span>{" "}
          Its numbers last changed{" "}
          <strong className="text-amber-100">
            {ago(stamp.changedAt, mounted)}
          </strong>
          , but the sheet still stamps itself{" "}
          <strong className="text-amber-100">
            {stamp.sourceAsOf?.slice(0, 10)}
          </strong>
          . Silver rewrites the data without always updating that field, so we
          time ELWAY by when its numbers actually moved instead. Reading the
          sheet&rsquo;s stamp is what made this tab report a week-old forecast
          on the day it had just been refreshed.
        </p>
      )}

      <div className="max-h-[70vh] overflow-auto rounded-lg ring-1 ring-slate-800">
        <table className="w-full min-w-[820px] border-collapse text-sm nums">
          <thead className="sticky top-0 z-10">
            <tr className="bg-slate-900 text-left text-xs uppercase tracking-wide text-slate-400">
              <th className="px-3 py-2.5 font-medium">Wk</th>
              <th className="px-3 py-2.5 font-medium">Matchup</th>
              <th className="px-3 py-2.5 text-right font-medium">ELWAY</th>
              <th className="px-3 py-2.5 text-right font-medium">ESPN</th>
              <th
                className="px-3 py-2.5 text-right font-medium"
                title="Median across ~10 books. Only ever available for the current week."
              >
                Odds API
              </th>
              <th
                className="px-3 py-2.5 text-right font-medium"
                title="ELWAY minus ESPN, home side"
              >
                Gap
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((g) => (
              <SourceRow key={g.gameId} game={g} currentWeek={currentWeek} />
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs text-slate-500">
        Probabilities are for the <strong className="text-slate-400">home</strong>{" "}
        team, de-vigged. ELWAY and ESPN both publish a multi-week lookahead. The
        Odds API only ever returns the current round, so its column is
        legitimately blank for later weeks — that is the API&rsquo;s shape, not
        missing data. <span className="text-slate-600">°</span> marks a
        single-book line rather than a median. ELWAY&rsquo;s age is measured
        from when its numbers last changed, not from the timestamp the sheet
        publishes about itself.
      </p>
    </div>
  );
}

function SourceRow({
  game,
  currentWeek,
}: {
  game: GameSources;
  currentWeek: number;
}) {
  const elway = pct(game.silver?.home);
  const espn = pct(game.espn?.home);
  const api = pct(game.oddsApi?.home);

  const gap =
    game.silver?.home != null && game.espn?.home != null
      ? (game.silver.home - game.espn.home) * 100
      : null;

  const isCurrent = game.week === currentWeek;

  return (
    <tr
      className={`border-t border-slate-800/70 ${
        isCurrent ? "bg-sky-950/30" : ""
      } ${game.played ? "opacity-50" : ""}`}
    >
      <td className="px-3 py-2 text-slate-500">{game.week}</td>
      <td className="px-3 py-2">
        <span className="text-slate-400">{game.awayTeam}</span>
        <span className="mx-1 text-slate-600">@</span>
        <span className="font-semibold">{game.homeTeam}</span>
        {game.played && (
          <span className="ml-2 text-xs text-slate-600">final</span>
        )}
      </td>
      <td className="px-3 py-2 text-right text-slate-300">
        {elway ?? <span className="text-slate-700">—</span>}
      </td>
      <td className="px-3 py-2 text-right text-slate-300">
        {espn ?? <span className="text-slate-700">—</span>}
        {espn && game.espn?.books === 1 && (
          <span className="ml-1 text-slate-600">°</span>
        )}
      </td>
      <td className="px-3 py-2 text-right text-slate-300">
        {api ? (
          <>
            {api}
            <span className="ml-1 text-xs text-slate-600">
              {game.oddsApi?.books}b
            </span>
          </>
        ) : (
          <span className="text-slate-700">—</span>
        )}
      </td>
      <td
        className={`px-3 py-2 text-right font-medium ${
          gap === null
            ? "text-slate-700"
            : Math.abs(gap) >= 5
              ? gap > 0
                ? "text-emerald-400"
                : "text-red-400"
              : "text-slate-500"
        }`}
      >
        {gap === null ? (
          "—"
        ) : (
          <>
            {gap >= 0 ? "+" : "−"}
            {Math.abs(gap).toFixed(1)}
            {Math.abs(gap) >= 5 && <span className="ml-1">!</span>}
          </>
        )}
      </td>
    </tr>
  );
}
