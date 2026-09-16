# NFL Survivor Pool

Picks the optimal weekly survivor team by blending betting-market moneylines with
Silver Bulletin's ELWAY projections, then applying an opportunity-cost model over
a rolling 4-week window.

Local-only for now. See `PROJECT_BRIEF.md` in the original project folder for the
pool rules and the full feature spec.

## Status

| Phase | What | State |
|---|---|---|
| 0 | Spikes (odds coverage, Silver structure, Yahoo API) | scripts ready, need credentials |
| 1 | Schema + schedule ingest | **done** — 272 games, 32 teams, 18 weeks verified |
| 2 | Model engine + tests | **done** — 30 tests passing |
| 3 | Vegas ingest | **done** — ESPN + nflverse working; Odds API needs a key |
| 4 | Forward-window probabilities | **done** — ESPN lookahead lines, weeks N…N+8 |
| 4b | ELWAY blend | **done** — automated from Silver's public sheet, all 18 weeks |
| 5 | Web UI | **done** — scorecard, grid, picks |
| 6 | League picks tracker | not started |
| 7 | Hosting / sharing | deferred |

## Setup

```bash
npm install
cp .env.example .env       # then fill in ODDS_API_KEY (optional)
npm run setup              # migrate, seed teams, load the schedule
npm run ingest:odds:espn   # lookahead moneylines -- no key needed
npm test                   # model engine test suite
npm run dev                # web app at http://localhost:3000
npm run scorecard          # same model, printed to the terminal
```

### Schema changes

Use generated migrations, not `drizzle-kit push`. Push diffs the schema live
and, on SQLite, rebuilds tables to change column nullability — which collided
with existing index names and twice left the database half-updated.

```bash
# 1. edit lib/db/schema.ts, then:
npm run db:generate
npm run db:migrate
```

Note that the dev server holds `data/survivor.db` open. On Windows a delete of
an open file fails **silently**, so stop the server before rebuilding the
database or you will keep running against the old schema.

## The web app

Four tabs at `http://localhost:3000`:

- **Scorecard** — every available team ranked by Score, with Vegas / Silver /
  Diff / Blend, PickNow, PickLater (and the week it peaks), and a
  recommendation label.
- **Plan** — a recommended pick for every week that has data (about nine),
  with the running chance of surviving that far. See below.
- **Grid** — all 32 teams across 18 weeks, colour-coded by blended
  probability. The current week plus the lookahead window is tinted blue, byes
  are dots, used teams are struck through. Click any week header to sort by
  that week; filter to unused teams only.
- **Sources** — every game, every week, one column per feed, so disagreement
  and staleness are visible instead of buried in the blend. See below.
- **Picks** — record your weekly pick and its result. Used teams immediately
  drop out of the scorecard and available set.

λ, the Vegas/Silver weighting, the horizon and the displayed week are all live
controls. They recompute **in the browser**: `lib/model/` is pure with no I/O,
so the same scoring code runs client-side over a matrix shipped with the page.
Dragging λ re-ranks instantly rather than round-tripping to the server.

Without an Odds API key you can still populate the current week's market data
from the nflverse closing lines:

```bash
npx tsx scripts/ingest-odds-csv.ts
```

That is a single closing-line source rather than a median across books, so
prefer `npm run ingest:odds` once the key is in place.

## The Plan tab

Picks compete: spending a team in week 3 means it is gone in week 7. So
planning a season is an **assignment problem** — choose a distinct team for
each upcoming week so the chance of surviving all of them is as high as
possible. Survival compounds multiplicatively, so maximising the product of win
probabilities is the same as maximising the sum of their logs, which is exactly
what a linear assignment solves.

Two strategies, both shown:

- **Optimal** — solves every week at once (Hungarian algorithm,
  `lib/model/assign.ts`). Will spend a weaker team now to protect a week that
  needs a specific strong one.
- **Greedy** — takes the Scorecard's top pick each week in turn, then moves on.
  Its first row always matches the Scorecard, by construction.

