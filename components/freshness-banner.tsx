"use client";

import { useEffect, useState } from "react";

/** SQLite CURRENT_TIMESTAMP is UTC with a space and no zone marker. */
function parseUtc(iso: string): number {
  return Date.parse(iso.replace(" ", "T") + (iso.endsWith("Z") ? "" : "Z"));
}

function ago(iso: string | null): string {
  if (!iso) return "never";
  const hours = (Date.now() - parseUtc(iso)) / 3_600_000;
  if (!Number.isFinite(hours)) return iso;
  if (hours < 1) return `${Math.max(0, Math.round(hours * 60))}m ago`;
  if (hours < 48) return `${Math.round(hours)}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function FreshnessBanner({
  odds,
  silver,
  silverFetchedAt,
  silverMethod,
  hasForwardData,
}: {
  odds: string | null;
  /** Silver's own vintage, not our fetch time — see dataFreshness(). */
  silver: string | null;
  silverFetchedAt: string | null;
  silverMethod: string | null;
  hasForwardData: boolean;
}) {
  /**
   * Relative times depend on Date.now(), which differs between the server
   * render and client hydration and so cannot match. Render nothing
   * time-dependent until after mount, then fill it in.
   */
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const oddsLabel = mounted ? ago(odds) : "…";
  const silverLabel = mounted ? ago(silver) : "…";
  const oddsStale =
    mounted && (!odds || Date.now() - parseUtc(odds) > 36 * 3_600_000);
  const silverStale =
    mounted && (!silver || Date.now() - parseUtc(silver) > 8 * 24 * 3_600_000);

  return (
    <div className="mt-4 space-y-2">
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-400">
        <span>
          Vegas:{" "}
          <span className={oddsStale ? "text-amber-400" : "text-slate-200"}>
            {oddsLabel}
          </span>
        </span>
        <span
          title={
            silverFetchedAt
              ? `ELWAY last recomputed ${silver ?? "unknown"}. ` +
                `We last fetched it ${silverFetchedAt}. Refreshing re-pulls the ` +
                `same sheet — it cannot make the forecast newer than Silver has ` +
                `published it.`
              : undefined
          }
        >
          Silver:{" "}
          <span className={silverStale ? "text-amber-400" : "text-slate-200"}>
            {silverLabel}
          </span>
          {silverMethod === "derived" && (
            <span className="ml-1 text-amber-400">(derived)</span>
          )}
        </span>
      </div>

      {!hasForwardData && (
        <div className="rounded-lg border border-amber-900/50 bg-amber-950/30 px-4 py-3 text-sm text-amber-200">
          <strong className="font-semibold">No forward-week data loaded.</strong>{" "}
          PickLater is 0 for every team, so Score collapses to this week&rsquo;s
          win probability and the opportunity-cost model is inactive. Load
          lookahead lines with{" "}
          <code className="rounded bg-amber-900/40 px-1">
            npm run ingest:odds:espn
          </code>
          .
        </div>
      )}
    </div>
  );
}
