const { parse } = require('csv-parse/sync');

// Direct URL construction, matching nflreadr's own source exactly (verified
// against https://github.com/nflverse/nflreadr — R/load_stats.R,
// R/load_injuries.R, R/load_schedules.R) rather than discovering asset
// names through the GitHub Releases API. Two reasons this is the right
// call, not just a workaround:
//   1. It's what the canonical R client actually does — there's no
//      "discover the real filename" step to get wrong, because nflreadr
//      itself hardcodes these templates.
//   2. It never touches api.github.com, which several hosting/network
//      policies (including this project's own dev sandbox) block more
//      aggressively than plain github.com/raw.githubusercontent.com asset
//      downloads.
// "_reg_" = regular-season totals (one row per player) — what the app's
// "season stats" panel actually wants. The "_week_" variant nflreadr also
// offers is one row per player *per week*; fetching that here would mean
// each subsequent week's row silently overwrites the last as this file
// gets processed, leaving season_stats_json holding one arbitrary week's
// box score instead of a season total. Caught this by inspecting real
// data, not by reasoning about the file — worth remembering if this ever
// needs revisiting.
const STATS_URL = (season) =>
  `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_reg_${season}.csv`;
const INJURIES_URL = (season) =>
  `https://github.com/nflverse/nflverse-data/releases/download/injuries/injuries_${season}.csv`;
// The nflverse-maintained player ID crosswalk — one row per player,
// "single source of truth" per its own docs (name, position, latest_team,
// status, gsis_id, draft info). Used as a fallback player-identity source
// when Sleeper (the primary — richer live status, but occasionally blocked
// by stricter network policies) can't be reached, so the pool doesn't stay
// empty just because one source is unreachable.
const PLAYERS_URL = 'https://github.com/nflverse/nflverse-data/releases/download/players/players.csv';
// Schedules are NOT an nflverse-data release at all — nflreadr pulls a
// single all-seasons file from a sibling repo, nflverse/nfldata. Season
// filtering happens client-side (see sync/index.js), same as nflreadr does.
const SCHEDULES_URL = 'https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv';

async function fetchCsv(url) {
  const res = await fetch(url);
  if (!res.ok) {
    const err = new Error(`Failed to download ${url}: ${res.status} ${res.statusText}`);
    err.status = res.status;
    throw err;
  }
  const text = await res.text();
  return parse(text, { columns: true, skip_empty_lines: true });
}

// Early in a season (before the first week's stats/injury reports have been
// published — which, per nflreadr's own most_recent_season() boundary, can
// be true even after Labor Day if games genuinely haven't been played yet),
// the current season's file 404s. Fall back one season rather than erroring
// outright, same as asking for "the most recent stats we actually have."
async function fetchWithSeasonFallback(urlFor, season) {
  try {
    return { season, rows: await fetchCsv(urlFor(season)) };
  } catch (err) {
    if (err.status !== 404) throw err;
    const fallbackSeason = season - 1;
    return { season: fallbackSeason, rows: await fetchCsv(urlFor(fallbackSeason)) };
  }
}

async function fetchPlayerStats(season) {
  return fetchWithSeasonFallback(STATS_URL, season);
}

async function fetchInjuries(season) {
  return fetchWithSeasonFallback(INJURIES_URL, season);
}

// All seasons in one file — nflreadr does the same, filtering to specific
// seasons is left to the caller (see computeByeWeeks/computeTeamSchedules).
async function fetchSchedules() {
  return fetchCsv(SCHEDULES_URL);
}

async function fetchPlayers() {
  return fetchCsv(PLAYERS_URL);
}

module.exports = {
  fetchPlayerStats, fetchInjuries, fetchSchedules, fetchPlayers,
  STATS_URL, INJURIES_URL, SCHEDULES_URL, PLAYERS_URL,
};
