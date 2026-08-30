const { normalizeName } = require('./normalize');

// Sleeper's full NFL player map. Free, no auth, no query-string filtering —
// you get every player (including inactive/practice-squad/retired) and
// filter client-side. It's a large payload (several MB); Sleeper's own docs
// ask callers not to hit this more than once a day, which is exactly the
// cadence a "week to week" sync needs anyway.
// Docs: https://docs.sleeper.com/
const SLEEPER_PLAYERS_URL = 'https://api.sleeper.app/v1/players/nfl';

const FANTASY_POSITIONS = new Set(['QB', 'RB', 'WR', 'TE', 'K', 'DEF']);

async function fetchSleeperPlayers() {
  const res = await fetch(SLEEPER_PLAYERS_URL);
  if (!res.ok) {
    throw new Error(`Sleeper API responded ${res.status} ${res.statusText}`);
  }
  const raw = await res.json();

  const players = [];
  for (const sleeperId of Object.keys(raw)) {
    const p = raw[sleeperId];
    if (!p) continue;

    const pos = p.position || (p.fantasy_positions && p.fantasy_positions[0]);
    if (!pos || !FANTASY_POSITIONS.has(pos)) continue;

    const name = p.full_name || [p.first_name, p.last_name].filter(Boolean).join(' ');
    if (!name) continue;

    players.push({
      sleeper_id: sleeperId,
      name,
      normalized_name: normalizeName(name),
      pos,
      team: p.team || null,
      status: p.status || null,
      injury_status: p.injury_status || null,
      // Sleeper's own popularity-based ordering. It's a real, live signal —
      // just not an expert consensus rank like FantasyPros ECR/ADP. Treat
      // it as "roughly how relevant this player is right now", not a draft
      // ranking, until a real ECR source is wired in.
      search_rank: typeof p.search_rank === 'number' ? p.search_rank : null,
    });
  }
  return players;
}

module.exports = { fetchSleeperPlayers, SLEEPER_PLAYERS_URL };
