import type { MatchupContext } from "@/lib/model/matchup-context";

/**
 * Situational badges that sit next to a matchup.
 *
 * Deliberately muted. These are context, not recommendations -- the colour
 * budget on this table belongs to the probability columns and the REC pill, and
 * a row with all three badges lit should not out-shout a TOP PICK. So they use
 * the same ring-on-tint shape as the REC pill at a fraction of its saturation.
 *
 * Every badge carries a `title`, because an abbreviation the reader has to
 * decode is worse than no badge at all.
 */

const BADGE =
  "inline-flex items-center rounded px-1 py-px text-[10px] font-medium leading-none ring-1 ring-inset";

/**
 * Rest is stated from the perspective of the team in the row, so the two rest
 * badges have to be visually distinct: one is in your favour, the other is
 * against you. Slate for "the opponent is rested" keeps it informational
 * rather than alarming -- it is a nudge, not a veto.
 *
 * They say RESTED rather than BYE on purpose. This column already prints a
 * bare "BYE" for a team with no game this week, and reusing the word for
 * "played last week after a bye" would put two opposite meanings on the same
 * label in the same column.
 */
const STYLES = {
  offBye: "bg-emerald-500/10 text-emerald-300/90 ring-emerald-500/25",
  oppOffBye: "bg-slate-600/25 text-slate-400 ring-slate-500/30",
  short: "bg-violet-500/10 text-violet-300/90 ring-violet-500/25",
  div: "bg-orange-500/10 text-orange-300/90 ring-orange-500/25",
  foreign: "bg-cyan-500/10 text-cyan-300/90 ring-cyan-500/25",
};

export function MatchupBadges({
  context,
  opponent,
}: {
  context: MatchupContext | null | undefined;
  /** Named in the tooltip so "opponent rested" says who. */
  opponent?: string | null;
}) {
  if (!context) return null;
  const { offBye, oppOffBye, shortWeek, divisional, foreign } = context;
  if (!offBye && !oppOffBye && !shortWeek && !divisional && !foreign) return null;

  return (
    <span className="ml-1.5 inline-flex gap-1 align-middle">
      {offBye && (
        <span
          className={`${BADGE} ${STYLES.offBye}`}
          title="Coming off a bye last week — extra rest and prep time, in this team's favour."
        >
          RESTED
        </span>
      )}
      {oppOffBye && (
        <span
          className={`${BADGE} ${STYLES.oppOffBye}`}
          title={`${opponent ?? "The opponent"} is coming off a bye last week — rested, which cuts against this pick.`}
        >
          OPP RESTED
        </span>
      )}
      {shortWeek && (
        <span
          className={`${BADGE} ${STYLES.short}`}
          title={`${shortWeek} kickoff — short week, both sides on reduced rest.`}
        >
          {shortWeek}
        </span>
      )}
      {divisional && (
        <span
          className={`${BADGE} ${STYLES.div}`}
          title="Divisional game — familiar opponent, historically tighter than the line suggests."
        >
          DIV
        </span>
      )}
      {foreign && (
        <span
          className={`${BADGE} ${STYLES.foreign}`}
          title={`International game — ${foreign.city}, ${foreign.country}. A neutral site, so the listed home team has no home-field advantage and both sides travelled.`}
        >
          {foreign.code}
        </span>
      )}
    </span>
  );
}

/**
 * Footnote legend. The badges carry tooltips, but tooltips are invisible until
 * hovered and do not exist on touch -- so the meanings are also stated once in
 * plain text under the table.
 */
export function BadgeLegend() {
  return (
    <p className="border-t border-slate-800/70 px-3 py-2 text-xs text-slate-500">
      <span className={`${BADGE} ${STYLES.offBye}`}>RESTED</span> off a bye last
      week ·{" "}
      <span className={`${BADGE} ${STYLES.oppOffBye}`}>OPP RESTED</span> the
      opponent is ·{" "}
      <span className={`${BADGE} ${STYLES.short}`}>THU</span> short week
      (Wed/Thu/Fri/Sat kickoff) ·{" "}
      <span className={`${BADGE} ${STYLES.div}`}>DIV</span> divisional game ·{" "}
      <span className={`${BADGE} ${STYLES.foreign}`}>LON</span> played abroad
      (neither team at home). These are context for a surprising line, not edges
      — the market prices all of them already.
    </p>
  );
}
