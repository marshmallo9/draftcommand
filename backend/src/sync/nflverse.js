const { parse } = require('csv-parse/sync');

// nflverse publishes data as CSV/parquet assets attached to GitHub releases
// (one release "tag" per dataset, re-uploaded as the data updates) rather
// than a versioned API — see https://github.com/nflverse/nflverse-data.
// Exact asset filenames shift over time (e.g. a season suffix gets added or
// dropped), so instead of hardcoding a download URL, we ask the GitHub
// Releases API what's actually attached to the tag right now and pick the
// most plausible CSV from that list. That's slower than a hardcoded URL but
// doesn't silently 404 when nflverse renames a file.
const RELEASES_API = 'https://api.github.com/repos/nflverse/nflverse-data/releases/tags';

async function listReleaseAssets(tag) {
  const res = await fetch(`${RELEASES_API}/${tag}`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'draftcommand-sync' },
  });
  if (!res.ok) {
    throw new Error(`GitHub releases API responded ${res.status} for tag "${tag}" — nflverse may have renamed or removed it`);
  }
  const release = await res.json();
  return (release.assets || []).map(a => ({ name: a.name, url: a.browser_download_url }));
}

// Picks the asset most likely to be "this season's full CSV": prefers a
// .csv (not .parquet/.rds/.qs) containing the current season year, falls
// back to the newest-looking .csv, then to the first .csv, then null.
function pickCsvAsset(assets, season) {
  const csvs = assets.filter(a => a.name.toLowerCase().endsWith('.csv'));
  if (!csvs.length) return null;
  const withSeason = csvs.find(a => a.name.includes(String(season)));
  if (withSeason) return withSeason;
  const aggregate = csvs.find(a => !/\d{4}/.test(a.name)); // e.g. "player_stats.csv" with no year
  if (aggregate) return aggregate;
  return csvs.sort((a, b) => b.name.localeCompare(a.name))[0]; // best-effort "latest"
}

async function fetchCsvRows(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download ${url}: ${res.status} ${res.statusText}`);
  }
  const text = await res.text();
  return parse(text, { columns: true, skip_empty_lines: true });
}

// Returns raw rows, columns as nflverse ships them — we deliberately don't
// assume a fixed schema (see schema.sql's comment on season_stats_json).
async function fetchPlayerStats(season) {
  const assets = await listReleaseAssets('stats_player');
  const asset = pickCsvAsset(assets, season);
  if (!asset) throw new Error('No CSV asset found on the nflverse "stats_player" release');
  return fetchCsvRows(asset.url);
}

async function fetchInjuries(season) {
  const assets = await listReleaseAssets('injuries');
  const asset = pickCsvAsset(assets, season);
  if (!asset) throw new Error('No CSV asset found on the nflverse "injuries" release');
  return fetchCsvRows(asset.url);
}

// The full season schedule (all weeks, both played and future) — this is
// what bye weeks get derived from. nflverse's "schedules" release typically
// ships one CSV covering many seasons at once rather than per-season files,
// so pickCsvAsset's season-suffix matching often falls through to its
// no-year-in-filename fallback here, which is expected.
async function fetchSchedules(season) {
  const assets = await listReleaseAssets('schedules');
  const asset = pickCsvAsset(assets, season);
  if (!asset) throw new Error('No CSV asset found on the nflverse "schedules" release');
  return fetchCsvRows(asset.url);
}

module.exports = { listReleaseAssets, pickCsvAsset, fetchPlayerStats, fetchInjuries, fetchSchedules };
