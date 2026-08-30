const express = require('express');
const { all } = require('../db');
const { runSync } = require('../sync');
const { summarizeStatsRow } = require('../sync');

const router = express.Router();

// GET /api/players?position=RB&team=CIN&search=chase
router.get('/players', async (req, res, next) => {
  try {
    const { position, team, search } = req.query;
    const clauses = [];
    const params = [];

    if (position) { clauses.push('pos = ?'); params.push(position); }
    if (team) { clauses.push('team = ?'); params.push(team); }
    if (search) { clauses.push('name LIKE ?'); params.push(`%${search}%`); }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = await all(
      `SELECT sleeper_id, name, pos, team, status, injury_status, search_rank, season_stats_json, synced_at
       FROM players ${where} ORDER BY search_rank ASC NULLS LAST, name ASC`,
      params
    );

    res.json(rows.map(r => {
      let stats = null;
      if (r.season_stats_json) {
        try {
          const parsed = JSON.parse(r.season_stats_json);
          stats = { ...summarizeStatsRow(parsed), raw: parsed };
        } catch { /* malformed cache entry — surface the player without stats rather than fail the request */ }
      }
      const { season_stats_json, ...rest } = r;
      return { ...rest, stats };
    }));
  } catch (err) {
    next(err);
  }
});

// POST /api/sync/players — pulls fresh data from Sleeper + nflverse and
// upserts into the players table. Safe to call repeatedly (idempotent
// upserts by sleeper_id / normalized_name). No auth on this MVP endpoint —
// before this is public-facing, either protect it or only invoke it from
// scripts/sync-players.js on a schedule (see docs/DATA_SOURCES.md).
router.post('/sync/players', async (req, res, next) => {
  try {
    const result = await runSync();
    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
