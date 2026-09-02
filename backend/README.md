# Draft Command Backend

Backend for the Draft Research Lab frontend: analyst/podcast insights (player
quotes, opinions, breakout/risk calls), and a real player pool synced from
Sleeper, nflverse, and FantasyPros.

Insights are still hand-curated placeholder quotes (light build — no audio
transcription yet, that's Phase 3). Player sync is real and live: Sleeper
for the player pool/position/team/injury status (falling back to nflverse's
own player crosswalk if Sleeper can't be reached), nflverse for season
stats, injuries, bye weeks and full weekly schedules, FantasyPros for a
real expert-consensus rank. All shaped so what's still open (real podcast
transcription) drops in later without changing the frontend contract — see
[`docs/DATA_SOURCES.md`](../docs/DATA_SOURCES.md).

The nflverse sources have actually been run against live data and produced
real output (real season stats, real 2026 bye weeks/schedules for all 32
teams) — see `docs/DATA_SOURCES.md` for specifics and two real bugs that
verification caught. Sleeper and FantasyPros have not: their hosts are
blocked by this project's own dev network policy, so only nflverse could
be exercised for real so far.

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
    "schedule_summary": "Week 1 @CLE, Week 2 vs BAL, Week 3 @PIT, Week 4 vs MIA, Week 5 @NYJ",
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

`bye_week` and `schedule_summary` are both `null` until that player's team
has been matched against a synced schedule — see
`src/sync/index.js#computeByeWeeks` / `#computeTeamSchedules`.
`schedule_summary` is the same `"Week N vs/@ OPP, ..."` string
`SEED_PLAYERS` already uses, so the frontend drops it straight into the
player modal's schedule panel.

### `POST /api/sync/players`

Pulls fresh data from Sleeper, nflverse, and (subject to its own cooldown)
FantasyPros, and upserts into the `players` table (see `src/sync/`).
Idempotent — safe to call repeatedly. Always responds `200` with a
per-source result, even if every source failed:

```json
{
  "sleeper": { "ok": false, "error": "..." },
  "nflversePlayersFallback": { "ok": true, "count": 4780 },
  "nflverseStats": { "ok": true, "season": 2025, "total": 2020, "matched": 470 },
  "nflverseInjuries": { "ok": true, "season": 2025, "total": 6068, "matched": 118 },
  "nflverseSchedules": { "ok": true, "teamsResolved": 32, "playersUpdated": 4713 },
  "fantasyPros": { "ok": true, "total": 400, "matched": 380 },
  "playersInDb": 4713
}
```
(a real run from this project's dev sandbox, where Sleeper is blocked —
`nflversePlayersFallback` only appears when `sleeper` fails; on a host
where Sleeper works, expect `sleeper: { ok: true, count: N }` and no
`nflversePlayersFallback` entry at all). `nflverseStats`/`nflverseInjuries`
report which `season` actually got used — they fall back a year if the
current season's file isn't published yet (e.g. before Week 1 stats exist).

If the FantasyPros cooldown hasn't elapsed, that entry looks like
`{ "ok": true, "skipped": true, "reason": "..." }` instead — still `ok`,
just didn't spend quota. Pass `?force=true` to bypass the cooldown
deliberately (`npm run sync:force` from the CLI).

No auth on this MVP endpoint. Either protect it before it's public-facing,
or only ever call it from a scheduled job (`npm run sync` /
`scripts/sync-players.js`) rather than exposing the route.

**Verification status differs by source.** The nflverse sources
(`nflversePlayersFallback`, `nflverseStats`, `nflverseInjuries`,
`nflverseSchedules`) have been run against the real internet mid-project
and produced real output — real season stats, real 2026 bye weeks and
schedules for all 32 teams — not just tested with synthetic data standing
in for a sync. That verification pass caught two real bugs (wrong file
granularity for season stats; injury status falling back to
practice-participation noise instead of a real game-status designation) —
see `docs/DATA_SOURCES.md` for both. **Sleeper and FantasyPros have not**
been exercised against their live APIs: both hosts are blocked by this
project's own dev network policy. The DB layer, upsert logic, API
responses, and (for FantasyPros) its cooldown state machine were verified
end-to-end with synthetic data and real timestamps standing in for those
two specifically. Run `npm run sync` once wherever this actually has
unrestricted internet access before fully trusting Sleeper/FantasyPros —
see `docs/DATA_SOURCES.md` for what a clean run looks like and how to
debug a source that fails.

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