The header reports both survival numbers, so the cost of picking week-by-week
is explicit.

Both run over the window the Horizon control sets, which matters: greedy only
diverges when its PickLater window is too narrow to see what the assignment can
see. On the 2026 week-1 data they are identical at every horizon, because once
the window reaches week 9, `PickLater(SEA)` jumps from 0 to 7.4 and greedy stops
spending Seattle early of its own accord — converging on the optimal path.

That is the reassuring case, not a redundancy. Greedy is provably suboptimal in
general; `test/plan.test.ts` constructs a case where it strands a later week.
When the header says week-by-week costs nothing, it means the scarcity
constraint is not binding over that window.

A plan is not a commitment. Only the current week's prices are firm — later
weeks are single-book lookahead lines that will move. Re-check it weekly.

## How long should the lookahead window be?

Tested empirically rather than argued about — `npm run backtest` replays
2010–2025 as survivor pools, once per horizon, and measures how long each
survives. Three lives, tie counts as a loss.

**Avoiding lookahead bias is the whole experiment.** `games.csv` holds closing
lines for every game of a finished season, so using week 9's line while
deciding week 2 would hand long horizons knowledge nobody had — flattering
exactly the thing under test. So the current week uses the real closing line,
and future weeks are projected by an Elo rating built only from games already
played (`lib/model/elo.ts`).

Result over 16 seasons, mean weeks survived:

| 1w | 2w | 3w | 4w | 5w | 6w | 8w | 9w | 12w |
|---|---|---|---|---|---|---|---|---|
| 11.88 | 11.88 | 11.38 | 11.75 | 10.69 | 10.81 | 12.13 | **12.88** | 11.38 |

Nine weeks looks best — but a paired bootstrap (20,000 resamples) puts the
difference against the 4-week baseline at **+1.13 weeks, 95% CI [−1.44, +3.56]**.
The interval spans zero; it is not distinguishable from noise. The ordering is
also non-monotonic (5w and 6w come out *worse* than both 4w and 9w), which has
no plausible mechanism and is the signature of a small, high-variance sample.

**Conclusion: the horizon is not worth tuning.** Separately, the recommended
pick is usually identical from 2 weeks to 9 — it only diverges occasionally,
and then mostly on the least reliable numbers. The default stays at 4, per the
brief.

Two honest caveats. The backtest projects future weeks with Elo, while the live
app has real ESPN lookahead lines, which are probably better — so this may
*understate* the value of a long window. And with confidence intervals this
wide, "no detectable difference" means any real effect is smaller than a
16-season sample can resolve, not that it is zero.

Use the Plan tab's long view as a flag that a team is precious later, not as a
binding instruction.

## What is saving a strong team worth? (λ)

`npm run backtest` answers this over 2010–2025. Strategies **decide** on
contemporaneous information only (real closing line for the current week, Elo
from completed games for future weeks) but are **scored** by the closing-line
probability of the team they picked — not by whether it won, which removes
outcome luck. Elimination is disabled so every strategy makes all 18 picks.

The headline, in points of win probability per pick:

| bucket | optimal − myopic | ORACLE − myopic |
|---|---|---|
| wk1–6 | **−0.70** | +0.11 |
| wk7–12 | −0.28 | +0.90 |
| wk13–18 | **+1.41** | +2.93 |
| overall | +0.12 | +1.28 |

**Saving costs you early and pays late.** Through week 6 it is actively
negative — you give up a better team now for an option that usually is not
needed, because with 32 teams available scarcity does not bind. By weeks 13–18
the pool has thinned and it is worth +1.41. Net across a season: +0.12, i.e.
almost nothing.

**But the ORACLE column is the important one.** That row prices future weeks
with their *actual* closing lines — deliberate cheating, included as a ceiling.
With perfect foresight saving is worth **+1.28** points per pick and is never
negative. So saving is genuinely valuable; our forward estimates just capture
roughly a tenth of it. The binding constraint is forecast quality, not strategy.

