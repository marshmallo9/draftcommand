# Data Sourcing Roadmap

The app is a static, self-contained HTML file — as the Setup tab already notes,
a browser can't live-scrape most sites (CORS blocks it), which is why rankings
sync today is copy/paste. The `backend/` service exists to lift that
restriction: it's ours, so it sets its own CORS headers, and anything it
fetches server-side (no browser CORS rules apply) can be exposed to the page
over a clean JSON API — exactly what it already does for analyst insights.

This doc lays out the real sources to plug into that backend, in the order
they're worth building.

## Phase 1 — done

Analyst insights served from `backend/` (Express + SQLite), seeded with
hand-picked placeholder quotes. See `backend/README.md`. The Analyst Feed tab
already talks to this over `GET /api/insights`.

## Phase 2 — real rankings, ADP, stats, injuries, bye weeks & schedules — built

Sleeper, nflverse, and FantasyPros are all implemented — `backend/src/sync/`,
a `players` table, `GET /api/players`, `POST /api/sync/players`, and a
"Sync Players from API" button on the Setup tab that merges the result into
`state.players` the same way pasted rows already merge. What that gets you
today:

- Real player pool, position, team from Sleeper (primary) or, when Sleeper
  can't be reached, from nflverse's own player crosswalk instead (see
  below) — either way live injury status flows into the AI Insights risk
  list automatically, taking precedence over the hardcoded `SIGNAL_TAGS`
  seed data
- Season stats from nflverse, matched by normalized name, feeding the
  player-detail modal
- Bye weeks and full weekly matchup schedules, both derived from the real
  season schedule (see below)
- Rank is FantasyPros' real expert-consensus rank (ECR, aggregated across
  100+ analysts) when available, falling back to Sleeper's popularity-based
  `search_rank` for anyone FantasyPros doesn't cover

### nflverse sources — verified against real, live data

Unlike the rest of this project, the nflverse portion of Phase 2 (stats,
injuries, schedules, and the player-crosswalk fallback below) is **not**
resting on a "should work, couldn't test it" caveat — it was actually run
against the live internet mid-session and produced real output: 4,780 real
active players, real 2025 season stat lines (e.g. Chase Brown: 1,019
rushing yards, 6 rushing TDs — matches his real season), real bye weeks and
full 2026 schedules for all 32 teams, all flowing correctly through to the
Explorer table and player modal in a headless-browser check. `Sleeper` and
`FantasyPros` remain genuinely unverified — see their own sections below —
this verification is nflverse-only.

Getting there involved cloning `nflverse/nflreadr`'s actual R source (the
canonical client) to read its real download-URL templates, rather than
continuing to guess — and that surfaced two real bugs that would otherwise
have shipped:

1. **`fetchPlayerStats` was pointed at the wrong file.** nflreadr's
   `stats_player` release has both a `_week_` variant (one row per player
   *per week*) and a `_reg_` variant (one row per player, season totals).
   The original code fetched `_week_`, and since the sync loop just
   `UPDATE`s the same row for every match it finds, `season_stats_json`
   ended up holding whichever week happened to be processed last — not a
   season total. Fixed by switching to `_reg_`, which is what the app's
   "season stats" panel actually means.
