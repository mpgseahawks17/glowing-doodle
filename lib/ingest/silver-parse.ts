import { NAME_TO_ABBR, TEAMS } from "@/lib/data/teams";

/**
 * Parser for hand-entered ELWAY projections.
 *
 * ELWAY's per-game numbers live inside a Substack "code embed" iframe that
 * Cloudflare will not serve to a scripted client, so they are transcribed by
 * hand each week. The format is deliberately forgiving about everything except
 * the things that would corrupt a pick.
 *
 * Format:
 *
 *     # comments and blank lines are ignored
 *     week 2
 *     KC 58
 *     Philadelphia Eagles 71.5
 *     LA 0.62
 *
 *     week 3
 *     BUF 70
 *
 * One line per TEAM, so a game normally contributes two lines. ELWAY is a
 * win/loss/TIE model -- home + away + tie = 1 -- so the opponent's probability
 * cannot be derived as 1 - p and both sides must be transcribed.
 *
 * The schedule still supplies home/away and the matchup, so a misread team
 * code fails loudly (that team has no game that week) rather than silently
 * landing on the wrong game. ingest-silver.ts additionally checks that the two
 * sides of a game imply a plausible tie probability.
 */

export interface ParsedProjection {
  week: number;
  team: string;
  prob: number;
  line: number;
}

export interface ParseResult {
  projections: ParsedProjection[];
  errors: string[];
}

const VALID_TEAMS = new Set(TEAMS.map((t) => t.abbr));

/** Accepts "KC", "kc", or "Kansas City Chiefs". */
function resolveTeam(raw: string): string | null {
  const trimmed = raw.trim();
  const upper = trimmed.toUpperCase();
  if (VALID_TEAMS.has(upper)) return upper;
  return NAME_TO_ABBR.get(trimmed.toLowerCase()) ?? null;
}

/**
 * Accepts 58, 58.2, 0.582 or 58.2%. Values above 1 are read as percentages.
 *
 * The 0-1 vs 0-100 ambiguity only bites at exactly 1, which would mean either
 * "1%" or "certain". Both are nonsense for an NFL game, so we reject it rather
 * than guess.
 */
function parseProb(raw: string, line: number): { value: number } | { error: string } {
  const cleaned = raw.trim().replace(/%$/, "");
  const n = Number(cleaned);
  if (!Number.isFinite(n)) {
    return { error: `line ${line}: "${raw}" is not a number` };
  }
  const prob = n > 1 ? n / 100 : n;
  if (prob <= 0 || prob >= 1) {
    return {
      error:
        `line ${line}: win probability ${raw} is out of range. ` +
        `Expected something like 58, 58.2 or 0.582.`,
    };
  }
  if (prob < 0.05 || prob > 0.95) {
    // Not fatal, but almost certainly a transcription slip -- ELWAY does not
    // put NFL games outside roughly 10-90%.
    return { error: `line ${line}: ${raw} looks implausible for an NFL game` };
  }
  return { value: prob };
}

export function parseSilverText(text: string): ParseResult {
  const projections: ParsedProjection[] = [];
  const errors: string[] = [];
  let currentWeek: number | null = null;
  const seen = new Map<string, number>();

  const lines = text.split(/\r?\n/);
  for (const [i, rawLine] of lines.entries()) {
    const lineNo = i + 1;
    const line = rawLine.replace(/^[#>\s*-]+/, "").trim();
    if (line === "" || rawLine.trim().startsWith("#")) {
      // A "# week 3" heading is still a heading, so fall through only if it
      // does not look like one.
      if (!/^week\s+\d+/i.test(line)) continue;
    }

    const weekMatch = line.match(/^week\s+(\d+)\b/i);
    if (weekMatch) {
      const w = Number(weekMatch[1]);
      if (w < 1 || w > 18) {
        errors.push(`line ${lineNo}: week ${w} is outside 1-18`);
        continue;
      }
      currentWeek = w;
      continue;
    }

    // "KC 58", "Kansas City Chiefs 58.2", "KC  0.582"
    const entry = line.match(/^(.+?)[\s,:]+([\d.]+%?)$/);
    if (!entry) {
      errors.push(`line ${lineNo}: could not read "${rawLine.trim()}"`);
      continue;
    }

    if (currentWeek === null) {
      errors.push(`line ${lineNo}: entry before any "week N" heading`);
      continue;
    }

    const team = resolveTeam(entry[1]!);
    if (!team) {
      errors.push(`line ${lineNo}: unknown team "${entry[1]!.trim()}"`);
      continue;
    }

    const prob = parseProb(entry[2]!, lineNo);
    if ("error" in prob) {
      errors.push(prob.error);
      continue;
    }

    const key = `${currentWeek}:${team}`;
    const prior = seen.get(key);
    if (prior !== undefined) {
      errors.push(
        `line ${lineNo}: ${team} already given for week ${currentWeek} (line ${prior})`,
      );
      continue;
    }
    seen.set(key, lineNo);

    projections.push({ week: currentWeek, team, prob: prob.value, line: lineNo });
  }

  return { projections, errors };
}
