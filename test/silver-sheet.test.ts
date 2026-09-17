import { describe, expect, it } from "vitest";
import {
  contentHash,
  parseElwaySheet,
  parseSheetMetadata,
  sheetCsvUrl,
} from "@/lib/ingest/silver-sheet";

/** Real rows copied verbatim from the live sheet on 2026-09-14. */
const HEADER =
  '"week","home_sb_fran_id","pf_home","win_home","away_sb_fran_id","pf_away","win_away","point_spread","total","neutral","extra",""';
const ROWS = [
  '"1","SEA","24.4055","69.93","NE","17.9756","29.61","-6","42","No","0",""',
  '"1","LAR","25.4874","57.615","SF","22.8378","41.76","-3","48","Yes","0",""',
  '"1","CAR","21.00105","40.86","CHI","23.81695","58.595","3","44","No","0",""',
];
const sheet = (...rows: string[]) => [HEADER, ...rows].join("\n");

describe("parseElwaySheet", () => {
  it("parses real rows into probabilities", () => {
    const { games, errors } = parseElwaySheet(sheet(...ROWS));
    expect(errors).toEqual([]);
    expect(games).toHaveLength(3);

    const [sea] = games;
    expect(sea!.week).toBe(1);
    expect(sea!.homeTeam).toBe("SEA");
    expect(sea!.awayTeam).toBe("NE");
    expect(sea!.homeProb).toBeCloseTo(0.6993, 6);
    expect(sea!.awayProb).toBeCloseTo(0.2961, 6);
  });

  it("maps LAR to the nflverse code LA", () => {
    // The one code that differs. Getting it wrong silently drops the Rams.
    const { games } = parseElwaySheet(sheet(ROWS[1]!));
    expect(games[0]!.homeTeam).toBe("LA");
  });

  it("keeps the tie probability instead of forcing the pair to 1", () => {
    // ELWAY is win/loss/tie: 69.93 + 29.61 = 99.54, so a 0.46% tie.
    const { games } = parseElwaySheet(sheet(ROWS[0]!));
    const g = games[0]!;
    expect(g.tieProb).toBeCloseTo(0.0046, 6);
    expect(g.homeProb + g.awayProb + g.tieProb).toBeCloseTo(1, 10);
  });

  it("records neutral-site games", () => {
    const { games } = parseElwaySheet(sheet(ROWS[0]!, ROWS[1]!));
    expect(games[0]!.neutralSite).toBe(false);
    expect(games[1]!.neutralSite).toBe(true);
  });

  it("carries projected points and spread through", () => {
    const { games } = parseElwaySheet(sheet(ROWS[0]!));
    expect(games[0]!.homePoints).toBeCloseTo(24.4055, 4);
    expect(games[0]!.pointSpread).toBe(-6);
  });

  it("rejects a pair implying an impossible tie", () => {
    const bad = '"1","SEA","24","80","NE","18","80","-6","42","No","0",""';
    const { games, errors } = parseElwaySheet(sheet(bad));
    expect(games).toHaveLength(0);
    expect(errors[0]).toMatch(/tie/);
  });

  it("fails loudly if Silver renames a column", () => {
    // Silently importing nulls would poison the model; this must abort.
    const renamed = '"week","home_team","pf_home","home_win_pct"\n"1","SEA","24","70"';
    const { games, errors } = parseElwaySheet(renamed);
    expect(games).toHaveLength(0);
    expect(errors[0]).toMatch(/missing the "home_sb_fran_id" column/);
  });

  it("skips incomplete rows without aborting the rest", () => {
    const partial = '"2","","","","","","","","","",""';
    const { games, errors } = parseElwaySheet(sheet(partial, ROWS[0]!));
    expect(games).toHaveLength(1);
    expect(errors).toHaveLength(1);
  });

  it("rejects a week outside 1-18", () => {
    const bad = '"22","SEA","24","70","NE","18","29","-6","42","No","0",""';
    const { errors } = parseElwaySheet(sheet(bad));
    expect(errors[0]).toMatch(/outside 1-18/);
  });
});

describe("parseSheetMetadata", () => {
  it("reads the source vintage", () => {
    const csv =
      '"key","value"\n"updated_at","2026-09-09T14:51:47.476Z"\n"data_version","forecasts-v1-16649-8e7e4e3f"';
    expect(parseSheetMetadata(csv)).toEqual({
      updatedAt: "2026-09-09T14:51:47.476Z",
      dataVersion: "forecasts-v1-16649-8e7e4e3f",
    });
  });

  it("returns nulls rather than throwing on an empty tab", () => {
    expect(parseSheetMetadata('"key","value"')).toEqual({
      updatedAt: null,
      dataVersion: null,
    });
  });
});

describe("sheetCsvUrl", () => {
  it("builds a gviz CSV export url", () => {
    expect(sheetCsvUrl("ABC123", "Data")).toBe(
      "https://docs.google.com/spreadsheets/d/ABC123/gviz/tq?tqx=out:csv&headers=1&sheet=Data",
    );
  });

  it("encodes tab names", () => {
    expect(sheetCsvUrl("ABC123", "_embed_metadata")).toContain(
      "sheet=_embed_metadata",
    );
  });
});

/**
 * Change detection. These guard the 2026-09-16 failure: the sheet's Data tab
 * was rewritten -- all 256 games moved, week 1 dropped -- while its
 * `_embed_metadata` tab still reported the previous `updated_at` and
 * `data_version`. Keying on the source's field made the ingest report
 * "Unchanged" across a week of real updates, so the fingerprint must come from
 * the parsed numbers and nothing else.
 */
describe("contentHash", () => {
  const games = (csv: string) => parseElwaySheet(csv).games;

  it("is stable across repeated parses of identical input", () => {
    expect(contentHash(games(sheet(...ROWS)))).toBe(
      contentHash(games(sheet(...ROWS))),
    );
  });

  it("ignores row order", () => {
    const forward = contentHash(games(sheet(...ROWS)));
    const reversed = contentHash(games(sheet(...[...ROWS].reverse())));
    expect(reversed).toBe(forward);
  });

  it("changes when a single probability moves", () => {
    const nudged = ROWS.map((r) => r.replace('"69.93"', '"69.94"'));
    expect(contentHash(games(sheet(...nudged)))).not.toBe(
      contentHash(games(sheet(...ROWS))),
    );
  });

  it("changes when a week is dropped", () => {
    expect(contentHash(games(sheet(ROWS[0]!, ROWS[1]!)))).not.toBe(
      contentHash(games(sheet(...ROWS))),
    );
  });

  it("does not depend on the source's own metadata", () => {
    // The whole point: identical numbers hash the same no matter what the
    // sheet claims about itself, and different numbers differ even when the
    // sheet claims nothing changed.
    const stale = parseSheetMetadata('key,value\nupdated_at,2026-09-09\n');
    const fresh = parseSheetMetadata('key,value\nupdated_at,2026-09-16\n');
    expect(stale.updatedAt).not.toBe(fresh.updatedAt);
    expect(contentHash(games(sheet(...ROWS)))).toBe(
      contentHash(games(sheet(...ROWS))),
    );
  });
});