### Choosing λ

| λ | effective win % | vs λ=1 (95% CI) |
|---|---|---|
| 0 (myopic) | 78.69% | −0.27 [−0.72, +0.14] |
| 0.5 | 79.08% | +0.13 [−0.14, +0.39] |
| **0.75** | **79.10%** | +0.14 [−0.03, +0.34] |
| 1.0 | 78.95% | — |
| 1.5 | 78.62% | **−0.31 [−0.65, −0.01]** |
| 2.0 | 78.44% | **−0.50 [−0.96, −0.10]** |

Anything in **0.5–1.0** is defensible. λ ≥ 1.5 is measurably *worse* — those
CIs exclude zero. The default stays at 1.0: 0.75 edges it here, but this was
fitted against Elo forward estimates, and production runs on ESPN lookahead
lines, which are better. Better forward data justifies trusting PickLater
*more*, which pushes the right λ up, not down.

### Scored on actual results, not prices

The table above scores picks by the market's own closing line — expected
quality. It cannot detect the market being *wrong*, and it is partly circular:
myopic picks `argmax(closing line)` and is then scored by that same line, so it
tops the early buckets by construction.

So the same run also scores every pick by whether it **actually won**, over
2007–2025 (321 picks per strategy):

| strategy | overall | wk1–6 | wk7–12 | wk13–18 |
|---|---|---|---|---|
| myopic (λ=0) | 76.95% | **80.56%** | 74.56% | **75.76%** |
| greedy λ=0.5 | 78.88% | 78.90% | 75.44% | 82.83% |
| greedy λ=1 | 77.40% | 77.06% | 76.32% | 79.00% |
| optimal | **78.95%** | 76.15% | 78.07% | **83.00%** |

The shape matches the probability analysis and supports the intuition: **myopic
wins early (80.6%) and loses late (75.8%); saving reverses it, reaching 83.0%
in weeks 13–18.** A ~7-point late-season gap, ~2 points overall.

### Why that is suggestive, not proof

Each bucket holds ~107 picks at a ~78% base rate, so its standard error is
**4.0 points**. A 7-point gap is under two standard errors. Comparing only the
weeks where two strategies diverged (McNemar on discordant pairs) puts every
saving strategy ahead of myopic — 8 of 8 comparisons, consistent direction —
but not one reaches significance (p = 0.21 to 0.86; optimal vs myopic is 25–18,
p = 0.36).

The decisive tell is the **ORACLE** row, which sees future closing lines and is
therefore strictly better informed. On actual outcomes it finishes at 78.57%,
*below* plain optimal's 78.95%. That is impossible in expectation, so it is
measuring noise. If a strategy with perfect foresight cannot separate itself,
16–19 seasons cannot resolve differences of this size.

**Conclusion: λ cannot be settled from NFL history.** The direction is
consistent and matches theory, the magnitude is plausible, and the evidence is
not conclusive. The probability-based estimate remains the better guide, and
0.5–1.0 stays the defensible range.

### An unexpected result worth knowing

Greedy at λ=0.75 (79.10%) **beats the exact optimal assignment** (78.81%). That
is not a bug. "Optimal" is only optimal with respect to the forward estimates it
is given, and those estimates are noisy — committing to them fully is
overfitting. A moderate λ acts as regularisation: it takes the forward signal
seriously without believing it completely.

Caveat in the other direction: in production the forward numbers are market
lookahead lines rather than Elo, so the assignment is on firmer ground than this
backtest suggests. Treat the Plan tab as a strong guide, not gospel.

The **Horizon** control runs from 1 to 9 weeks and drives both views: the
Scorecard's PickLater window and the span the Plan solves over, capped by how
far the data reaches. Moving it reproduces the divergence above — planning
weeks 1–5 picks SEA in week 2, while planning weeks 1–9 picks SF, because only
the longer window can see Seattle's 85.2% spot in week 9.

## The Sources tab

