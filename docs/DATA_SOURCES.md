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

- Real player pool, position, team, and live injury status from Sleeper —
  flows into the AI Insights risk list automatically (a live signal now
  takes precedence over the hardcoded `SIGNAL_TAGS` seed data)
- Season stats from nflverse's `stats_player` release, matched to Sleeper
  players by normalized name, feeding the player-detail modal
- Bye weeks and full weekly matchup schedules, both derived from nflverse's
  full season schedule (see below)
- Rank is FantasyPros' real expert-consensus rank (ECR, aggregated across
  100+ analysts) when available, falling back to Sleeper's popularity-based
  `search_rank` for anyone FantasyPros doesn't cover

**Important caveat: unverified against live network.** This was built and
committed from a sandboxed session whose network policy blocks outbound
calls to `api.sleeper.app` and `api.github.com` (see PR discussion) — so the
DB schema, upsert logic, API responses, and frontend merge were all tested
end-to-end with synthetic data standing in for a real sync, but the actual
HTTP calls to Sleeper and nflverse have not been exercised. Before trusting
this:

```bash
cd backend
npm install
npm run sync            # runs scripts/sync-players.js once, prints a JSON summary + exit code
```

A clean run ends with `OK — N players in the database.` A source that fails
prints its own error under its own key in the JSON (`sleeper`,
`nflverseStats`, `nflverseInjuries`, `nflverseSchedules`, `fantasyPros`) —
most likely cause for an nflverse source is a renamed release asset
(`pickCsvAsset()` in `src/sync/nflverse.js` guesses at naming; adjust its
heuristic once you see what's actually attached to the relevant tag today),
for Sleeper a transient rate limit, and for FantasyPros either the key or
its quota — see the FantasyPros section below before assuming it's broken.

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
a real timestamp, not a mock. What's *not* verified is the actual response
shape from a real 200 — same caveat as Sleeper/nflverse, run `npm run sync`
for real before trusting the field names in `syncFantasyPros()`
(`player_name`, `rank_ecr`, `tier`) against what your key's calls actually
return.

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
Same untested-against-live-network caveat as the rest of this phase:
`computeByeWeeks()` and `computeTeamSchedules()` were both unit-tested
directly against synthetic schedule rows (regular-season filter, season
filter, gap/matchup logic, POST-season and wrong-season rows correctly
excluded) — the deriving logic is verified, the real CSV feeding it isn't.

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
