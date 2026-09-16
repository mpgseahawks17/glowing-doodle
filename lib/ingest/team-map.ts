import { NAME_TO_ABBR } from "@/lib/data/teams";

/**
 * The Odds API identifies teams by full name ("Buffalo Bills"). Map those onto
 * the nflverse abbreviations the schedule uses. Aliases cover relocations and
 * naming changes that still surface in some feeds.
 */
const ALIASES: Record<string, string> = {
  "washington football team": "WAS",
  "washington redskins": "WAS",
  "oakland raiders": "LV",
  "san diego chargers": "LAC",
  "st. louis rams": "LA",
  "st louis rams": "LA",
  "los angeles rams": "LA",
};

export function toAbbr(teamName: string): string | null {
  const key = teamName.trim().toLowerCase();
  return NAME_TO_ABBR.get(key) ?? ALIASES[key] ?? null;
}

/**
 * Third-party abbreviation -> nflverse abbreviation.
 *
 * Verified across all 32 teams for both feeds: ESPN differs from nflverse on
 * exactly two codes (LAR, WSH), and Silver's `sb_fran_id` differs on one (LAR).
 * Getting these wrong silently drops the Rams and Washington from the grid, so
 * both ingests normalise through here rather than trusting raw codes.
 */
const ABBR_ALIASES: Record<string, string> = {
  LAR: "LA",
  WSH: "WAS",
};

export function normalizeTeamAbbr(abbr: string): string {
  const upper = abbr.trim().toUpperCase();
  return ABBR_ALIASES[upper] ?? upper;
}

/** @deprecated use normalizeTeamAbbr -- kept so the ESPN ingest reads clearly. */
export const fromEspnAbbr = normalizeTeamAbbr;

/** Throwing variant -- ingest should fail loudly rather than drop a game. */
export function requireAbbr(teamName: string): string {
  const abbr = toAbbr(teamName);
  if (!abbr) {
    throw new Error(
      `Unrecognised team name from feed: "${teamName}". ` +
        `Add it to ALIASES in lib/ingest/team-map.ts.`,
    );
  }
  return abbr;
}
