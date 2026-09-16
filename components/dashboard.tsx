"use client";

import { useMemo, useState } from "react";
import { scoreTeams } from "@/lib/model/engine";
import { DEFAULT_CONFIG, type ModelConfig } from "@/lib/model/types";
import {
  deserializeMatrix,
  type SerializedMatchups,
  type SerializedMatrix,
} from "@/lib/model/serialize";
import { ScorecardTable } from "./scorecard-table";
import { ScheduleGrid } from "./schedule-grid";
import { PicksPanel } from "./picks-panel";
import { PlanTable } from "./plan-table";
import { SourcesTable } from "./sources-table";
import { SettingsBar } from "./settings-bar";
import { FreshnessBanner } from "./freshness-banner";
import type { SourceSummary } from "@/lib/db/repo/sources";

export interface UsedPick {
  week: number;
  team: string;
  result: string | null;
}

interface Props {
  season: number;
  currentWeek: number;
  matrix: SerializedMatrix;
  matchups: Record<string, SerializedMatchups>;
  available: string[];
  used: UsedPick[];
  allTeams: string[];
  sources: SourceSummary;
  freshness: {
    odds: string | null;
    silver: string | null;
    silverFetchedAt: string | null;
    silverMethod: string | null;
  };
  initialConfig: { lambda: number; wVegas: number; wSilver: number; horizon: number };
}

type Tab = "scorecard" | "plan" | "grid" | "sources" | "picks";

export function Dashboard(props: Props) {
  const [tab, setTab] = useState<Tab>("scorecard");
  const [lambda, setLambda] = useState(props.initialConfig.lambda);
  const [wVegas, setWVegas] = useState(props.initialConfig.wVegas);
  const [horizon, setHorizon] = useState(props.initialConfig.horizon);
  const [week, setWeek] = useState(props.currentWeek);

  // Rehydrate once; the raw object never changes after the server render.
  const matrix = useMemo(() => deserializeMatrix(props.matrix), [props.matrix]);

  const config: ModelConfig = useMemo(
    () => ({
      ...DEFAULT_CONFIG,
      lambda,
      horizon,
      weights: { vegas: wVegas, silver: 1 - wVegas },
    }),
    [lambda, horizon, wVegas],
  );

  const weekMatchups = useMemo(
    () => new Map(Object.entries(props.matchups[String(week)] ?? {})),
    [props.matchups, week],
  );

  // The whole point of shipping the matrix to the browser: this is a pure
  // function over data we already hold, so dragging lambda re-ranks instantly.
  const rows = useMemo(
    () => scoreTeams(matrix, week, props.available, weekMatchups, config),
    [matrix, week, props.available, weekMatchups, config],
  );

  /**
   * Weeks the plan covers: the selected week plus `horizon` weeks of lookahead,
   * capped by however far the data actually reaches. The Horizon control drives
   * both the Scorecard's PickLater and the Plan, so the two views always reason
   * over the same window.
   *
   * ESPN publishes roughly 8 weeks out, so at horizon 9 the plan is bounded by
   * available data rather than by the setting, and it shrinks naturally as the
   * season ends.
   */
  const planWeeks = useMemo(() => {
    const weeks: number[] = [];
    const lastWeek = Math.min(18, week + horizon);
    // Starts from the selected week, not necessarily the current one, so you
    // can look at what the rest of the season looks like from any point.
    for (let w = week; w <= lastWeek; w++) {
      const teams = matrix.get(w);
      if (!teams) break;
      const hasData = [...teams.values()].some(
        (i) => i.vegas !== undefined || i.silver !== undefined,
      );
      if (!hasData) break;
      weeks.push(w);
    }
    return weeks;
  }, [matrix, week, horizon]);

  const hasForwardData = useMemo(() => {
    for (let w = week + 1; w <= week + horizon; w++) {
      for (const inputs of matrix.get(w)?.values() ?? []) {
        if (inputs.silver !== undefined || inputs.vegas !== undefined) return true;
      }
    }
    return false;
  }, [matrix, week, horizon]);

  return (
    <main className="mx-auto max-w-[1600px] px-6 py-6">
      <header className="mb-5 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">NFL Survivor</h1>
          <p className="text-sm text-slate-400">
            Season {props.season} &middot; {props.available.length} teams available
            &middot; {3 - props.used.filter((u) => u.result === "loss").length} lives
          </p>
        </div>
        <nav className="flex gap-1 rounded-lg bg-slate-900 p-1">
          {(["scorecard", "plan", "grid", "sources", "picks"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-md px-3 py-1.5 text-sm capitalize transition ${
                tab === t
                  ? "bg-slate-700 text-white"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              {t}
            </button>
          ))}
        </nav>
      </header>

      <FreshnessBanner {...props.freshness} hasForwardData={hasForwardData} />

      <SettingsBar
        lambda={lambda}
        onLambda={setLambda}
        wVegas={wVegas}
        onWVegas={setWVegas}
        horizon={horizon}
        onHorizon={setHorizon}
        week={week}
        onWeek={setWeek}
        currentWeek={props.currentWeek}
      />

      <div className="mt-5">
        {tab === "scorecard" && (
          <ScorecardTable rows={rows} week={week} horizon={horizon} />
        )}
        {tab === "plan" && (
          <PlanTable
            matrix={matrix}
            matchups={props.matchups}
            available={props.available}
            weeks={planWeeks}
            config={config}
          />
        )}
        {tab === "grid" && (
          <ScheduleGrid
            matrix={matrix}
            matchups={props.matchups}
            allTeams={props.allTeams}
            available={new Set(props.available)}
            currentWeek={week}
            horizon={horizon}
            weights={config.weights}
          />
        )}
        {tab === "sources" && (
          <SourcesTable
            summary={props.sources}
            currentWeek={props.currentWeek}
          />
        )}
        {tab === "picks" && (
          <PicksPanel
            season={props.season}
            used={props.used}
            available={props.available}
            currentWeek={props.currentWeek}
          />
        )}
      </div>
    </main>
  );
}
