const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'db', 'draft-insights.db');
const SCHEMA_PATH = path.join(__dirname, '..', 'db', 'schema.sql');
const MOCK_DATA_PATH = path.join(__dirname, 'data', 'insights-mock.json');

// Make sure the db/ directory exists (sqlite3 won't create it for us).
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new sqlite3.Database(DB_PATH);

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this); // this.lastID / this.changes
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

async function applySchema() {
  const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
  await new Promise((resolve, reject) => {
    db.exec(schema, (err) => (err ? reject(err) : resolve()));
  });
}

// Seed the database from the mock JSON file, but only if it's empty.
// This keeps the mock file as the single source of truth for the MVP
// while still exercising the real SQLite schema/query path.
async function seedFromMockIfEmpty() {
  const { count } = await get('SELECT COUNT(*) AS count FROM insights');
  if (count > 0) return;

  const raw = fs.readFileSync(MOCK_DATA_PATH, 'utf8');
  const { insights } = JSON.parse(raw);

  for (const item of insights) {
    await run(
      `INSERT INTO analysts (name, podcast)
       VALUES (?, ?)
       ON CONFLICT(name, podcast) DO NOTHING`,
      [item.analyst, item.podcast]
    );
    const analystRow = await get(
      'SELECT id FROM analysts WHERE name = ? AND podcast = ?',
      [item.analyst, item.podcast]
    );

    await run(
      `INSERT INTO insights
        (analyst_id, player_name, position, quote, opinion, date, timestamp, source_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        analystRow.id,
        item.player,
        item.position || null,
        item.quote,
        item.opinion || null,
        item.date || null,
        item.timestamp || null,
        item.source_url || null,
      ]
    );
  }

  console.log(`Seeded ${insights.length} insight(s) from mock data.`);
}

async function init() {
  await applySchema();
  await seedFromMockIfEmpty();
}

module.exports = { db, run, get, all, init };
