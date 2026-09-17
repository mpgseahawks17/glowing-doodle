"use client";

import { formatWeekRanges, type CoverageSummary } from "@/lib/model/coverage";

export function SettingsBar({
  lambda,
  onLambda,
  wVegas,
  onWVegas,
  horizon,
  onHorizon,
  maxHorizon,
  week,
  onWeek,
  currentWeek,
  coverage,
}: {
  lambda: number;
  onLambda: (v: number) => void;
  wVegas: number;
  onWVegas: (v: number) => void;
  horizon: number;
  onHorizon: (v: number) => void;
  /** Weeks left in the season after the selected one. */
  maxHorizon: number;
  week: number;
  onWeek: (v: number) => void;
  currentWeek: number;
  /** Source coverage from the selected week to the end of the season. */
  coverage: CoverageSummary;
}) {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-x-8 gap-y-4 rounded-lg bg-slate-900/50 px-4 py-3 ring-1 ring-slate-800">
      <label className="flex items-center gap-2 text-sm">
        <span className="text-slate-400">Week</span>
        <select
          value={week}
          onChange={(e) => onWeek(Number(e.target.value))}
          className="rounded bg-slate-800 px-2 py-1 text-slate-200"
        >
          {Array.from({ length: 18 }, (_, i) => i + 1).map((w) => (
            <option key={w} value={w}>
              {w}
              {w === currentWeek ? " (current)" : ""}
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-3 text-sm">
        <span className="text-slate-400" title="Opportunity-cost multiplier">
          λ
        </span>
        <input
          type="range"
          min={0}
          max={2}
          step={0.05}
          value={lambda}
          onChange={(e) => onLambda(Number(e.target.value))}
          className="w-36 accent-emerald-500"
        />
        <span className="w-8 text-right nums text-slate-200">
          {lambda.toFixed(2)}
        </span>
      </label>

      <label className="flex items-center gap-3 text-sm">
        <span className="text-slate-400">Vegas / Silver</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={wVegas}
          onChange={(e) => onWVegas(Number(e.target.value))}
          className="w-36 accent-sky-500"
        />
        <span className="w-20 text-right nums text-slate-200">
          {(wVegas * 100).toFixed(0)} / {((1 - wVegas) * 100).toFixed(0)}
        </span>
      </label>

      <label className="flex items-center gap-2 text-sm">
        <span className="text-slate-400">Horizon</span>
        <select
          value={horizon}
          onChange={(e) => onHorizon(Number(e.target.value))}
          className="rounded bg-slate-800 px-2 py-1 text-slate-200"
        >
          {Array.from({ length: maxHorizon }, (_, i) => i + 1).map((h) => (
            <option key={h} value={h}>
              {h}w{week + h === 18 ? " (rest of season)" : ""}
            </option>
          ))}
        </select>
      </label>

      <span className="text-xs text-slate-500">
        λ=0 ranks by raw win probability; higher λ defers teams with strong
        future spots.
      </span>

      <CoverageNote coverage={coverage} week={week} horizon={horizon} />
    </div>
  );
}

/**
 * What the horizon is actually reaching into.
 *
 * The horizon now runs to week 18, but ESPN's lookahead does not — so a long
 * window quietly crosses from market-priced weeks into ELWAY-only ones. This
 * names where that boundary is, and warns when the current window is past it.
 *
 * Everything here is read off the probability matrix, so it moves on its own
 * as ESPN prices more weeks.
 */
function CoverageNote({
  coverage,
  week,
  horizon,
}: {
  coverage: CoverageSummary;
  week: number;
  horizon: number;
}) {
  const windowEnd = Math.min(18, week + horizon);
  const beyondMarket =
    coverage.lastMarketWeek !== null && windowEnd > coverage.lastMarketWeek
      ? windowEnd - coverage.lastMarketWeek
      : 0;

  return (
    <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
      {coverage.both.length > 0 && (
        <span className="text-slate-500">
          Market + ELWAY:{" "}
          <span className="text-sky-300">
            wk {formatWeekRanges(coverage.both)}
          </span>
        </span>
      )}
      {coverage.silverOnly.length > 0 && (
        <span
          className="text-slate-500"
          title="No bookmaker has priced these games yet, so the blend falls through to ELWAY alone and the Vegas/Silver slider has no effect on them."
        >
          ELWAY only:{" "}
          <span className="text-amber-300">
            wk {formatWeekRanges(coverage.silverOnly)}
          </span>
        </span>
      )}
      {coverage.marketOnly.length > 0 && (
        <span
          className="text-slate-500"
          title="Priced by a bookmaker but absent from ELWAY's sheet — usually a week it has already dropped as played."
        >
          Market only:{" "}
          <span className="text-slate-300">
            wk {formatWeekRanges(coverage.marketOnly)}
          </span>
        </span>
      )}
      {coverage.none.length > 0 && (
        <span className="text-slate-600">
          No data: wk {formatWeekRanges(coverage.none)}
        </span>
      )}
      {beyondMarket > 0 && (
        <span className="text-amber-400/80">
          — the last {beyondMarket} {beyondMarket === 1 ? "week" : "weeks"} of
          this window {beyondMarket === 1 ? "is" : "are"} unpriced
        </span>
      )}
    </span>
  );
}
