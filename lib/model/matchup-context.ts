/**
 * Situational context for a matchup: rest, timing, familiarity, and venue.
 *
 * These are the things people ask about a survivor pick that the probability
 * columns do not answer on their own. Books price all of them, so none of this
 * is an edge over the market -- it is an explanation of a number that already
 * reflects it. The badges exist so a surprising line ("why is SF only -3
 * here?") has a visible reason attached.
 *
 * All of it comes off the nflverse schedule, which we already ingest -- no new
 * source. The venue columns it reads are populated by ingest-schedule.
 */

/** Day-of-week codes as `Date.getDay()` reports them. */
const WED = 3;
const THU = 4;
const FRI = 5;
const SAT = 6;

export type ShortWeekDay = "WED" | "THU" | "FRI" | "SAT";

export interface ForeignVenue {
  /** Three-letter badge label. Stated explicitly rather than sliced off the
   * city, so "Rio de Janeiro" and "Mexico City" get a deliberate code. */
  code: string;
  city: string;
  country: string;
}

/**
 * nflverse venue codes for games played outside the United States.
 *
 * An explicit allowlist, because neither of the two obvious shortcuts works:
 *
 *   - `location === "Neutral"` is far broader than "abroad". Every Super Bowl
 *     is neutral, and so is a hurricane or fire relocation -- 2025 alone put
 *     neutral-site games at Cleveland and Pittsburgh.
 *   - The code is not a team prefix. Rogers Centre, where Buffalo played its
 *     Toronto series, is "BUF01" -- in Canada, under a Buffalo code.
 *
 * So the codes are listed one by one, taken from the venues nflverse has
 * actually used. An unrecognised venue is deliberately NOT flagged: a missing
 * badge is a smaller error than telling someone the Super Bowl is abroad. Add
 * new codes here as the league announces them.
 */
export const FOREIGN_VENUES: Record<string, ForeignVenue> = {
  LON00: { code: "LON", city: "London", country: "United Kingdom" }, // Wembley
  LON01: { code: "LON", city: "London", country: "United Kingdom" }, // Twickenham
  LON02: { code: "LON", city: "London", country: "United Kingdom" }, // Tottenham
  BUF01: { code: "TOR", city: "Toronto", country: "Canada" }, // Rogers Centre
  MEX00: { code: "MEX", city: "Mexico City", country: "Mexico" }, // Azteca / Banorte
  FRA00: { code: "FRA", city: "Frankfurt", country: "Germany" }, // Deutsche Bank Park
  GER00: { code: "MUN", city: "Munich", country: "Germany" }, // Allianz Arena
  MUN01: { code: "MUN", city: "Munich", country: "Germany" }, // FC Bayern Munich
  MAD01: { code: "MAD", city: "Madrid", country: "Spain" }, // Bernabeu
  PAR00: { code: "PAR", city: "Paris", country: "France" }, // Stade de France
  SAO00: { code: "SAO", city: "Sao Paulo", country: "Brazil" }, // Arena Corinthians
  RIO00: { code: "RIO", city: "Rio de Janeiro", country: "Brazil" }, // Maracana
  MEL00: { code: "MEL", city: "Melbourne", country: "Australia" }, // Melbourne Cricket Ground
  DUB00: { code: "DUB", city: "Dublin", country: "Ireland" }, // Croke Park
};

/** The venue if this game is played abroad, else null. */
export function foreignVenue(
  stadiumId: string | null | undefined,
): ForeignVenue | null {
  if (!stadiumId) return null;
  return FOREIGN_VENUES[stadiumId.trim().toUpperCase()] ?? null;
}

export interface MatchupContext {
  /** This team had no game the previous week. */
  offBye: boolean;
  /** The opponent had no game the previous week -- rested, and not in our favour. */
  oppOffBye: boolean;
  /** Kickoff falls before Sunday, so both sides are on short rest. */
  shortWeek: ShortWeekDay | null;
  /** Both teams share a conference AND a division. */
  divisional: boolean;
  /**
   * Set when the game is played outside the US. Worth surfacing because the
   * listed home team is not actually at home, and both sides travelled.
   */
  foreign: ForeignVenue | null;
}

export const NO_CONTEXT: MatchupContext = {
  offBye: false,
  oppOffBye: false,
  shortWeek: null,
  divisional: false,
  foreign: null,
};

/**
 * Read the calendar day out of a stored kickoff.
 *
 * The column is named `kickoff_utc` but the ingest writes US Eastern wall time
 * (verified against the 2026 schedule: Sunday early games land at 13:00, TNF at
 * 20:15, the London games at 09:30 -- all Eastern, none of them UTC). Parsing
 * with `new Date()` would apply the viewer's timezone to an already-local
 * string and roll Thursday-night games back to Thursday afternoon or forward
 * into Friday depending on where the browser sits.
 *
 * So read the date fields textually and build the date in UTC, which makes the
 * day-of-week a pure function of the characters in the string. The goal is only
 * "which day of the week is printed here", and that never needs a timezone.
 */
export function kickoffDay(kickoff: string | null | undefined): number | null {
  if (!kickoff) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(kickoff);
  if (!m) return null;
  const [, y, mo, d] = m;
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  return Number.isNaN(date.getTime()) ? null : date.getUTCDay();
}

/**
 * Sunday and Monday are the normal rhythm. Anything earlier in the week means
 * at least one side is playing on fewer than six days' rest.
 *
 * Saturday is included: those are December games on a six-day turnaround, which
 * is short by the same logic, just less dramatically so than Thursday.
 */
export function shortWeekLabel(
  kickoff: string | null | undefined,
): ShortWeekDay | null {
  switch (kickoffDay(kickoff)) {
    case WED:
      return "WED";
    case THU:
      return "THU";
    case FRI:
      return "FRI";
    case SAT:
      return "SAT";
    default:
      return null;
  }
}

/**
 * Same division, which in the NFL means same conference too.
 *
 * Conference is checked explicitly rather than trusting the division label,
 * because "East" names two different divisions (AFC East and NFC East) and
 * comparing the label alone would call BUF-DAL a divisional game.
 */
export function isDivisional(
  a: { conference: string; division: string } | undefined,
  b: { conference: string; division: string } | undefined,
): boolean {
  if (!a || !b) return false;
  return a.conference === b.conference && a.division === b.division;
}

/**
 * Teams with no game in `week`, i.e. on bye that week.
 *
 * Week 0 has no predecessor and the regular season opens with everyone
 * playing, so an empty set is the right answer rather than "all 32 teams".
 */
export function byeTeams(
  playedByWeek: Map<number, Set<string>>,
  week: number,
  allTeams: Iterable<string>,
): Set<string> {
  const out = new Set<string>();
  if (week < 1) return out;
  const played = playedByWeek.get(week);
  // A week we have no schedule rows for is unknown, not a league-wide bye.
  if (!played || played.size === 0) return out;
  for (const t of allTeams) if (!played.has(t)) out.add(t);
  return out;
}
