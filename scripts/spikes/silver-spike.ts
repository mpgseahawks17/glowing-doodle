/**
 * SPIKE S2 -- Where do ELWAY's per-game win probabilities actually live?
 *
 * FINDINGS SO FAR (verified unauthenticated from this machine):
 *
 *  - The Substack JSON API is live on the custom domain natesilver.net, but the
 *    post endpoint is `/api/v1/posts/<slug>` -- NOT `/api/v1/posts/by-slug/
 *    <slug>`, which returns HTTP 200 with the HTML page shell and will silently
 *    look like an auth failure.
 *  - `/api/v1/archive?sort=new&limit=N` lists posts with slug + audience.
 *  - The ELWAY interactive is NOT an HTML table. It is a Substack "code embed":
 *    body_html contains <iframe class="code-embed-iframe"> pointing at
 *    <uuid>.substackcode.com/api/v1/code-embeds/render/<hash>/<id>?token=<JWT>
 *  - That token is a JWT minted fresh on every post fetch, carrying
 *    {uuid, hash, post_id, viewer_role, viewer_id, iat, exp} with exp = iat +
 *    3600. So the embed URL is valid for ONE HOUR and must be fetched in the
 *    same run that read the post. It cannot be hardcoded.
 *  - The JWT's `viewer_role` / `viewer_id` are the cleanest auth signal:
 *    anonymous gives role "reader" and a null id.
 *
 * WHAT THIS RUN DETERMINES: whether your subscriber cookie changes viewer_role,
 * and what the embed actually serves -- inline data, a data URL, or a JS bundle
 * that fetches its numbers separately.
 *
 * Read-only. Writes artifacts to ./data/spike-silver/ for inspection.
 *
 * Usage:  npm run spike:silver
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { isBareSid, substackCookieHeader } from "@/lib/ingest/substack-auth";

const BASE = "https://www.natesilver.net";
const OUT = resolve("./data/spike-silver");
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

interface ArchivePost {
  id: number;
  slug: string;
  title: string;
  audience: string;
  post_date: string;
}

function headers(): Record<string, string> {
  const h: Record<string, string> = { accept: "application/json", "user-agent": UA };
  const cookie = substackCookieHeader();
  if (cookie) h.cookie = cookie;
  return h;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { headers: headers() });
  const text = await res.text();
  const type = res.headers.get("content-type") ?? "";
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}: ${text.slice(0, 200)}`);
  if (!type.includes("json")) {
    throw new Error(
      `GET ${path} returned ${type} instead of JSON. If this is the post ` +
        `endpoint, check the path is /api/v1/posts/<slug>.`,
    );
  }
  return JSON.parse(text) as T;
}

/**
 * Decode the embed token's claims without verifying the signature.
 *
 * Substack's code-embed token is NOT a standard 3-part JWT -- it has no header
 * segment, just `<payload>.<signature>`. So the payload is part 0 here, where a
 * normal JWT would put it at part 1. We try each segment and take the first
 * that parses as JSON, which covers both shapes if Substack ever changes it.
 */
function decodeTokenClaims(token: string): Record<string, unknown> | null {
  for (const segment of token.split(".")) {
    try {
      const decoded = JSON.parse(
        Buffer.from(segment, "base64url").toString("utf8"),
      );
      if (decoded && typeof decoded === "object") {
        return decoded as Record<string, unknown>;
      }
    } catch {
      // Not this segment; try the next.
    }
  }
  return null;
}