The Scorecard collapses every feed into one blended number, which hides both
disagreement and staleness. The Sources tab does the opposite: one row per game,
one column per feed, across every week each feed reaches.

Coverage differs by source, and the table reflects that honestly:

- **ELWAY and ESPN** publish a multi-week lookahead, so both span the full range.
- **The Odds API** only ever returns the current round, so its column is blank
  for later weeks. That is the API's shape, not missing data.

The **Gap** column is ELWAY minus ESPN on the home side, flagged at 5 points.
`°` marks a single-book line; the Odds API column shows its book count.

**Refresh all sources** re-runs the ingests from the browser and reports each
one truthfully:

| Source | Behaviour |
|---|---|
| Schedule & results | runs `ingest:schedule` |
| ESPN | runs `ingest:odds:espn` |
| Odds API | skipped with "no key configured" unless `ODDS_API_KEY` is set |
| ELWAY | runs `ingest:silver:sheet` — all 272 games, no auth |

> `app/api/refresh/route.ts` executes local processes. Every command is a fixed
> string with no request data interpolated, and it is acceptable only because
> this app is single-user on localhost. If it is ever exposed (Phase 7), remove
> the route or put it behind real authentication.

## ELWAY ingest (automated)

The ELWAY embeds do not compute anything client-side — they read a **public
Google Sheets CSV export**. No cookie, no subscription check, no browser
automation. The paywall only ever hid *which sheet to read*, not the data.

```bash
npm run ingest:silver:sheet
```

```
https://docs.google.com/spreadsheets/d/1z7qxd50OSzoaJrInv7xyVUGAu1f_hJmrg8YmNmfp4KU/gviz/tq?tqx=out:csv&headers=1&sheet=Data
```

272 games, all 18 weeks. Columns:

```
week, home_sb_fran_id, pf_home, win_home, away_sb_fran_id, pf_away, win_away,
point_spread, total, neutral, extra
```

Three details that matter, all enforced in `lib/ingest/silver-sheet.ts`:

- **`win_home` + `win_away` do not sum to 100.** The remainder (0.26–0.75%
  across 2026) is the tie probability. Never derive one side from the other.
- **`sb_fran_id` uses `LAR`**, which must map to nflverse `LA` — the same
  single mismatch ESPN has. Handled by `normalizeTeamAbbr()`.
- **A renamed column aborts the ingest** rather than silently importing nulls.

### Vintage, not fetch time

The `_embed_metadata` tab exposes `updated_at` and `data_version`, stored as
`source_as_of` / `data_version`. This matters more than it sounds: on
2026-09-14 the live sheet was still stamped **2026-09-09** and had not priced
week 1, which is why ELWAY sat ~19 points below the market on teams that won
big. The Sources tab ages ELWAY by *that* timestamp, so it reads "5d ago"
rather than reporting the stalest feed as the freshest.

### Manual fallback

`npm run ingest:silver -- --from-file <file>` still works for hand-entered
numbers if the sheet is ever unshared or its ID rotates. See
`data/silver/TEMPLATE.txt`. A 120-game hand transcription was checked against
the sheet and matched all 240 values to within 0.05 points, so the manual path
and its validation are trustworthy.

## Silver is optional

The model runs on market data alone. Upload ELWAY numbers and they are folded
in automatically, governed by the Vegas/Silver slider — but only for the games
they cover. A team with no Silver number uses its Vegas probability unchanged,
and moving the slider does not affect it. Partially transcribed weeks are
therefore safe: half a week of ELWAY improves half the rows and distorts none.

The **Diff** column shows `Silver − Vegas` in points, signed, so a positive
number means Silver rates that team above the market. It is flagged with `!`
(and coloured) once the gap reaches the 5-point threshold.

## Loading Silver projections

Transcribe into a text file — **one line per team**, naming a team and *its*
win probability. A game normally contributes two lines.

```
week 2
KC 71.8
IND 27.9
```

### Why both sides, not `1 - p`

