import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./lib/db/schema.ts",
  out: "./data/migrations",
  dbCredentials: { url: process.env.DATABASE_URL ?? "./data/survivor.db" },
});
