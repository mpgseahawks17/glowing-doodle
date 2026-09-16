import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import * as schema from "./schema";

/**
 * SQLite for now (single user, local). All access goes through this module and
 * lib/db/repo/*, so the eventual move to Postgres is a driver swap rather than
 * a rewrite -- see Phase 7 of the build plan.
 *
 * The default path is built with a statically-scoped join under `data/` rather
 * than resolve() on a bare env var. Turbopack cannot analyse the latter and
 * warns that it may pull the entire project tree into the server bundle.
 */
const configured = process.env.DATABASE_URL;
const dbPath =
  configured && isAbsolute(configured)
    ? configured
    : join(process.cwd(), "data", configured ? configured.replace(/^\.?\/?data\//, "") : "survivor.db");

mkdirSync(dirname(dbPath), { recursive: true });

const sqlite = new Database(dbPath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

export const db = drizzle(sqlite, { schema });
export { schema, dbPath };
