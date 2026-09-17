import { describe, expect, it } from "vitest";
import {
  byeTeams,
  foreignVenue,
  isDivisional,
  kickoffDay,
  shortWeekLabel,
} from "@/lib/model/matchup-context";

/**
 * Kickoff strings are real rows from the 2026 schedule. The column is named
 * `kickoff_utc` but holds Eastern wall time, which is the whole reason these
 * tests exist -- see the note on `kickoffDay`.
 */
describe("kickoffDay", () => {
  it("reads the printed calendar day, not a timezone-shifted one", () => {
    // 2026-09-17 is a Thursday. TNF at 20:15 Eastern.
    expect(kickoffDay("2026-09-17T20:15:00")).toBe(4);
    // 2026-09-20 is a Sunday, the 13:00 early window.
    expect(kickoffDay("2026-09-20T13:00:00")).toBe(0);
  });

  it("does not roll a late kickoff into the next day", () => {
    /**
     * The regression this guards. `new Date("2026-09-17T20:15:00")` parses as
     * local time, and any conversion toward UTC pushes a 20:15 Eastern kickoff
     * past midnight -- turning Thursday Night Football into a Friday game for
     * every viewer east of the Atlantic. The day must depend only on the
     * characters in the string.
     */
    expect(kickoffDay("2026-11-26T20:20:00")).toBe(4); // Thanksgiving night
    expect(kickoffDay("2026-12-25T23:00:00")).toBe(5); // Christmas, a Friday
  });

  it("returns null for missing or unparseable values", () => {
    expect(kickoffDay(null)).toBeNull();
    expect(kickoffDay(undefined)).toBeNull();
    expect(kickoffDay("")).toBeNull();
    expect(kickoffDay("TBD")).toBeNull();
  });
});

describe("shortWeekLabel", () => {
  it("flags Wednesday through Saturday", () => {
    expect(shortWeekLabel("2026-11-25T20:00:00")).toBe("WED");
    expect(shortWeekLabel("2026-09-17T20:15:00")).toBe("THU");
    expect(shortWeekLabel("2026-11-27T15:00:00")).toBe("FRI");
    expect(shortWeekLabel("2026-12-19T17:00:00")).toBe("SAT");
  });

  it("leaves the normal Sunday/Monday rhythm unflagged", () => {
    expect(shortWeekLabel("2026-09-20T13:00:00")).toBeNull(); // Sunday
    expect(shortWeekLabel("2026-09-21T20:15:00")).toBeNull(); // Monday
  });

  it("is null when the schedule has no kickoff time yet", () => {
    expect(shortWeekLabel(null)).toBeNull();
  });
});

describe("isDivisional", () => {
  const BUF = { conference: "AFC", division: "East" };
  const NYJ = { conference: "AFC", division: "East" };
  const DAL = { conference: "NFC", division: "East" };
  const KC = { conference: "AFC", division: "West" };

  it("is true only within the same division", () => {
    expect(isDivisional(BUF, NYJ)).toBe(true);
    expect(isDivisional(BUF, KC)).toBe(false);
  });

  it("does not match the two 'East' divisions across conferences", () => {
    // The reason conference is compared at all: the label alone would call
    // BUF-DAL a divisional game.
    expect(isDivisional(BUF, DAL)).toBe(false);
  });

  it("is false when a team is unknown", () => {
    expect(isDivisional(BUF, undefined)).toBe(false);
    expect(isDivisional(undefined, undefined)).toBe(false);
  });
});

describe("byeTeams", () => {
  const ALL = ["BUF", "NYJ", "KC", "CAR"];

  it("returns teams absent from that week's schedule", () => {
    const played = new Map([[5, new Set(["BUF", "NYJ"])]]);
    expect([...byeTeams(played, 5, ALL)].sort()).toEqual(["CAR", "KC"]);
  });

  it("treats week 0 as having no predecessor", () => {
    // Asking "who was on bye before week 1" must not answer "all 32 teams".
    expect(byeTeams(new Map(), 0, ALL).size).toBe(0);
  });

  it("treats an unknown week as unknown rather than a league-wide bye", () => {
    /**
     * A week we hold no schedule rows for -- beyond the loaded season, or
     * mid-ingest -- would otherwise mark every team as rested and light up the
     * badge on all 16 games.
     */
    expect(byeTeams(new Map(), 7, ALL).size).toBe(0);
    expect(byeTeams(new Map([[7, new Set<string>()]]), 7, ALL).size).toBe(0);
  });

  it("returns nothing when everyone played", () => {
    const played = new Map([[3, new Set(ALL)]]);
    expect(byeTeams(played, 3, ALL).size).toBe(0);
  });
});

describe("foreignVenue", () => {
  it("identifies the 2026 international slate by venue code", () => {
    // Every non-Home game on the 2026 schedule, by stadium_id.
    expect(foreignVenue("MEL00")?.city).toBe("Melbourne");
    expect(foreignVenue("RIO00")?.country).toBe("Brazil");
    expect(foreignVenue("LON02")?.code).toBe("LON");
    expect(foreignVenue("LON00")?.code).toBe("LON");
    expect(foreignVenue("PAR00")?.city).toBe("Paris");
    expect(foreignVenue("MAD01")?.country).toBe("Spain");
    expect(foreignVenue("MUN01")?.city).toBe("Munich");
    expect(foreignVenue("MEX00")?.country).toBe("Mexico");
  });

  it("does not flag domestic neutral sites", () => {
    /**
     * The distinction the allowlist exists for. All of these are real
     * `location = "Neutral"` games in the nflverse data and none of them left
     * the country: Super Bowls and weather/fire relocations.
     */
    for (const domestic of ["ATL97", "CLE00", "PIT00", "IND00", "LAX01", "NYC01"]) {
      expect(foreignVenue(domestic)).toBeNull();
    }
  });

  it("flags Toronto despite its Buffalo-looking code", () => {
    // Rogers Centre is "BUF01". Matching on a team prefix would miss it.
    expect(foreignVenue("BUF01")).toEqual({
      code: "TOR",
      city: "Toronto",
      country: "Canada",
    });
  });

  it("returns null for ordinary home games and missing data", () => {
    expect(foreignVenue(null)).toBeNull();
    expect(foreignVenue(undefined)).toBeNull();
    expect(foreignVenue("")).toBeNull();
    // An unrecognised venue is not flagged rather than guessed at.
    expect(foreignVenue("ZZZ99")).toBeNull();
  });
});
