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

## Phase 2 — real rankings, ADP, stats & injuries

Replaces the hardcoded `SEED_PLAYERS` table (rank/stats/schedule baked into
the HTML) with a nightly sync job in `backend/` that pulls from:

| Source | What it gives you | Access |
|---|---|---|
| [Sleeper API](https://docs.sleeper.com/) | Full NFL player pool with IDs, positions, injury status, and trending adds/drops (`/v1/players/nfl`, `/v1/players/nfl/trending/add`) | Free, no auth, no key. Rate-limited (~1000 req/min) — [guide](https://zuplo.com/learning-center/sleeper-api) |
| [nflverse](https://github.com/nflverse/nflreadpy) (`nflreadpy`, successor to `nfl_data_py`) | Weekly/seasonal stats, injury reports (`import_injuries`), depth charts, schedules, rosters — everything the player modal's "2025 Stats" and "2026 Schedule" panels currently fake | Free, open-source, no key |
| [FantasyPros API](https://www.fantasypros.com/api-data/) | Expert-consensus rankings (ECR), ADP, and tiers aggregated from 130+ analysts — the actual "Boris Chen Tiers" experience, sourced | Free personal-use key on request ([how to request](https://support.fantasypros.com/hc/en-us/articles/49749297704475-How-do-I-request-access-to-the-FantasyPros-API)); commercial tier for production volume |
| [ESPN's undocumented fantasy API](https://github.com/pseudo-r/Public-ESPN-API) | Rankings/projections matching what "ESPN Field Yates" already cites in the app | Free, unofficial, no auth — can change without notice, treat as best-effort |

**Plan:** a scheduled job in `backend/` (cron, e.g. nightly) pulls Sleeper +
nflverse + FantasyPros, normalizes into the existing player shape
(`name, pos, team, rank, bye, stats2025, schedule2026`), and exposes it at a
new `GET /api/players` endpoint. The frontend's "Parse & Merge" import flow
already knows how to merge a player list by name — point it at the API
response instead of a pasted textarea, and the manual sync becomes optional
rather than the only path.

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

## What this needs from you before Phase 2/3 can start

- A FantasyPros API key (free — [request form](https://support.fantasypros.com/hc/en-us/articles/49749297704475-How-do-I-request-access-to-the-FantasyPros-API))
- A ListenNotes account/API key, and a decision on Whisper vs. a pay-per-hour
  transcription vendor
- Where `backend/` actually runs day-to-day (so the sync job has somewhere to
  live on a schedule) — Railway/Render both support cron-style scheduled jobs
  alongside a web service

Until those are in place, the app keeps working exactly as it does today —
Phase 1 has no dependency on any of this.
