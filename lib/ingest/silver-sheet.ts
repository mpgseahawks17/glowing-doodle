import { createHash } from "node:crypto";
import { parseCsv } from "./csv";
import { normalizeTeamAbbr } from "./team-map";

/**
 * ELWAY game projections, straight from Silver Bulletin's own data sheet.
 *
 * The ELWAY embeds on natesilver.net do not compute anything client-side --
 * they read public Google Sheets CSV exports. The sheet needs no auth, no
 * cookie and no subscription check, so once the ID is known this is an
 * ordinary HTTP fetch. The paywall only ever hid *which sheet to read*.
 *
 * Columns (verified 2026-09-14):
 *   week, home_sb_fran_id, pf_home, win_home, away_sb_fran_id, pf_away,
 *   win_away, point_spread, total, neutral, extra
 *
 * `win_home` / `win_away` are percentages and do NOT sum to 100 -- ELWAY is a
 * win/loss/tie model, and the remainder (0.26%-0.75% across the 2026 season) is
 * the tie probability. Never derive one side from the other.
 *
 * The `_embed_metadata` tab carries `updated_at` and `data_version`, which is
 * the data's real vintage. That matters: on 2026-09-14 the live sheet was still
 * stamped 2026-09-09 and had not priced week 1.
 */

export const ELWAY_SHEET_ID = "1z7qxd50OSzoaJrInv7xyVUGAu1f_hJmrg8YmNmfp4KU";

export function sheetCsvUrl(sheetId: string, tab: string): string {
  return (
    `https://docs.google.com/spreadsheets/d/${sheetId}` +
    `/gviz/tq?tqx=out:csv&headers=1&sheet=${encodeURIComponent(tab)}`
  );
}

export interface SheetGame {
  week: number;
  homeTeam: string;
  awayTeam: string;
  homeProb: number;
  awayProb: number;
  tieProb: number;
  homePoints: number | null;
  awayPoints: number | null;
  pointSpread: number | null;
  neutralSite: boolean;
}

export interface SheetMetadata {
  updatedAt: string | null;
  dataVersion: string | null;
}

/**
 * Fingerprint the parsed games so we can detect a recompute ourselves.
 *
 * We used to key change detection on the sheet's own `data_version`. That is
 * not safe: on 2026-09-16 every one of the 256 games carried different
 * probabilities from the run before, week 1 had been dropped, and the
 * `_embed_metadata` tab STILL reported `updated_at=2026-09-09` with an
 * unchanged `data_version`. Silver refreshes the Data tab without always
 * bumping the metadata tab, so trusting that field makes the ingest silently
 * skip real updates and report "unchanged" indefinitely.
 *
 * Hashing what we actually parsed cannot drift out of sync with what we store.
 * Sorted so row reordering alone does not read as a change.
 */
export function contentHash(games: SheetGame[]): string {
  const canonical = games
    .map((g) =>
      [
        g.week,
        g.awayTeam,
        g.homeTeam,
        g.homeProb.toPrecision(12),
        g.awayProb.toPrecision(12),
      ].join("|"),
    )
    .sort()
    .join("\n");
  return createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

/** Plausible bounds for the implied tie. Anything outside means bad parsing. */
const TIE_MIN = -0.005;
const TIE_MAX = 0.05;

function num(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed === "NA") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

export interface ParsedSheet {
  games: SheetGame[];
  errors: string[];
}

export function parseElwaySheet(csvText: string): ParsedSheet {
  const rows = parseCsv(csvText);
  const games: SheetGame[] = [];
  const errors: string[] = [];

  if (rows.length === 0) {
    return { games, errors: ["sheet returned no rows"] };
  }
  // Fail loudly if Silver renames a column rather than silently importing nulls.
  for (const required of ["week", "home_sb_fran_id", "win_home", "win_away"]) {
    if (!(required in rows[0]!)) {
      return {
        games,
        errors: [
          `sheet is missing the "${required}" column — the format changed. ` +
            `Columns seen: ${Object.keys(rows[0]!).join(", ")}`,
        ],
      };
    }
  }

  for (const [i, row] of rows.entries()) {
    const line = i + 2; // header is line 1
    const week = num(row.week);
    const home = row.home_sb_fran_id?.trim();
    const away = row.away_sb_fran_id?.trim();
    const winHome = num(row.win_home);
    const winAway = num(row.win_away);

    if (!week || !home || !away || winHome === null || winAway === null) {
      errors.push(`line ${line}: incomplete row`);
      continue;
    }
    if (week < 1 || week > 18) {
      errors.push(`line ${line}: week ${week} outside 1-18`);
      continue;
    }

    const homeProb = winHome / 100;
    const awayProb = winAway / 100;
    const tie = 1 - homeProb - awayProb;

    if (tie < TIE_MIN || tie > TIE_MAX) {
      errors.push(
        `line ${line}: ${away}@${home} week ${week} implies a ` +
          `${(tie * 100).toFixed(1)}% tie — probabilities look wrong`,
      );
      continue;
    }

    games.push({
      week,
      homeTeam: normalizeTeamAbbr(home),
      awayTeam: normalizeTeamAbbr(away),
      homeProb,
      awayProb,
      tieProb: Math.max(0, tie),
      homePoints: num(row.pf_home),
      awayPoints: num(row.pf_away),
      pointSpread: num(row.point_spread),
      neutralSite: row.neutral?.trim().toLowerCase() === "yes",
    });
  }

  return { games, errors };
}

export function parseSheetMetadata(csvText: string): SheetMetadata {
  const pairs = new Map(
    parseCsv(csvText).map((r) => [r.key?.trim(), r.value?.trim()]),
  );
  return {
    updatedAt: pairs.get("updated_at") ?? null,
    dataVersion: pairs.get("data_version") ?? null,
  };
}

export async function fetchElwaySheet(
  sheetId = ELWAY_SHEET_ID,
): Promise<{ games: SheetGame[]; errors: string[]; meta: SheetMetadata }> {
  const headers = {
    "user-agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  };

  const res = await fetch(sheetCsvUrl(sheetId, "Data"), { headers });
  const text = await res.text();
  if (!res.ok || text.trimStart().startsWith("<")) {
    throw new Error(
      `Sheet fetch failed (${res.status}). The sheet may have been ` +
        `unshared or its ID rotated. First 160 chars: ${text.slice(0, 160)}`,
    );
  }

  const { games, errors } = parseElwaySheet(text);

  let meta: SheetMetadata = { updatedAt: null, dataVersion: null };
  try {
    const m = await fetch(sheetCsvUrl(sheetId, "_embed_metadata"), { headers });
    if (m.ok) meta = parseSheetMetadata(await m.text());
  } catch {
    // Vintage is useful but not essential; never fail the ingest over it.
  }

  return { games, errors, meta };
}