2. **Injury status was falling back to practice-participation noise.** The
   injuries file's `report_status` (Out/Questionable/Doubtful) is the real
   game-status designation; `practice_status` ("Full Participation in
   Practice") is logged for most players most weeks even when perfectly
   healthy. The original fallback (`report_status || practice_status`)
   meant routinely-healthy players could get tagged as an injury "risk".
   Fixed to use `report_status` only, and to take each player's *latest*
   week rather than whichever the weekly file happened to list first.

Also corrected: **schedules were never an nflverse-data release at all.**
nflreadr pulls them from a sibling repo, `nflverse/nfldata`, as a single
plain CSV (`raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv`)
covering every season — not a GitHub Release asset. The original
`fetchSchedules()` guessed at a `"schedules"` release tag on
`nflverse-data` that doesn't exist. `src/sync/nflverse.js` now points at
the real source.

One practical side effect worth knowing: `api.github.com` (the Releases
*API*, used to discover asset names) is blocked by stricter network
policies more often than the plain asset-download host
(`github.com/.../releases/download/...`) or `raw.githubusercontent.com`.
Since nflreadr never uses the Releases API at all — it constructs
download URLs directly from a known, stable naming convention — neither
does this code anymore. That's not a workaround, it's just correct: it's
what the canonical client actually does, and it happens to also be more
portable across restrictive network policies.

**New: `nflversePlayersFallback`.** When Sleeper can't be reached, the pool
would otherwise stay empty — everything else (stats, injuries, schedules)
matches against player rows that were never created. `src/sync/nflverse.js
#fetchPlayers()` pulls nflverse's own player-ID crosswalk
(`.../releases/download/players/players.csv` — "the single source of
truth" per its own docs) as a real, current fallback identity source:
active players (`status === 'ACT'`) at fantasy-relevant positions, with
real position/team. It never overwrites a Sleeper-sourced row — only fills
in when Sleeper genuinely didn't provide one — and only runs at all when
`syncSleeper()` throws. A run against live data in this project's own
dev sandbox (where Sleeper is blocked) populated 4,780 real players this
way, of which 4,713 ended up with a resolved bye week/schedule and ~470–500
with matched season stats/injury data.

```bash
cd backend
npm install
npm run sync            # runs scripts/sync-players.js once, prints a JSON summary + exit code
```

A clean run ends with `OK — N players in the database.` A source that fails
prints its own error under its own key in the JSON (`sleeper`,
`nflversePlayersFallback`, `nflverseStats`, `nflverseInjuries`,
`nflverseSchedules`, `fantasyPros`) — for Sleeper/FantasyPros, that's most
likely their host being blocked by your network policy (see their sections
below) or a real key/quota problem; the nflverse sources should now
reliably succeed anywhere with normal internet access, since they're
verified against the exact real files.

**FantasyPros ECR — built.** `src/sync/fantasypros.js` calls
`GET /nfl/{season}/consensus-rankings` (`x-api-key` header, `position=ALL`
so it's one call for the whole player pool rather than one per position)
and writes `ecr_rank`/`ecr_tier` onto `players`. `GET /api/players` exposes
a single `rank` field that's `ecr_rank ?? search_rank`, so nothing
downstream (the frontend merge, the player-detail modal) has to know which
source actually supplied it.

⚠️ **Two things about this specific key that matter more than the others:**

1. **Free tier is personal/non-commercial use only.** This app cannot
   monetize, resell, or redistribute FantasyPros-derived data — that's a
   term of the free key, not a preference. Fine for a self-hosted draft
   tool; stop and re-check the terms before this app is anyone's product.
2. **The daily quota is real and not documented publicly** — it's shown in
   your FantasyPros account dashboard, not in the API docs. `src/sync/
   index.js` gates every FantasyPros call behind a cooldown
   (`FANTASYPROS_SYNC_COOLDOWN_HOURS`, default 20h — effectively "once a
   day") stored in a `sync_meta` table, independent of how often
   `POST /api/sync/players` itself gets called (the sync button, a cron
   job, testing — none of them burn quota if the cooldown hasn't elapsed).
   A failed attempt does **not** start the cooldown, so a transient error
   doesn't lock you out until tomorrow. Pass `force: true`
   (`POST /api/sync/players?force=true`, or `npm run sync:force`) to
   deliberately bypass it — check your actual quota number first.

**Verified without spending real quota:** the request construction (URL,
`x-api-key` header), the missing-key error, and the entire cooldown state
machine (skip when fresh, bypass with `force`, a failed attempt not
starting the clock) were all exercised directly — the last of those against
a real timestamp, not a mock; the request itself was confirmed to actually
attempt with a placeholder key, hitting a network block rather than
erroring before that point. What's *not* verified — and, unlike nflverse
above, still isn't — is the actual response shape from a real 200:
`api.fantasypros.com` is blocked by the same network policy that blocks
Sleeper, so there was no live host to test this against even after finding
one for nflverse. Run `npm run sync` for real before trusting the field
names in `syncFantasyPros()` (`player_name`, `rank_ecr`, `tier`) against
what your key's calls actually return.

**Still open:** ESPN's undocumented fantasy API
([community docs](https://github.com/pseudo-r/Public-ESPN-API)) as a
second/backup rankings source — not needed now that FantasyPros ECR is
live, but free and worth having as a fallback if a FantasyPros call fails
or the quota is exhausted for the day.

### Making the sync actually visible

The first pass of Phase 2 had a real gap: `ecr_rank`/`ecr_tier` landed in
the database and the API response, but nothing in the UI showed a
FantasyPros rank was any different from a hardcoded seed rank or Sleeper's
`search_rank` — a successful sync just quietly moved a number. Fixed:

- Every player's rank shows a small source badge in Explorer
  (<span style="color:#3ECF8E">ECR</span> / <span style="color:#4DB8D8">SLP</span>,
  gold for demo data) and the player-detail modal names the source and the
  FantasyPros tier explicitly (`rankSourceLabel()` / `rankSourceBadge()` in
  `index.html`)
- `withTiers()` uses a player's real `ecrTier` instead of the app's
  rank-gap heuristic whenever one is present — so a successful FantasyPros
  sync visibly changes the Tiers & Scarcity tab, not just a number in
  Explorer
- **"Sync Players from API" now always does something visible**, even with
  no backend reachable at all (e.g. the standalone artifact demo, or before
  you've ever run a real sync): it falls back to `DEMO_SYNCED_PLAYERS`, a
  small hardcoded sample using existing seed-data names with different
  rank/tier values, clearly labeled everywhere as demo (gold `ECR·demo`
  badges, `[Demo]` in the status line, called out in `lastSynced`) — same
  fallback philosophy the Analyst Feed already used for insights, now
  applied consistently to the other sync path
- The sync status line now calls out FantasyPros specifically —
  `N got a real FantasyPros rank`, `FantasyPros ECR skipped (cooldown)`, or
  its own error — instead of lumping it into one generic "some sources
  failed" message

If you run a real sync and still don't see ECR badges, that's the real
signal something's wrong (bad key, quota exhausted, response shape
changed) — check the `fantasyPros` entry in the sync JSON before assuming
the UI is the problem.

**Bye weeks and full weekly matchups — both built.**
`src/sync/nflverse.js#fetchSchedules` feeds two pure, independently
unit-tested functions in `src/sync/index.js`:

- `computeByeWeeks()` — the one week a team appears in no game
- `computeTeamSchedules()` — each team's first 5 games, formatted as
  `"Week 1 vs KC, Week 2 @DAL, ..."` — the exact string shape
  `SEED_PLAYERS` already used for `schedule2026`, so a synced value drops
  into the player modal's "2026 Schedule" panel with zero format
  translation needed

Both write onto `players` (`bye_week`, `schedule_summary`) in one pass over
the same schedule fetch — `syncNflverseSchedules()` doesn't fetch twice.
`computeByeWeeks()` and `computeTeamSchedules()` were first unit-tested
directly against synthetic schedule rows (regular-season filter, season
filter, gap/matchup logic, POST-season and wrong-season rows correctly
excluded), then re-verified against the real 2026 schedule — see
"nflverse sources — verified against real, live data" above. All 32 teams
resolved a real bye week and a real 5-week schedule; e.g. Cincinnati's real
2026 bye is week 6, matching what a real 2026 schedule says.

This closes out Phase 2 — every "still not synced" item from earlier in
this doc is now built. What's left below (Phase 3) needs your input to
start.

## Phase 3 — real podcast ingestion ("week to week" insights)

This is the actual ask behind the Analyst Feed tab: real analyst quotes,
refreshed weekly, instead of the eight placeholder rows.

1. **Discover episodes** — [ListenNotes API](https://www.listennotes.com/api/pricing/)
   searches ~3.8M podcasts / ~190M episodes and can target specific shows
   (Fantasy Footballers, FantasyPros Podcast, etc.) by RSS feed or search.
   Free tier for development; production pricing starts around $180/mo at
   moderate volume.
2. **Transcribe** — ListenNotes indexes metadata, not audio content, so a
   transcription step is still needed: OpenAI's Whisper API, or a
   pay-as-you-go service like [Listen411](https://www.listennotes.help/article/35-how-to-get-transcripts-of-any-podcast-episodes-using-podcast-api)
   (~$4.60/hour of audio, no subscription).
3. **Extract** — feed each transcript to the Claude API, prompted to pull out
   player mentions, the analyst's stance (breakout / risk / value / avoid /
   elite), a representative quote, and a timestamp. This maps directly onto
   the `insights` table already in `backend/db/schema.sql`
   (`player_name, opinion, quote, timestamp, source_url` are already there
   and already `null`-safe for exactly this).
4. **Schedule** — run steps 1–3 weekly (new episodes drop on a predictable
   cadence for most fantasy shows), insert into `insights`, and the existing
   `/api/insights` endpoint and Analyst Feed tab need no changes at all.

## What Phase 3 still needs from you

- A ListenNotes account/API key, and a decision on Whisper vs. a pay-per-hour
  transcription vendor
- Where `backend/` actually runs day-to-day (so the sync job has somewhere to
  live on a schedule) — Railway/Render both support cron-style scheduled jobs
  alongside a web service; the same host should carry `FANTASYPROS_API_KEY`
  and the other `FANTASYPROS_*` env vars from `backend/.env.example` — never
  commit the real key, it goes in the host's environment variable settings

Phase 2 (Sleeper + nflverse + FantasyPros) is done and has no further
dependency on you beyond the key you've already provided. Phase 1 has no
dependency on any of this at all — the app keeps working exactly as it
does today either way.
