"use client";

import type { Recommendation, ScoredTeam } from "@/lib/model/types";

const REC_STYLES: Record<Recommendation, string> = {
  "TOP PICK": "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
  STRONG: "bg-sky-500/10 text-sky-300 ring-sky-500/25",
  SAVE: "bg-amber-500/10 text-amber-300 ring-amber-500/25",
  AVAILABLE: "bg-slate-700/30 text-slate-400 ring-slate-600/30",
};

/** Red at 30%, amber mid, green at 85% -- matches the grid's scale. */
export function probColor(p: number): string {
  const clamped = Math.max(0.3, Math.min(0.85, p));
  const t = (clamped - 0.3) / 0.55;
  const hue = t * 130; // 0 = red, 130 = green
  return `hsl(${hue} 65% ${18 + t * 12}%)`;
}

const pct = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(1)}%`);
const signed = (v: number | null) =>
  v === null ? "—" : `${v >= 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(1)}`;

/**
 * The team a row is actually being measured against.
 *
 * PickNow compares each team to the best OTHER available team, so for everyone
 * except the leader that is the top row -- and for the leader it is the runner
 * up. Naming it turns an abstract number into a concrete sentence.
 */
function rivalFor(row: ScoredTeam, rows: ScoredTeam[]): string | undefined {
  const ranked = rows.filter((r) => r.score !== null);
  if (ranked.length < 2) return undefined;
  const leader = ranked[0]!;
  return row.team === leader.team ? ranked[1]!.team : leader.team;
}

function pickNowHint(row: ScoredTeam, rows: ScoredTeam[]): string {
  if (row.pickNow === null) {
    return "No probability for this team this week — on a bye, or no data.";
  }
  const rival = rivalFor(row, rows);
  const points = Math.abs(row.pickNow * 100).toFixed(1);
  if (!rival) return "No alternative available to compare against.";

  return row.pickNow >= 0
    ? `${row.team} is the best pick available this week — ${points} points ` +
        `better than ${rival}, the next best.`
    : `Taking ${row.team} instead of ${rival} costs ${points} points of win ` +
        `probability this week.`;
}

function pickLaterHint(
  row: ScoredTeam,
  week: number,
  horizon: number,
): string {
  if (row.pickLater <= 0 || row.pickLaterWeek === null) {
    return (
      `${row.team} is never the best team available in weeks ` +
      `${week + 1}–${week + horizon}, so using it now costs you nothing later.`
    );
  }
  const points = (row.pickLater * 100).toFixed(1);
  return (
    `In week ${row.pickLaterWeek}, ${row.team} is ${points} points better than ` +
    `anything else you would still hold. Spending it now forfeits about that ` +
    `much — which is why Score drops it ${points} points.`
  );
}

function scoreHint(row: ScoredTeam): string {
  if (row.score === null || row.blendedProb === null) {
    return "Not pickable this week.";
  }
  const blend = (row.blendedProb * 100).toFixed(1);
  if (row.pickLater <= 0) {
    return `${blend} this week, with nothing given up later — Score = ${blend}.`;
  }
  const later = (row.pickLater * 100).toFixed(1);
  const score = (row.score * 100).toFixed(1);
  return (
    `${blend} this week, minus ${later} for what ${row.team} is worth in ` +
    `week ${row.pickLaterWeek} = ${score}.`
  );
}

export function ScorecardTable({
  rows,
  week,
  horizon,
}: {
  rows: ScoredTeam[];
  week: number;
  horizon: number;
}) {
  return (
    <div className="overflow-x-auto rounded-lg ring-1 ring-slate-800">
      <table className="w-full min-w-[900px] border-collapse text-sm nums">
        <thead>
          <tr className="bg-slate-900/80 text-left text-xs uppercase tracking-wide text-slate-400">
            <th className="px-3 py-2.5 font-medium">#</th>
            <th className="px-3 py-2.5 font-medium">Team</th>
            <th className="px-3 py-2.5 font-medium">Matchup</th>
            <th className="px-3 py-2.5 text-right font-medium">Vegas</th>
            <th className="px-3 py-2.5 text-right font-medium">Silver</th>
            <th
              className="px-3 py-2.5 text-right font-medium"
              title="Silver minus Vegas. Positive = Silver rates this team above the market."
            >
              Diff
            </th>
            <th
              className="px-3 py-2.5 text-right font-medium"
              title={
                "Blended win probability — the Vegas and Silver numbers combined " +
                "at the weight set by the slider.\n\n" +
                "If only one source covers a game, that source is used alone rather " +
                "than being halved."
              }
            >
              Blend
            </th>
            <th
              className="px-3 py-2.5 text-right font-medium"
              title={
                "PICKNOW — what this team is worth THIS week.\n\n" +
                "This team's win probability minus the best OTHER available team's.\n\n" +
                "Positive = it is the best pick on the board (only one team can be).\n" +
                "Negative = the cost of taking it anyway. −5.8 means you give up\n" +
                "5.8 points of win probability versus the best option.\n\n" +
                "Near zero across the top rows means the leaders are interchangeable\n" +
                "this week, so other factors (chalk, saving a team) can decide."
              }
            >
              PickNow
            </th>
            <th
              className="px-3 py-2.5 text-right font-medium"
              title={
                "PICKLATER — what you give up by spending this team now.\n\n" +
                `The biggest edge it has over your next-best option in weeks ` +
                `${week + 1}–${week + horizon}, and the week that peak falls.\n\n` +
                "0 (—) = it is never the best available in that window, so using it\n" +
                "now costs you nothing later. Most teams sit here.\n\n" +
                "6.0 (w3) = in week 3 it is 6 points better than anything else you\n" +
                "would still hold. Spend it now and you forfeit roughly that much.\n\n" +
                "This is what demotes a strong team to SAVE: Score subtracts\n" +
                "λ × PickLater, so a big future edge outweighs a small edge now."
              }
            >
              PickLater
            </th>
            <th
              className="px-3 py-2.5 text-right font-medium"
              title={
                "SCORE = Blend − λ × PickLater. The ranking column.\n\n" +
                "It trades this week's win probability against what the team is\n" +
                "worth later. At λ=0 it collapses to the raw Blend; higher λ defers\n" +
                "teams with strong future spots more aggressively.\n\n" +
                "This is a single-week view: it assumes no picks between now and\n" +
                "the week shown. The Plan tab enforces one-team-per-season properly."
              }
            >
              Score
            </th>
            <th className="px-3 py-2.5 font-medium">Rec</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.team}
              className="border-t border-slate-800/70 hover:bg-slate-800/30"
            >
              <td className="px-3 py-2 text-slate-500">{r.rank || "—"}</td>
              <td className="px-3 py-2 font-semibold">{r.team}</td>
              <td className="px-3 py-2 text-slate-400">
                {r.opponent === null ? (
                  <span className="text-slate-600">BYE</span>
                ) : (
                  <>
                    <span className="text-slate-500">{r.isHome ? "vs" : "@"}</span>{" "}
                    {r.opponent}
                  </>
                )}
              </td>
              <td
                className="px-3 py-2 text-right text-slate-300"
                title={
                  r.vegasSource
                    ? `${r.vegasSource} — ${r.vegasBooks ?? "?"} book${r.vegasBooks === 1 ? "" : "s"}`
                    : undefined
                }
              >
                {pct(r.vegasProb)}
                {r.vegasBooks === 1 && r.vegasProb !== null && (
                  <span
                    className="ml-1 text-slate-600"
                    title={`Single book (${r.vegasSource}), not a median`}
                  >
                    &deg;
                  </span>
                )}
              </td>
              <td className="px-3 py-2 text-right text-slate-300">
                {pct(r.silverProb)}
                {r.silverIsDerived && (
                  <span className="ml-1 text-amber-500" title="Derived, not real Silver data">
                    ~
                  </span>
                )}
              </td>
              <td
                className={`px-3 py-2 text-right font-medium ${
                  r.sourceDelta === null
                    ? "text-slate-600"
                    : r.discrepancy
                      ? r.sourceDelta > 0
                        ? "text-emerald-400"
                        : "text-red-400"
                      : "text-slate-500"
                }`}
                title={
                  r.sourceDelta === null
                    ? "Needs both a Vegas and a Silver number"
                    : `Silver ${r.sourceDelta > 0 ? "above" : "below"} market by ${Math.abs(r.sourceDelta * 100).toFixed(1)} points`
                }
              >
                {r.sourceDelta === null ? (
                  "—"
                ) : (
                  <>
                    {r.sourceDelta >= 0 ? "+" : "−"}
                    {Math.abs(r.sourceDelta * 100).toFixed(1)}
                    {r.discrepancy && <span className="ml-1">!</span>}
                  </>
                )}
              </td>
              <td
                className="px-3 py-2 text-right font-medium"
                style={
                  r.blendedProb === null
                    ? undefined
                    : { background: probColor(r.blendedProb) }
                }
              >
                {pct(r.blendedProb)}
              </td>
              <td
                className="px-3 py-2 text-right text-slate-400"
                title={pickNowHint(r, rows)}
              >
                {signed(r.pickNow)}
              </td>
              <td
                className="px-3 py-2 text-right"
                title={pickLaterHint(r, week, horizon)}
              >
                {r.pickLater > 0 && r.pickLaterWeek !== null ? (
                  <span className="text-amber-300">
                    {(r.pickLater * 100).toFixed(1)}
                    <span className="ml-1 text-xs text-slate-500">
                      w{r.pickLaterWeek}
                    </span>
                  </span>
                ) : (
                  <span className="text-slate-600">—</span>
                )}
              </td>
              <td
                className="px-3 py-2 text-right font-semibold"
                title={scoreHint(r)}
              >
                {r.score === null ? "—" : (r.score * 100).toFixed(1)}
              </td>
              <td className="px-3 py-2">
                <span
                  className={`rounded px-2 py-0.5 text-[11px] font-medium ring-1 ${
                    REC_STYLES[r.recommendation]
                  }`}
                >
                  {r.recommendation}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="border-t border-slate-800/70 px-3 py-2 text-xs text-slate-500">
        Hover any column header for what it measures, or a{" "}
        <span className="text-slate-400">PickNow</span> /{" "}
        <span className="text-slate-400">PickLater</span> /{" "}
        <span className="text-slate-400">Score</span> value for what it means
        for that team.
      </p>
    </div>
  );
}
