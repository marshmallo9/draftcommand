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
