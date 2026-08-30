const express = require('express');
const { all } = require('../db');

const router = express.Router();

// GET /api/insights?player=Chase+Brown&position=RB&analyst=Boris+Chen
router.get('/insights', async (req, res, next) => {
  try {
    const { player, position, analyst } = req.query;

    const clauses = [];
    const params = [];

    if (player) {
      clauses.push('i.player_name LIKE ?');
      params.push(`%${player}%`);
    }
    if (position) {
      clauses.push('i.position = ?');
      params.push(position);
    }
    if (analyst) {
      clauses.push('a.name LIKE ?');
      params.push(`%${analyst}%`);
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    const rows = await all(
      `SELECT
         i.id,
         a.name AS analyst,
         a.podcast AS podcast,
         i.player_name AS player,
         i.position,
         i.opinion,
         i.quote,
         i.date,
         i.timestamp,
         i.source_url
       FROM insights i
       JOIN analysts a ON a.id = i.analyst_id
       ${where}
       ORDER BY i.date DESC, i.id DESC`,
      params
    );

    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// GET /api/analysts - list unique analysts (with their podcast)
router.get('/analysts', async (req, res, next) => {
  try {
    const rows = await all(
      `SELECT name, podcast, COUNT(*) AS insight_count
       FROM analysts a
       JOIN insights i ON i.analyst_id = a.id
       GROUP BY a.id
       ORDER BY name ASC`
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
