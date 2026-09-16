/**
 * SPIKE S3 -- Does the Yahoo Fantasy API expose Survival Football pick data?
 *
 * What we know from the docs:
 *   - The game exists in the API surface: code "nfls", name "Survival
 *     Football", type "pickem-group" (alongside nfl / pickem-team).
 *   - The documented resource model (game, league, team, player, roster,
 *     standings, scoreboard, transactions) is built for full fantasy leagues.
 *     Nothing in the developer docs mentions pickem, survival, or picks, and no
 *     mature wrapper (yfpy, yahoo_fantasy_api, yahoo-fantasy-node) implements
 *     survival picks.
 *
 * Expected outcome: league 7029 shows up, and per-member pick data does not.
 * If that holds, the league tracker scrapes the web UI post-lock instead.
 *
 * Read-only: issues GETs and dumps the JSON. Writes nothing to the database
 * and changes nothing in the Yahoo account.
 *
 * Prerequisites -- create an app at https://developer.yahoo.com/apps/ with
 * Fantasy Sports read permission, then complete the OAuth consent once to get a
 * refresh token. Set YAHOO_CLIENT_ID / YAHOO_CLIENT_SECRET / YAHOO_REFRESH_TOKEN.
 *
 * Usage:  npm run spike:yahoo
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve("./data/spike-yahoo");
const API = "https://fantasysports.yahooapis.com/fantasy/v2";
const LEAGUE_ID = process.env.YAHOO_LEAGUE_ID ?? "7029";

async function accessToken(): Promise<string> {
  const id = process.env.YAHOO_CLIENT_ID;
  const secret = process.env.YAHOO_CLIENT_SECRET;
  const refresh = process.env.YAHOO_REFRESH_TOKEN;
  if (!id || !secret || !refresh) {
    throw new Error(
      "Set YAHOO_CLIENT_ID, YAHOO_CLIENT_SECRET and YAHOO_REFRESH_TOKEN. " +
        "See .env.example.",
    );
  }

  const res = await fetch("https://api.login.yahoo.com/oauth2/get_token", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refresh,
      redirect_uri: "oob",
    }),
  });

  if (!res.ok) {
    throw new Error(`Token refresh failed ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as { access_token: string };
  return json.access_token;
}

async function probe(token: string, label: string, path: string) {
  const url = `${API}${path}${path.includes("?") ? "&" : "?"}format=json`;
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${token}`, accept: "application/json" },
  });
  const text = await res.text();
  const file = `${OUT}/${label}.json`;
  writeFileSync(file, text);

  const status = res.ok ? "OK " : "ERR";
  console.log(`  [${status} ${res.status}] ${label}`);
  console.log(`         ${path}`);
  if (!res.ok) {
    console.log(`         ${text.slice(0, 180).replace(/\s+/g, " ")}`);
    return null;
  }

  // Cheap signal: does the payload mention picks at all?
  const mentionsPick = /"pick|survival|nfls/i.test(text);
  console.log(
    `         ${text.length} bytes, pick/survival keywords: ${mentionsPick}`,
  );
  return text;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const token = await accessToken();
  console.log("Access token acquired.\n");

  console.log("--- PROBES ---");
  // 1. Which games does this user actually have? Confirms the nfls game key.
  const games = await probe(
    token,
    "01-user-games",
    "/users;use_login=1/games",
  );

  const gameKeys = [...(games ?? "").matchAll(/"game_key":"(\d+)"/g)].map(
    (m) => m[1],
  );
  const nflsBlock = (games ?? "").match(
    /"game_key":"(\d+)"[^}]*?"code":"nfls"/,
  );
  const nflsKey = nflsBlock?.[1];
  console.log(`\n  game keys seen: ${[...new Set(gameKeys)].join(", ") || "none"}`);
  console.log(`  nfls game key:  ${nflsKey ?? "NOT FOUND"}\n`);

  // 2. Survival leagues for this user.
  await probe(
    token,
    "02-nfls-leagues",
    "/users;use_login=1/games;game_codes=nfls/leagues",
  );

  if (nflsKey) {
    const leagueKey = `${nflsKey}.l.${LEAGUE_ID}`;
    console.log(`\n  Probing league key ${leagueKey}`);
    // 3-6. The interesting ones: can we reach members and their picks?
    await probe(token, "03-league", `/league/${leagueKey}`);
    await probe(token, "04-league-teams", `/league/${leagueKey}/teams`);
    await probe(token, "05-league-standings", `/league/${leagueKey}/standings`);
    await probe(token, "06-league-players", `/league/${leagueKey}/players`);
  }

  console.log("\n--- WHAT TO LOOK FOR ---");
  console.log(
    "  If 03-06 return real data containing each member's weekly team\n" +
      "  selections, the official API is viable and Phase 6 uses it.\n" +
      "  If they 400/404 or return only names and records with no picks,\n" +
      "  fall back to scraping the group pages after each week's lock.\n" +
      `\n  Raw responses written to ${OUT} -- inspect them before deciding.`,
  );
}

main().catch((err) => {
  console.error(`\nSPIKE FAILED: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
