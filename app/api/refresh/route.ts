import { exec } from "node:child_process";
import { promisify } from "node:util";
import { NextResponse } from "next/server";

const run = promisify(exec);

/**
 * Re-run the ingest scripts from the browser.
 *
 * SECURITY: this endpoint executes local processes. That is acceptable only
 * because the app is a single-user tool bound to localhost. Every command below
 * is a fixed string -- no request data is interpolated into a shell command --
 * and there is no way for a caller to influence what runs. If this app is ever
 * exposed beyond localhost (Phase 7), this route must be removed or put behind
 * real authentication.
 *
 * `shell: true` is implicit in `exec` and is required on Windows, where `npm`
 * is `npm.cmd` and cannot be spawned directly.
 */

const TIMEOUT_MS = 180_000;

interface SourceResult {
  source: string;
  status: "ok" | "skipped" | "error";
  detail: string;
}

/** Pull the meaningful line out of an ingest script's chatter. */
function summarise(stdout: string, patterns: RegExp[]): string {
  const lines = stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (const p of patterns) {
    const hit = lines.find((l) => p.test(l));
    if (hit) return hit;
  }
  return lines.at(-1) ?? "completed";
}

async function runStep(
  source: string,
  command: string,
  patterns: RegExp[],
): Promise<SourceResult> {
  try {
    const { stdout, stderr } = await run(command, {
      cwd: process.cwd(),
      timeout: TIMEOUT_MS,
      maxBuffer: 10 * 1024 * 1024,
    });
    // Scripts warn on stderr. A successful run that nonetheless flags a problem
    // -- a source whose timestamp has stopped moving, say -- must still surface
    // that here, or the UI reports a clean refresh over a real warning.
    return {
      source,
      status: "ok",
      detail: summarise(`${stdout}
${stderr}`, patterns),
    };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    const detail =
      (e.stderr || e.stdout || e.message || "failed")
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
        .at(-1) ?? "failed";
    return { source, status: "error", detail };
  }
}

export async function POST() {
  const results: SourceResult[] = [];

  // Schedule first: results decide which week is current, which scopes the
  // Odds API pull that follows.
  results.push(
    await runStep("Schedule & results", "npm run ingest:schedule", [
      /^Loaded \d+ games/,
      /^OK:/,
    ]),
  );

  results.push(
    await runStep("ESPN (all weeks)", "npm run ingest:odds:espn", [
      /^Wrote \d+ odds snapshots/,
    ]),
  );

  // The Odds API is the only paid/keyed source and only ever returns the
  // current round. Absent a key this is a configuration state, not a failure.
  if (process.env.ODDS_API_KEY) {
    results.push(
      await runStep("Odds API (current week)", "npm run ingest:odds", [
        /^Wrote \d+ odds snapshots/,
        /Credits used/,
      ]),
    );
  } else {
    results.push({
      source: "Odds API (current week)",
      status: "skipped",
      detail: "No ODDS_API_KEY set — add one to .env to enable the median.",
    });
  }

  // ELWAY reads a public Google Sheet, so this needs no cookie or subscription
  // check -- see lib/ingest/silver-sheet.ts.
  results.push(
    // WARNING first: a stuck source timestamp matters more than the row count,
    // and matching "Unchanged" ahead of it would hide exactly that case.
    await runStep("ELWAY (all weeks)", "npm run ingest:silver:sheet", [
      /^WARNING/,
      /^Wrote \d+ Silver projections/,
      /^Unchanged/,
    ]),
  );

  return NextResponse.json({ results, at: new Date().toISOString() });
}
