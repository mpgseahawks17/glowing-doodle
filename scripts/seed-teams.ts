import { db, schema } from "@/lib/db/client";
import { TEAMS } from "@/lib/data/teams";

/** Idempotent: safe to re-run. Teams never change mid-season. */
db.transaction((tx) => {
  for (const team of TEAMS) {
    tx.insert(schema.teams)
      .values(team)
      .onConflictDoUpdate({
        target: schema.teams.abbr,
        set: {
          name: team.name,
          conference: team.conference,
          division: team.division,
        },
      })
      .run();
  }
});

console.log(`Seeded ${TEAMS.length} teams.`);
