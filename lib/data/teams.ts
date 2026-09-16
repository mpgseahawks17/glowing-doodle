/**
 * The 32 NFL teams, keyed by the abbreviations nflverse uses in games.csv.
 *
 * Two of these differ from the codes most other sources use, and mixing them up
 * silently drops games from the grid:
 *   LA  = Los Angeles Rams     (not LAR)
 *   WAS = Washington Commanders (not WSH)
 * The Odds API returns full team names, so lib/ingest/team-map.ts maps into
 * these codes rather than the other way round.
 */
export interface TeamSeed {
  abbr: string;
  name: string;
  conference: "AFC" | "NFC";
  division: "East" | "North" | "South" | "West";
}

export const TEAMS: TeamSeed[] = [
  { abbr: "BUF", name: "Buffalo Bills", conference: "AFC", division: "East" },
  { abbr: "MIA", name: "Miami Dolphins", conference: "AFC", division: "East" },
  { abbr: "NE", name: "New England Patriots", conference: "AFC", division: "East" },
  { abbr: "NYJ", name: "New York Jets", conference: "AFC", division: "East" },

  { abbr: "BAL", name: "Baltimore Ravens", conference: "AFC", division: "North" },
  { abbr: "CIN", name: "Cincinnati Bengals", conference: "AFC", division: "North" },
  { abbr: "CLE", name: "Cleveland Browns", conference: "AFC", division: "North" },
  { abbr: "PIT", name: "Pittsburgh Steelers", conference: "AFC", division: "North" },

  { abbr: "HOU", name: "Houston Texans", conference: "AFC", division: "South" },
  { abbr: "IND", name: "Indianapolis Colts", conference: "AFC", division: "South" },
  { abbr: "JAX", name: "Jacksonville Jaguars", conference: "AFC", division: "South" },
  { abbr: "TEN", name: "Tennessee Titans", conference: "AFC", division: "South" },

  { abbr: "DEN", name: "Denver Broncos", conference: "AFC", division: "West" },
  { abbr: "KC", name: "Kansas City Chiefs", conference: "AFC", division: "West" },
  { abbr: "LAC", name: "Los Angeles Chargers", conference: "AFC", division: "West" },
  { abbr: "LV", name: "Las Vegas Raiders", conference: "AFC", division: "West" },

  { abbr: "DAL", name: "Dallas Cowboys", conference: "NFC", division: "East" },
  { abbr: "NYG", name: "New York Giants", conference: "NFC", division: "East" },
  { abbr: "PHI", name: "Philadelphia Eagles", conference: "NFC", division: "East" },
  { abbr: "WAS", name: "Washington Commanders", conference: "NFC", division: "East" },

  { abbr: "CHI", name: "Chicago Bears", conference: "NFC", division: "North" },
  { abbr: "DET", name: "Detroit Lions", conference: "NFC", division: "North" },
  { abbr: "GB", name: "Green Bay Packers", conference: "NFC", division: "North" },
  { abbr: "MIN", name: "Minnesota Vikings", conference: "NFC", division: "North" },

  { abbr: "ATL", name: "Atlanta Falcons", conference: "NFC", division: "South" },
  { abbr: "CAR", name: "Carolina Panthers", conference: "NFC", division: "South" },
  { abbr: "NO", name: "New Orleans Saints", conference: "NFC", division: "South" },
  { abbr: "TB", name: "Tampa Bay Buccaneers", conference: "NFC", division: "South" },

  { abbr: "ARI", name: "Arizona Cardinals", conference: "NFC", division: "West" },
  { abbr: "LA", name: "Los Angeles Rams", conference: "NFC", division: "West" },
  { abbr: "SEA", name: "Seattle Seahawks", conference: "NFC", division: "West" },
  { abbr: "SF", name: "San Francisco 49ers", conference: "NFC", division: "West" },
];

/** Full team name -> nflverse abbreviation, for sources that send names. */
export const NAME_TO_ABBR: Map<string, string> = new Map(
  TEAMS.map((t) => [t.name.toLowerCase(), t.abbr]),
);
