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

## Phase 2 — real rankings, ADP, stats & injuries (Sleeper + nflverse: built; FantasyPros: not yet)

The Sleeper and nflverse pieces of this are implemented — `backend/src/sync/`,
a `players` table, `GET /api/players`, `POST /api/sync/players`, and a
"Sync Players from API" button on the Setup tab that merges the result into
`state.players` the same way pasted rows already merge. What that gets you
today:

- Real player pool, position, team, and live injury status from Sleeper —
  flows into the AI Insights risk list automatically (a live signal now
  takes precedence over the hardcoded `SIGNAL_TAGS` seed data)
- Season stats from nflverse's `stats_player` release, matched to Sleeper
  players by normalized name, feeding the player-detail modal
- `search_rank` from Sleeper stands in for a real draft rank — it's a
  popularity-based ordering Sleeper computes, not an expert consensus rank
  or ADP. It's a real, live number, just not the right one long-term.

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
prints its own error under `sleeper` / `nflverseStats` / `nflverseInjuries`
in the JSON — most likely cause is nflverse having renamed a release asset
(`pickCsvAsset()` in `src/sync/nflverse.js` guesses at naming; adjust its
heuristic once you see what's actually attached to the `stats_player` /
`injuries` tags today) or a transient GitHub/Sleeper rate limit.

**Still to build — a real expert-consensus rank:**

| Source | What it gives you | Access |
|---|---|---|
| [FantasyPros API](https://www.fantasypros.com/api-data/) | Expert-consensus rankings (ECR), ADP, and tiers aggregated from 130+ analysts — the actual "Boris Chen Tiers" experience, sourced, and a real replacement for `search_rank` | Free personal-use key on request ([how to request](https://support.fantasypros.com/hc/en-us/articles/49749297704475-How-do-I-request-access-to-the-FantasyPros-API)); commercial tier for production volume |
| [ESPN's undocumented fantasy API](https://github.com/pseudo-r/Public-ESPN-API) | Rankings/projections matching what "ESPN Field Yates" already cites in the app | Free, unofficial, no auth — can change without notice, treat as best-effort |

**Plan:** add `src/sync/fantasypros.js` alongside the existing `sleeper.js`/
`nflverse.js`, wire it into `runSync()` the same way (independent try/catch,
its own row in the sync result), and add a `rank` column to `players` sourced
from FantasyPros ECR — with `search_rank` as the fallback for any player
FantasyPros doesn't cover. `syncPlayersFromAPI()` on the frontend already
reads whatever `rank` comes back; nothing there needs to change.

**Bye weeks — built.** `src/sync/nflverse.js#fetchSchedules` +
`src/sync/index.js#computeByeWeeks` derive each team's bye from the full
season schedule (the one week a team appears in no game) and write it to
`players.bye_week`, same untested-against-live-network caveat as everything
else in this phase. `computeByeWeeks()` itself is a pure function and *was*
unit-tested directly with synthetic schedule rows — the deriving logic is
verified, just not the real CSV feeding it.

**Still not synced:** full weekly matchups (the player modal's "2026
Schedule" panel) — nflverse has this too, just not wired up. New players
added by sync get a placeholder string there until that's built; existing
seed players keep their hardcoded schedule text.

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
