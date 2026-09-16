/**
 * Apply pending SQL migrations from data/migrations.
 *
 * We use generate + migrate rather than `drizzle-kit push`. Push diffs the
 * schema live and, on SQLite, rebuilds tables to change things like column
 * nullability -- which collided with existing index names and left the
 * database half-updated more than once. Migrations are ordered, reviewable
 * SQL, and safe to run against a database holding real picks.
 *
 * Workflow when the schema changes:
 *   1. edit lib/db/schema.ts
 *   2. npx drizzle-kit generate     (writes a new .sql file)
 *   3. npm run db:migrate           (applies it)
 *
 * Usage:  npm run db:migrate
 */
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { db, dbPath } from "@/lib/db/client";

migrate(db, { migrationsFolder: "./data/migrations" });
console.log(`Migrations applied to ${dbPath}`);
