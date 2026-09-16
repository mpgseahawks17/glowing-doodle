import { eq } from "drizzle-orm";
import { db, schema } from "../client";
import { DEFAULT_CONFIG, type ModelConfig } from "@/lib/model/types";

/**
 * Teams still available to pick.
 *
 * Survivor rule: a team can be used at most once per season. The brief also
 * notes "a loss burns the team (can't re-pick after losing with them)" -- which
 * the once-per-season rule already covers, since the team was used either way.
 * So availability is simply: every team minus every team already picked.
 */
export async function availableTeams(season: number): Promise<string[]> {
  const all = await db
    .select({ abbr: schema.teams.abbr })
    .from(schema.teams)
    .orderBy(schema.teams.abbr);

  const used = await db
    .select({ team: schema.myPicks.team })
    .from(schema.myPicks)
    .where(eq(schema.myPicks.season, season));

  const usedSet = new Set(used.map((u) => u.team));
  return all.map((t) => t.abbr).filter((abbr) => !usedSet.has(abbr));
}

export async function usedTeams(season: number) {
  return db
    .select()
    .from(schema.myPicks)
    .where(eq(schema.myPicks.season, season))
    .orderBy(schema.myPicks.week);
}

/** Lives remaining. Pool rule: three lives before elimination. */
export async function livesRemaining(season: number, total = 3): Promise<number> {
  const picks = await usedTeams(season);
  const losses = picks.filter((p) => p.result === "loss").length;
  return Math.max(0, total - losses);
}

const SETTING_KEYS = {
  wVegas: "w_vegas",
  wSilver: "w_silver",
  lambda: "lambda",
  horizon: "horizon",
  currentWeek: "current_week",
} as const;

async function readSettings(): Promise<Map<string, string>> {
  const rows = await db.select().from(schema.settings);
  return new Map(rows.map((r) => [r.key, r.value]));
}

export async function getConfig(): Promise<ModelConfig> {
  const s = await readSettings();
  const num = (key: string, fallback: number) => {
    const raw = s.get(key);
    if (raw === undefined) return fallback;
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
  };

  return {
    ...DEFAULT_CONFIG,
    weights: {
      vegas: num(SETTING_KEYS.wVegas, DEFAULT_CONFIG.weights.vegas),
      silver: num(SETTING_KEYS.wSilver, DEFAULT_CONFIG.weights.silver),
    },
    lambda: num(SETTING_KEYS.lambda, DEFAULT_CONFIG.lambda),
    horizon: num(SETTING_KEYS.horizon, DEFAULT_CONFIG.horizon),
  };
}

export async function setSetting(key: string, value: string): Promise<void> {
  await db
    .insert(schema.settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value } });
}

export { SETTING_KEYS };
