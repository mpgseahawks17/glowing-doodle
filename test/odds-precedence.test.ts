import { describe, expect, it } from "vitest";
import { pickBestOdds } from "@/lib/db/repo/probabilities";

const hoursAgo = (h: number) =>
  new Date(Date.now() - h * 3_600_000).toISOString();

const row = (
  source: string,
  bookCount: number,
  hours: number,
  gameId = "G1",
) => ({ gameId, source, bookCount, fetchedAt: hoursAgo(hours) });

describe("pickBestOdds", () => {
  it("prefers a multi-book median over a single-book line", () => {
    // The point of the whole exercise: the current week has both an Odds API
    // median and an ESPN DraftKings line. The median must win.
    const best = pickBestOdds([
      row("espn", 1, 1),
      row("odds-api", 10, 2),
    ]);
    expect(best.get("G1")!.source).toBe("odds-api");
  });

  it("falls back to the single-book line when no median exists", () => {
    // Lookahead weeks: only ESPN publishes them.
    const best = pickBestOdds([row("espn", 1, 1)]);
    expect(best.get("G1")!.source).toBe("espn");
  });

  it("prefers the most recent when book counts are equal", () => {
    const best = pickBestOdds([
      row("nflverse", 1, 40),
      row("espn", 1, 2),
    ]);
    expect(best.get("G1")!.source).toBe("espn");
  });

  it("prefers freshness once the richer snapshot goes stale", () => {
    // Guards a real failure mode: if the Odds API quota runs out, its last
    // median would otherwise be preferred forever over live ESPN lines.
    const best = pickBestOdds([
      row("odds-api", 10, 100),
      row("espn", 1, 1),
    ]);
    expect(best.get("G1")!.source).toBe("espn");
  });

  it("keeps the median while it is still within the staleness window", () => {
    const best = pickBestOdds([
      row("odds-api", 10, 20),
      row("espn", 1, 1),
    ]);
    expect(best.get("G1")!.source).toBe("odds-api");
  });

  it("chooses independently for each game", () => {
    const best = pickBestOdds([
      row("odds-api", 10, 2, "G1"),
      row("espn", 1, 1, "G1"),
      row("espn", 1, 1, "G2"),
    ]);
    expect(best.get("G1")!.source).toBe("odds-api");
    expect(best.get("G2")!.source).toBe("espn");
    expect(best.size).toBe(2);
  });
});
