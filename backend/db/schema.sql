-- Analysts we're tracking (one row per analyst/podcast pairing)
CREATE TABLE IF NOT EXISTS analysts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  podcast TEXT NOT NULL,
  UNIQUE(name, podcast)
);

-- What they said about a given player
CREATE TABLE IF NOT EXISTS insights (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  analyst_id INTEGER NOT NULL REFERENCES analysts(id),
  player_name TEXT NOT NULL,
  position TEXT,
  quote TEXT NOT NULL,
  opinion TEXT,           -- e.g. "Breakout", "Avoid", "Value", "Elite", "Risk"
  date TEXT,              -- ISO date string
  timestamp TEXT,         -- placeholder mm:ss into the episode; null until real audio is wired up
  source_url TEXT         -- placeholder link to the episode; null for now
);

CREATE INDEX IF NOT EXISTS idx_insights_player ON insights(player_name);
CREATE INDEX IF NOT EXISTS idx_insights_position ON insights(position);

-- Real player pool, synced from external sources (see src/sync/).
-- Empty until POST /api/sync/players runs at least once — nothing
-- else in this schema depends on it being populated.
CREATE TABLE IF NOT EXISTS players (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sleeper_id TEXT UNIQUE,       -- Sleeper's player_id; our stable join key when Sleeper is reachable
  gsis_id TEXT,                 -- nflverse's player_id, set when a player came from (or was
                                 -- matched against) the nflverse players crosswalk instead —
                                 -- see src/sync/index.js#syncNflversePlayersFallback
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL, -- lowercased, punctuation/suffix-stripped, for best-effort joins across sources
  pos TEXT,
  team TEXT,
  status TEXT,                  -- Sleeper roster status, e.g. "Active", "Inactive"
  injury_status TEXT,           -- e.g. "Questionable", "Out", "IR" — null if healthy
  search_rank INTEGER,          -- Sleeper's search_rank: a popularity-based proxy for ADP,
                                 -- NOT an expert consensus rank. Used as the rank fallback for
                                 -- any player ecr_rank doesn't cover.
  ecr_rank INTEGER,             -- FantasyPros expert consensus rank (real draft rank, aggregated
                                 -- across 100+ analysts) — the primary rank once present.
  ecr_tier INTEGER,             -- FantasyPros tier for this player, if the API returned one.
  bye_week INTEGER,             -- derived from nflverse's schedules release (the one week a
                                 -- team appears in no game); null until that team's schedule
                                 -- has been matched, or if the gap couldn't be determined cleanly
  schedule_summary TEXT,        -- "Week 1 vs KC, Week 2 @DAL, ..." for the team's first 5 games —
                                 -- same string shape SEED_PLAYERS already uses, from nflverse's
                                 -- schedules release (see src/sync/index.js#computeTeamSchedules)
  season_stats_json TEXT,       -- raw matched row from nflverse player_stats, stored as-is
                                 -- (column names vary by season/source revision, so we don't
                                 -- assume a fixed shape — consumers read defensively)
  synced_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_players_pos ON players(pos);
CREATE INDEX IF NOT EXISTS idx_players_normalized_name ON players(normalized_name);

-- Small key/value store for sync bookkeeping — currently just the
-- FantasyPros cooldown timestamp (see src/sync/fantasypros.js). A real
-- table instead of a file so it survives the same way the rest of the
-- synced data does.
CREATE TABLE IF NOT EXISTS sync_meta (
  key TEXT PRIMARY KEY,
  value TEXT
);
