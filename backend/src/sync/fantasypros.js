// FantasyPros' real API — a paid-tier product with a free personal/
// non-commercial key. Docs: https://www.fantasypros.com/api-data/
//
// IMPORTANT — verified by documentation search, not by a live call (this
// session's network policy blocks fantasypros.com). Before trusting this in
// production, run it once for real and compare against what's logged below;
// see docs/DATA_SOURCES.md for what to check if the shape doesn't match.
const BASE_URL = 'https://api.fantasypros.com/public/v2/json';

const REQUEST_KEY_HELP =
  'FANTASYPROS_API_KEY is not set. Free personal/non-commercial keys: ' +
  'https://support.fantasypros.com/hc/en-us/articles/49749297704475-How-do-I-request-access-to-the-FantasyPros-API';

// One consensus-rankings call, all positions at once, rather than one call
// per position — the free tier's daily quota is the whole reason this
// module exists in the shape it does (see the cooldown gate in index.js),
// so every call here should count.
async function fetchConsensusRankings({ season, position = 'ALL', scoring = 'PPR' }) {
  const apiKey = process.env.FANTASYPROS_API_KEY;
  if (!apiKey) throw new Error(REQUEST_KEY_HELP);

  const url = `${BASE_URL}/nfl/${season}/consensus-rankings?position=${encodeURIComponent(position)}&scoring=${encodeURIComponent(scoring)}`;
  const res = await fetch(url, { headers: { 'x-api-key': apiKey } });
  if (!res.ok) {
    throw new Error(`FantasyPros API responded ${res.status} ${res.statusText} — check the key is active and hasn't hit its quota`);
  }
  const data = await res.json();
  if (!Array.isArray(data.players)) {
    throw new Error('FantasyPros response had no "players" array — the response shape may have changed, see the raw body in logs');
  }
  return data.players;
}

module.exports = { fetchConsensusRankings, BASE_URL, REQUEST_KEY_HELP };