ELWAY is a win/loss/**tie** model, so for any game:

```
home% + away% + tie% = 100
```

The opponent therefore cannot be derived as `100 - p` — doing so would inflate
every opponent by that game's tie probability. Both sides are transcribed
independently, and the ingest checks that the pair implies a plausible tie
(−0.5% to 5%, allowing for rounding in the published figures).

If you enter only one side, that is accepted: the other team simply gets no
Silver number for that week, and the ingest names every one-sided game. It will
never invent the missing side.

> **Known approximation.** De-vigged Vegas probabilities are normalised to sum
> to 1.0 (a tie pushes a moneyline bet, so the two-way market excludes ties),
> while ELWAY's sum to `1 - tie`. The two sources are therefore on very slightly
> different scales — Vegas overstates by roughly the tie probability, a few
> tenths of a point. It is well inside the 5-point discrepancy threshold and
> affects all teams alike, so it does not move the ranking, but it is real.

`58`, `58.2`, `58%` and `0.582` are all accepted, as are full team names.

```bash
npm run ingest:silver -- --from-file data/silver/week2.txt --dry-run
npm run ingest:silver -- --from-file data/silver/week2.txt
```

Nothing is written unless every row passes validation:

- the team must actually play that week (a bye is rejected)
- if both sides of a game are given, they must imply a plausible tie
- probabilities outside ~5–95% are rejected as likely slips
- duplicates, unknown teams and entries before a `week N` heading are rejected

The dry run prints per-week coverage and names every missing game, so a
half-filled week is visible rather than silently degrading the model.

See `data/silver/TEMPLATE.txt`.

## Verification performed

- `npm test` — 30 tests green, including the deferral scenario (a team that is
  best *now* and far better *later* is correctly passed over for the runner-up)
  and a regression guard for the Silver-only forward window.
- Schedule ingest — 272 regular-season games, 32 teams, 18 weeks, 17 games each
  (one bye apiece). The script fails loudly if those invariants break.
- De-vig cross-check by hand, `2026_01_CLE_JAX` (−470 / +360):
  implied 0.824561 / 0.217391, 4.20% hold, de-vigged to
  **0.791361639824** / 0.208638360176, summing to exactly 1.0 and
  round-tripping back to −470 / +360.
- `npm run typecheck` — clean.
- UI verified end-to-end in a browser against a temporary synthetic fixture
  (since removed): a team holding the best current probability *and* a large
  future edge was correctly demoted from rank 1 to rank 7 and labelled SAVE,
  and returned to rank 1 when λ was dragged to 0. Recording a pick removed the
  team from the available set and correctly raised the top team's PickNow,
  because its nearest rival was gone.

## Where forward-week probabilities come from

`PickLater` — the opportunity-cost engine — operates over weeks N+1…N+4, so it
needs win probabilities for games that have not happened yet.

Two obvious sources **cannot** supply them:

- **The Odds API** publishes only the current round ("mirrors events that are
  listed by major bookmakers").
- **nflverse `games.csv`** carries 16 moneylines in week 1 of 2026 and zero in
  weeks 2–18.

But lookahead lines do exist in the market — those two sources just don't
expose them. **ESPN's scoreboard API publishes moneylines roughly eight weeks
ahead**, for every game:

```
site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard
  ?week=N&seasontype=2&dates=2026
```

No key, no auth. `npm run ingest:odds:espn` walks the weeks and de-vigs each
game. That is what makes the model work, and it means Silver is what the brief
originally said it was — a directional second opinion, not a dependency.

### Source quality is not uniform, and the model knows it

| Source | Coverage | Quality |
|---|---|---|
| `odds-api` | current round | median across ~10 US books |
| `espn` | ~8 weeks ahead | **single book** (DraftKings) |
| `nflverse` | current round | single closing line |

Every snapshot records its source, and `pickBestOdds()` chooses one per game by
**book count, then recency** — so the current week automatically prefers the
Odds API median over ESPN's DraftKings line, while lookahead weeks (where only
ESPN has data) still work. Ranking by book count rather than a hardcoded source
list keeps this correct if another feed is added.

There is a staleness guard: once the richer snapshot is more than 36 hours
behind the freshest one for that game, freshness wins instead. Without it, an
exhausted Odds API quota would leave a stale median preferred over live ESPN
lines for the rest of the season.

A `°` beside a Vegas number in the UI or CLI means it is a single-book line
rather than a median.

One visible consequence of single-book pricing: two games often share an
identical moneyline and de-vig to *identical* probabilities, producing exact
ties at the top of a future week. The model reads a tie as "no advantage to
saving either team", which is correct but partly an artifact of pricing
granularity — a ten-book median would rarely tie exactly.

## Other findings worth knowing

- **League chalk cannot inform your pick.** Yahoo reveals group picks only after
  the weekly deadline (default Sun 10:00 a.m. PT) — the same moment your own
  pick locks. The tracker in Phase 6 is therefore a historical/behavioural tool
  (burned teams, remaining pools, who spends strong teams early), not a live
  chalk feed. A public, no-auth page at
  `football.fantasysports.yahoo.com/survival/pickdistribution/?week=N` gives
  global chalk across all Yahoo players as a rough proxy.
- **ELWAY cannot be scraped, and it is not a paywall problem.** Investigated in
  full (`scripts/spikes/silver-spike.ts`):
  - Substack's JSON API is live on natesilver.net, but the post endpoint is
    `/api/v1/posts/<slug>` — *not* `/api/v1/posts/by-slug/<slug>`, which
    returns HTTP 200 with the HTML page shell and looks like an auth failure.
  - The per-game numbers are never in `body_html`. That field is 16,426 chars
    whether you are logged in or not. The projections live in a Substack **code
    embed** iframe on `<uuid>.substackcode.com`, and the paywall is enforced at
    the embed's render endpoint via a signed token, not in the post body.
  - That token is minted fresh on every post fetch and expires after **3600s**,
    so the embed URL can never be hardcoded — post and embed must be read in
    the same run. The token's claims (`viewer_role`, `viewer_id`) are the
    cleanest auth check; it is a 2-part `payload.signature` token, not a
    standard 3-part JWT.
  - Fetching the embed from Node fails with `ERR_SSL_WRONG_VERSION_NUMBER` even
    though DNS resolves — Cloudflare appears to reject Node's TLS fingerprint
    as non-browser. A real browser would likely get through; a scripted client
    does not.

  Hence projections are **transcribed by hand** each week and loaded through
  `npm run ingest:silver`. See "Loading Silver projections" below.
- **Team codes.** The schedule uses nflverse abbreviations: `LA` for the Rams
  (not `LAR`) and `WAS` for Washington (not `WSH`). `lib/ingest/team-map.ts`
  maps feed names onto these.

## Layout

```
lib/model/        pure model math, no I/O   <- the heart, fully unit-tested
lib/db/           drizzle schema + repo layer
lib/ingest/       csv parsing, team mapping, week detection
scripts/          ingest + scorecard CLIs
scripts/spikes/   Phase 0 investigations (need credentials)
test/             vitest suites
```

`lib/model/` has no database or network imports. That is deliberate: the math is
testable in isolation and the sources can change without touching it.

## Scheduling (Windows)

Once the ingests work, register them with Task Scheduler. Enable **"Run task as
soon as possible after a scheduled start is missed"** — this machine won't always
be awake at 06:00.

Suggested cadence: daily 06:00, plus Wed 20:00 (post-injury-report), Sat 10:00,
Sun 09:00 and Sun 11:30.

Credit cost is `markets x regions` per call. We request one market (`h2h`) in
one region (`us`), so each pull costs exactly 1 credit. The cadence above is 11
pulls/week, i.e. **~47 credits/month against the 500/month free tier** — under
10%, with plenty of headroom to poll harder on Sundays if you want it.
