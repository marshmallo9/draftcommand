const { run, get, all } = require('../db');
const { fetchSleeperPlayers } = require('./sleeper');
const { fetchPlayerStats, fetchInjuries, fetchSchedules } = require('./nflverse');
const { fetchConsensusRankings } = require('./fantasypros');
const { normalizeName } = require('./normalize');

const CURRENT_SEASON = new Date().getFullYear();

// FantasyPros' free tier has a real daily quota we don't know the exact
// number for (it's shown in the user's own dashboard, not the public docs).
// Default to one real call per ~day regardless — "week to week" insights
// were never a per-minute need — and make it configurable via env for
// whoever actually has the quota number in front of them.
const FANTASYPROS_COOLDOWN_HOURS = Number(process.env.FANTASYPROS_SYNC_COOLDOWN_HOURS) || 20;
const FANTASYPROS_SCORING = process.env.FANTASYPROS_SCORING || 'PPR';

async function getSyncMeta(key) {
  const row = await get('SELECT value FROM sync_meta WHERE key = ?', [key]);
  return row ? row.value : null;
}
async function setSyncMeta(key, value) {
  await run(
    `INSERT INTO sync_meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, value]
  );
}

// Best-effort pull of {yards, touchdowns} out of whatever columns an
// nflverse player_stats row actually has this season — column names have
// shifted before (e.g. receiving_yards vs rec_yards) and we'd rather sum
// what's there than assume one exact schema. Raw row is stored as-is
// regardless (see season_stats_json), this is just for the summary log.
function summarizeStatsRow(row) {
  const num = (v) => (v === undefined || v === '' ? 0 : Number(v) || 0);
  const yds = num(row.receiving_yards) + num(row.rushing_yards) + num(row.passing_yards);
  const td = num(row.receiving_tds) + num(row.rushing_tds) + num(row.passing_tds);
  return { yds, td };
}

async function syncSleeper() {
  const players = await fetchSleeperPlayers();
  const now = new Date().toISOString();
  for (const p of players) {
    await run(
      `INSERT INTO players (sleeper_id, name, normalized_name, pos, team, status, injury_status, search_rank, synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(sleeper_id) DO UPDATE SET
         name=excluded.name, normalized_name=excluded.normalized_name, pos=excluded.pos,
         team=excluded.team, status=excluded.status, injury_status=excluded.injury_status,
         search_rank=excluded.search_rank, synced_at=excluded.synced_at`,
      [p.sleeper_id, p.name, p.normalized_name, p.pos, p.team, p.status, p.injury_status, p.search_rank, now]
    );
  }
  return players.length;
}

async function syncNflversePlayerStats() {
  const rows = await fetchPlayerStats(CURRENT_SEASON);
  let matched = 0;
  for (const row of rows) {
    const rawName = row.player_display_name || row.player_name || row.full_name || row.name;
    if (!rawName) continue;
    const norm = normalizeName(rawName);
    const existing = await get('SELECT id FROM players WHERE normalized_name = ?', [norm]);
    if (!existing) continue;
    await run('UPDATE players SET season_stats_json = ? WHERE id = ?', [JSON.stringify(row), existing.id]);
    matched++;
  }
  return { total: rows.length, matched };
}

async function syncNflverseInjuries() {
  const rows = await fetchInjuries(CURRENT_SEASON);
  let matched = 0;
  for (const row of rows) {
    const rawName = row.full_name || row.player_name || row.gsis_name;
    if (!rawName) continue;
    const norm = normalizeName(rawName);
    const status = row.report_status || row.practice_status;
    if (!status) continue;
    // Sleeper's own injury_status is a live, current signal — only fill in
    // from the (weekly, point-in-time) nflverse injury report when Sleeper
    // didn't already have something.
    const res = await run(
      `UPDATE players SET injury_status = ? WHERE normalized_name = ? AND (injury_status IS NULL OR injury_status = '')`,
      [status, norm]
    );
    if (res.changes > 0) matched++;
  }
  return { total: rows.length, matched };
}

// Derives each team's bye week from the full schedule: the one week in the
// regular season where a team appears in no game. Column names for
// week/home_team/away_team/game_type have been stable in nflverse for a
// long time, but we still skip a team rather than guess if its data looks
// incomplete (0 or >1 missing weeks) — a wrong bye week is worse than a
// missing one.
function computeByeWeeks(scheduleRows) {
  const regRows = scheduleRows.filter(r => !('game_type' in r) || r.game_type === 'REG');
  const seasonRows = regRows.filter(r => !r.season || String(r.season) === String(CURRENT_SEASON));

  const weeksByTeam = {};
  let maxWeek = 0;
  for (const row of seasonRows) {
    const week = Number(row.week);
    if (!week) continue;
    maxWeek = Math.max(maxWeek, week);
    for (const team of [row.home_team, row.away_team]) {
      if (!team) continue;
      if (!weeksByTeam[team]) weeksByTeam[team] = new Set();
      weeksByTeam[team].add(week);
    }
  }

  const byeByTeam = {};
  for (const [team, weeksSet] of Object.entries(weeksByTeam)) {
    const missing = [];
    for (let w = 1; w <= maxWeek; w++) if (!weeksSet.has(w)) missing.push(w);
    if (missing.length === 1) byeByTeam[team] = missing[0];
  }
  return byeByTeam;
}

async function syncNflverseSchedules() {
  const rows = await fetchSchedules(CURRENT_SEASON);
  const byeByTeam = computeByeWeeks(rows);
  let playersUpdated = 0;
  for (const [team, week] of Object.entries(byeByTeam)) {
    const res = await run('UPDATE players SET bye_week = ? WHERE team = ?', [week, team]);
    playersUpdated += res.changes;
  }
  return { teamsResolved: Object.keys(byeByTeam).length, playersUpdated };
}

// One call, all positions at once (see fetchConsensusRankings), gated by a
// cooldown so a quota-limited key doesn't get burned by an accidental
// double-trigger of the sync button or a too-frequent cron schedule. Pass
// { force: true } to bypass the cooldown deliberately.
async function syncFantasyPros({ force = false } = {}) {
  const lastSyncedAt = await getSyncMeta('fantasypros_last_synced_at');
  if (!force && lastSyncedAt) {
    const hoursSince = (Date.now() - new Date(lastSyncedAt).getTime()) / 3600000;
    if (hoursSince < FANTASYPROS_COOLDOWN_HOURS) {
      return {
        skipped: true,
        reason: `cooldown active — last synced ${hoursSince.toFixed(1)}h ago, waiting until ${FANTASYPROS_COOLDOWN_HOURS}h (set FANTASYPROS_SYNC_COOLDOWN_HOURS to change, or pass force:true)`,
      };
    }
  }

  const rows = await fetchConsensusRankings({ season: CURRENT_SEASON, position: 'ALL', scoring: FANTASYPROS_SCORING });
  let matched = 0;
  for (const row of rows) {
    const rawName = row.player_name;
    if (!rawName) continue;
    const rankValue = row.rank_ecr ?? row.rank_ave ?? row.rank;
    if (rankValue == null) continue;
    const norm = normalizeName(rawName);
    const res = await run(
      'UPDATE players SET ecr_rank = ?, ecr_tier = ? WHERE normalized_name = ?',
      [Math.round(Number(rankValue)), row.tier ?? null, norm]
    );
    matched += res.changes;
  }

  await setSyncMeta('fantasypros_last_synced_at', new Date().toISOString());
  return { skipped: false, total: rows.length, matched };
}

// Runs every source independently — one failing (bad tag, network blip,
// nflverse renamed a file) never blocks the others or crashes the caller.
async function runSync(opts = {}) {
  const result = { startedAt: new Date().toISOString() };

  try {
    const count = await syncSleeper();
    result.sleeper = { ok: true, count };
  } catch (err) {
    result.sleeper = { ok: false, error: err.message };
  }

  try {
    const { total, matched } = await syncNflversePlayerStats();
    result.nflverseStats = { ok: true, total, matched };
  } catch (err) {
    result.nflverseStats = { ok: false, error: err.message };
  }

  try {
    const { total, matched } = await syncNflverseInjuries();
    result.nflverseInjuries = { ok: true, total, matched };
  } catch (err) {
    result.nflverseInjuries = { ok: false, error: err.message };
  }

  try {
    const { teamsResolved, playersUpdated } = await syncNflverseSchedules();
    result.nflverseSchedules = { ok: true, teamsResolved, playersUpdated };
  } catch (err) {
    result.nflverseSchedules = { ok: false, error: err.message };
  }

  try {
    const r = await syncFantasyPros({ force: opts.forceFantasyPros });
    result.fantasyPros = r.skipped
      ? { ok: true, skipped: true, reason: r.reason }
      : { ok: true, total: r.total, matched: r.matched };
  } catch (err) {
    result.fantasyPros = { ok: false, error: err.message };
  }

  const row = await get('SELECT COUNT(*) AS count FROM players');
  result.playersInDb = row.count;
  result.finishedAt = new Date().toISOString();
  return result;
}

module.exports = { runSync, summarizeStatsRow, computeByeWeeks, CURRENT_SEASON, FANTASYPROS_COOLDOWN_HOURS };
