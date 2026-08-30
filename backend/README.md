# Podcast Insights Backend (MVP)

Lightweight backend that serves analyst/podcast insights (player quotes, opinions,
breakout/risk calls) to the Draft Command Center frontend.

This is intentionally a **light build**: no audio transcription, no ListenNotes
polling, no Whisper API. Insights are hand-curated placeholder quotes seeded
into SQLite on first run. The API and schema are shaped so real transcription
can be swapped in later without changing the frontend contract.

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

## Frontend integration

The repo's `index.html` (the Draft Research Lab app) has an **Analyst Feed**
tab that talks to this backend directly, plus a **Backend URL** field on its
Setup tab (defaults to `http://localhost:3001`) to point it elsewhere. If the
backend is unreachable, the tab falls back to a small embedded sample so the
page still works standalone.

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
