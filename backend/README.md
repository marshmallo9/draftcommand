# Draft Command Backend

Backend for the Draft Research Lab frontend: analyst/podcast insights (player
quotes, opinions, breakout/risk calls), and a real player pool synced from
Sleeper, nflverse, and FantasyPros.

Insights are still hand-curated placeholder quotes (light build — no audio
transcription yet, that's Phase 3). Player sync is real and live: Sleeper
for the player pool/position/team/injury status, nflverse for season stats
and bye weeks, FantasyPros for a real expert-consensus rank. All shaped so
what's still open (real podcast transcription) drops in later without
changing the frontend contract — see
[`docs/DATA_SOURCES.md`](../docs/DATA_SOURCES.md).

**FantasyPros requires an API key** (`FANTASYPROS_API_KEY` in `.env` — see
`.env.example`). It's a free key for personal/non-commercial use with a real
daily quota FantasyPros doesn't publish (check your own dashboard). The sync
gates every FantasyPros call behind a cooldown for exactly this reason — see
`docs/DATA_SOURCES.md`'s FantasyPros section before changing
`FANTASYPROS_SYNC_COOLDOWN_HOURS` or calling `npm run sync:force`. **Never
commit a real key** — `.env` is gitignored; on a real host it goes in that
host's environment variable settings, not a file in this repo.

## Stack

- Node.js + Express
- SQLite (file-based, zero setup — created automatically on first run)

## Setup

```bash
cd backend
npm install
cp .env.example .env   # optional, defaults work out of the box
npm start
```

The server listens on `http://localhost:3001` by default (`PORT` in `.env`).

On first run it creates `db/draft-insights.db`, applies `db/schema.sql`, and
seeds it from `src/data/insights-mock.json` (only if the `insights` table is
empty, so restarts don't duplicate rows).

## API

### `GET /api/insights`

Returns analyst insights, optionally filtered.

Query params (all optional, combinable):

| Param      | Description                                  |
|------------|-----------------------------------------------|
| `player`   | Substring match on player name                |
| `position` | Exact match, e.g. `RB`, `WR`, `TE`, `QB`       |
| `analyst`  | Substring match on analyst name                |

```bash
curl "http://localhost:3001/api/insights?player=Chase&position=RB"
```

```json
[
  {
    "id": 1,
    "analyst": "Fantasy Footballers",
    "podcast": "The Fantasy Footballers Podcast",
    "player": "Chase Brown",
    "position": "RB",
    "opinion": "Breakout",
    "quote": "Chase Brown is going to have a huge year. The Bengals are committing to the run game.",
    "date": "2024-09-05",
    "timestamp": "12:34",
    "source_url": null
  }
]
```

`timestamp` and `source_url` are placeholders for now — they'll point at the
real episode moment once audio ingestion is wired up.

### `GET /api/analysts`

Lists the distinct analysts currently tracked, with their podcast and how many
insights are on file for them.

### `GET /health`

Simple liveness check, returns `{ "status": "ok" }`.

### `GET /api/players`

Returns the synced player pool. Empty until a sync has run at least once.

Query params (all optional, combinable): `position` (exact, e.g. `RB`), `team`
(exact, e.g. `CIN`), `search` (substring on name).

```json
[
  {
    "sleeper_id": "4034",
    "name": "Ja'Marr Chase",
    "pos": "WR",
    "team": "CIN",
    "status": "Active",
    "injury_status": null,
    "search_rank": 5,
    "ecr_rank": 2,
    "ecr_tier": 1,
    "bye_week": 10,
    "synced_at": "2026-08-30T19:59:17.502Z",
    "stats": { "yds": 1780, "td": 17, "raw": { "...": "whatever nflverse's row actually had" } },
    "rank": 2
  }
]
```

`rank` is `ecr_rank ?? search_rank` — FantasyPros' real expert-consensus
rank when we have it, Sleeper's popularity-based ordering as the fallback
for anyone FantasyPros doesn't cover. Everything downstream should read
`rank`, not `ecr_rank`/`search_rank` directly.

`bye_week` is `null` until that player's team has been matched against a
synced schedule — see `src/sync/index.js#computeByeWeeks`.

### `POST /api/sync/players`

Pulls fresh data from Sleeper, nflverse, and (subject to its own cooldown)
FantasyPros, and upserts into the `players` table (see `src/sync/`).
Idempotent — safe to call repeatedly. Always responds `200` with a
per-source result, even if every source failed:

```json
{
  "sleeper": { "ok": true, "count": 2841 },
  "nflverseStats": { "ok": true, "total": 4102, "matched": 2390 },
  "nflverseInjuries": { "ok": true, "total": 88, "matched": 12 },
  "nflverseSchedules": { "ok": true, "teamsResolved": 32, "playersUpdated": 2841 },
  "fantasyPros": { "ok": true, "total": 400, "matched": 380 },
  "playersInDb": 2841
}
```

If the FantasyPros cooldown hasn't elapsed, that entry looks like
`{ "ok": true, "skipped": true, "reason": "..." }` instead — still `ok`,
just didn't spend quota. Pass `?force=true` to bypass the cooldown
deliberately (`npm run sync:force` from the CLI).

No auth on this MVP endpoint. Either protect it before it's public-facing,
or only ever call it from a scheduled job (`npm run sync` /
`scripts/sync-players.js`) rather than exposing the route.

**This has not been exercised against the live Sleeper/nflverse/FantasyPros
APIs** — it was built in a sandboxed session whose network policy blocks
those hosts. The DB layer, upsert logic, API responses, and (for
FantasyPros specifically) the entire cooldown state machine were verified
end-to-end with synthetic data and real timestamps standing in for a real
sync; the actual HTTP calls haven't been. Run `npm run sync` once wherever
this actually has internet access before trusting it — see
`docs/DATA_SOURCES.md` for what a clean run looks like and how to debug a
source that fails.

## Frontend integration

The repo's `index.html` (the Draft Research Lab app) has an **Analyst Feed**
tab that talks to this backend directly, and a **Setup** tab with a
**Backend URL** field (defaults to `http://localhost:3001`) plus a
**Sync Players from API** button that calls `POST /api/sync/players` then
merges `GET /api/players` into the app's player pool. If the backend is
unreachable, the Analyst Feed tab falls back to a small embedded sample so
the page still works standalone; the sync button just reports the failure.

## Swapping mock data for something real

See [`docs/DATA_SOURCES.md`](../docs/DATA_SOURCES.md) for a sourced roadmap —
real rankings/stats via Sleeper, nflverse and FantasyPros, and real podcast
ingestion via ListenNotes + transcription + Claude extraction — that plugs
into this same schema and API contract.

Everything downstream of `src/data/insights-mock.json` only cares about the
shape of that JSON. To replace it with real data:

1. Delete `db/draft-insights.db` so the seed runs again (or write a proper
   migration once this stops being an MVP).
2. Replace the loader in `src/db.js#seedFromMockIfEmpty` with your real
   ingestion pipeline (ListenNotes → Whisper → Claude extraction → insert).
3. The `/api/insights` and `/api/analysts` routes don't need to change.

## Deploying

No native build steps beyond `npm install` (sqlite3 ships prebuilt binaries
for common platforms). Works as-is on Railway, Render, Fly.io, or any Node
host — just set `PORT` and `CORS_ORIGIN` (comma-free single origin, or `*`
for now) via environment variables.
