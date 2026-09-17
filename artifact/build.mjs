import { readFileSync, writeFileSync } from "node:fs";

/**
 * Inject the exported grid data into the artifact template.
 *
 * The published page must be fully self-contained: it is opened from a phone
 * with no access to this machine, so the numbers travel with the HTML rather
 * than being fetched. Re-run `node export-grid.mjs` then this script to
 * refresh the snapshot.
 */
const tpl = readFileSync(new URL("./grid.template.html", import.meta.url), "utf8");
const data = readFileSync(new URL("../grid-data.json", import.meta.url), "utf8");

if (!tpl.includes("/*DATA*/")) throw new Error("template is missing the /*DATA*/ marker");

const out = tpl.replace("/*DATA*/", data);
writeFileSync(new URL("./grid.html", import.meta.url), out);

const parsed = JSON.parse(data);
console.log(
  `built grid.html  ${(out.length / 1024).toFixed(0)} KB  ` +
    `weeks ${Object.keys(parsed.weeks).length}  teams ${Object.keys(parsed.teams).length}`,
);

/**
 * Also emit a fully standalone document.
 *
 * `grid.html` above is a fragment: Claude Code wraps it in
 * <!doctype html><head>...</head><body> at publish time, so it has no document
 * shell of its own. That wrapper does not exist anywhere else -- opened from
 * the filesystem, emailed to someone, or handed to a regular Claude
 * conversation, the fragment needs the shell supplied here.
 *
 * The only thing the wrapper contributes that the template does not already
 * set for itself is the charset and viewport meta; the template declares its
 * own body margin, background and font stack, so nothing else is reproduced.
 */
// Hoist the leading <title> and <link> tags. They work in <body> -- except
// rel="preconnect", which is ignored there, silently costing the font
// handshake the head start it was added for.
const headMatch = out.match(/^(?:\s*(?:<title>[\s\S]*?<\/title>|<link\b[^>]*>))+/);
if (!headMatch || !headMatch[0].includes("<title>")) {
  throw new Error("template is missing a leading <title> to hoist into <head>");
}

const standalone = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${headMatch[0].trim()}
</head>
<body>
${out.slice(headMatch[0].length)}
</body>
</html>
`;
writeFileSync(new URL("./survivor-odds-board.html", import.meta.url), standalone);
console.log(`built survivor-odds-board.html  ${(standalone.length / 1024).toFixed(0)} KB  standalone`);
