import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db, schema } from "@/lib/db/client";

/**
 * Record or clear my pick for a week.
 *
 * The unique index on (season, team) enforces the core survivor rule at the
 * database level: a team can never be used twice in a season, no matter what
 * the UI sends.
 */
export async function POST(request: Request) {
  const body = (await request.json()) as {
    season?: number;
    week?: number;
    team?: string;
    result?: "win" | "loss" | "push" | null;
  };

  const { season, week, team } = body;
  if (typeof season !== "number" || typeof week !== "number" || !team) {
    return NextResponse.json(
      { error: "season, week and team are required" },
      { status: 400 },
    );
  }
  if (week < 1 || week > 18) {
    return NextResponse.json({ error: "week must be 1-18" }, { status: 400 });
  }

  const [exists] = await db
    .select({ abbr: schema.teams.abbr })
    .from(schema.teams)
    .where(eq(schema.teams.abbr, team));
  if (!exists) {
    return NextResponse.json({ error: `unknown team ${team}` }, { status: 400 });
  }

  // The team must actually play that week -- you cannot pick a bye.
  const [game] = await db
    .select({ gameId: schema.games.gameId })
    .from(schema.games)
    .where(and(eq(schema.games.season, season), eq(schema.games.week, week)));
  if (!game) {
    return NextResponse.json(
      { error: `no games loaded for ${season} week ${week}` },
      { status: 400 },
    );
  }

  try {
    await db
      .insert(schema.myPicks)
      .values({ season, week, team, result: body.result ?? null })
      .onConflictDoUpdate({
        target: [schema.myPicks.season, schema.myPicks.week],
        set: { team, result: body.result ?? null },
      });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("UNIQUE")) {
      return NextResponse.json(
        { error: `${team} has already been used this season` },
        { status: 409 },
      );
    }
    throw err;
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const season = Number(searchParams.get("season"));
  const week = Number(searchParams.get("week"));
  if (!Number.isFinite(season) || !Number.isFinite(week)) {
    return NextResponse.json(
      { error: "season and week are required" },
      { status: 400 },
    );
  }

  await db
    .delete(schema.myPicks)
    .where(and(eq(schema.myPicks.season, season), eq(schema.myPicks.week, week)));

  return NextResponse.json({ ok: true });
}