async function main() {
  mkdirSync(OUT, { recursive: true });

  if (!process.env.SUBSTACK_SID) {
    console.warn(
      "WARNING: SUBSTACK_SID not set -- running anonymously. See .env.example.\n",
    );
  }

  console.log("1. Searching the archive for ELWAY posts...");
  const archive = await getJson<ArchivePost[]>("/api/v1/archive?sort=new&limit=50");
  writeFileSync(`${OUT}/archive.json`, JSON.stringify(archive, null, 2));

  const candidates = archive.filter((p) =>
    /elway|nfl/i.test(`${p.slug} ${p.title}`),
  );
  for (const p of candidates.slice(0, 10)) {
    console.log(`     [${p.audience}] ${p.post_date?.slice(0, 10)}  ${p.slug}`);
  }

  // Prefer the ratings/projections post -- that is the one with the game grid.
  const target =
    candidates.find((p) => /elway.*(ratings|projections)/i.test(p.slug)) ??
    candidates[0];
  if (!target) {
    console.log("\n   No ELWAY post found. Widen the archive limit.");
    return;
  }

  console.log(`\n2. Fetching /api/v1/posts/${target.slug} ...`);
  const post = await getJson<Record<string, unknown>>(
    `/api/v1/posts/${target.slug}`,
  );
  writeFileSync(`${OUT}/post.json`, JSON.stringify(post, null, 2));

  const body = String(post.body_html ?? "");
  writeFileSync(`${OUT}/body.html`, body);
  console.log(`   audience: ${String(post.audience)}  body_html: ${body.length} chars`);

  console.log("\n3. Extracting code embeds...");
  const srcs = [...body.matchAll(/<iframe[^>]+src="([^"]+)"/g)].map((m) =>
    m[1]!.replace(/&amp;/g, "&"),
  );
  console.log(`   ${srcs.length} iframe(s) found`);

  if (srcs.length === 0) {
    console.log(
      "   No embeds. If body_html now contains <table> elements, the data is " +
        "inline -- parse data/spike-silver/body.html directly.",
    );
    return;
  }

  // The JWT tells us whether the cookie actually authenticated us.
  const firstToken = new URL(srcs[0]!).searchParams.get("token");
  const claims = firstToken ? decodeTokenClaims(firstToken) : null;
  if (!claims) {
    console.log("   (could not decode the embed token -- shape may have changed)");
  }
  if (claims) {
    const iat = Number(claims.iat);
    const exp = Number(claims.exp);
    console.log(`   viewer_role: ${String(claims.viewer_role)}`);
    console.log(`   viewer_id:   ${String(claims.viewer_id)}`);
    console.log(`   token life:  ${exp - iat}s (expires ${new Date(exp * 1000).toISOString()})`);
    const authed = claims.viewer_id !== null && claims.viewer_id !== undefined;
    if (authed) {
      console.log("\n   AUTH: AUTHENTICATED (cookie accepted)");
    } else if (!substackCookieHeader()) {
      console.log("\n   AUTH: ANONYMOUS (no SUBSTACK_SID set)");
    } else {
      console.log("\n   AUTH: ANONYMOUS -- a cookie was sent but rejected.");
      console.log("   Most likely causes, in order:");
      console.log(
        "     1. Copied from substack.com. Substack issues a separate session",
      );
      console.log(
        "        per custom domain, so it must come from natesilver.net.",
      );
      console.log("     2. Expired -- re-copy it.");
      if (isBareSid()) {
        console.log(
          "     3. Only substack.sid was supplied. Paste the WHOLE cookie",
        );
        console.log(
          "        header instead (F12 > Network > the natesilver.net document",
        );
        console.log(
          "        request > Request Headers > copy everything after 'cookie:').",
        );
      }
    }
  }

  console.log("\n4. Fetching embed contents...");
  for (const [i, src] of srcs.entries()) {
    const host = new URL(src).host;
    try {
      const res = await fetch(src, {
        headers: { "user-agent": UA, referer: `${BASE}/` },
      });
      const text = await res.text();
      writeFileSync(`${OUT}/embed-${i + 1}.html`, text);

      const scripts = [...text.matchAll(/<script[^>]+src="([^"]+)"/g)].map(
        (m) => m[1]!,
      );
      const dataUrls = [
        ...text.matchAll(/https?:\/\/[^"'\s<>]+\.(?:json|csv)/g),
      ].map((m) => m[0]);
      const teamHits = (text.match(/\b(KC|BUF|PHI|SF|BAL|DAL|CIN)\b/g) ?? []).length;
      const pctHits = (text.match(/\b\d{1,3}(\.\d)?%/g) ?? []).length;
      const inlineJson = /\{"[a-z_]+":/i.test(text);

      console.log(`\n   embed ${i + 1} (${host}) status=${res.status} len=${text.length}`);
      console.log(`     team codes: ${teamHits}   percentages: ${pctHits}`);
      console.log(`     inline JSON blob: ${inlineJson}`);
      console.log(`     external scripts: ${scripts.length}`);
      for (const s of scripts.slice(0, 6)) console.log(`       - ${s}`);
      if (dataUrls.length > 0) {
        console.log(`     DATA URLS FOUND:`);
        for (const d of dataUrls) console.log(`       - ${d}`);
      }
    } catch (err) {
      const cause = (err as { cause?: { code?: string } }).cause?.code;
      console.log(
        `\n   embed ${i + 1} (${host}) FETCH FAILED: ` +
          `${err instanceof Error ? err.message : err}${cause ? ` (${cause})` : ""}`,
      );
    }
  }

  console.log("\n--- NEXT STEP ---");
  console.log(
    "Inspect data/spike-silver/embed-*.html. We are looking for the per-game\n" +
      "win probabilities. If the embed holds an inline JSON blob or names a\n" +
      ".json/.csv URL, that is the ingest target. If it is only a JS bundle,\n" +
      "open the ELWAY post logged in, F12 -> Network -> Fetch/XHR, reload, and\n" +
      "note which request returns the game data.\n\n" +
      "NOTE: embed tokens expire 1 hour after the post fetch, so ingestion must\n" +
      "always read the post and the embed in the same run.",
  );
  console.log(`\nArtifacts in ${OUT}`);
}

main().catch((err) => {
  console.error(`\nSPIKE FAILED: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
