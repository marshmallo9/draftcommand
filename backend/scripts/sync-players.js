#!/usr/bin/env node
// Runs the player sync once and exits. Meant for a scheduled job (cron on
// Railway/Render, GitHub Actions, whatever) rather than the live server —
// keeps a slow multi-source sync off the request path. Also the fastest way
// to smoke-test the sync from a real network: `node scripts/sync-players.js`.
require('dotenv').config();
const { init } = require('../src/db');
const { runSync } = require('../src/sync');

init()
  .then(runSync)
  .then((result) => {
    console.log(JSON.stringify(result, null, 2));
    // Derived rather than a hardcoded key list, so a new sync source added
    // to runSync() is automatically covered here too.
    const failed = Object.keys(result).filter(k => result[k] && typeof result[k] === 'object' && result[k].ok === false);
    if (failed.length) {
      console.error(`\n${failed.length} source(s) failed: ${failed.join(', ')} — see "error" above for each.`);
      process.exitCode = 1;
    } else {
      console.log(`\nOK — ${result.playersInDb} players in the database.`);
    }
  })
  .catch((err) => {
    console.error('Sync crashed:', err);
    process.exitCode = 1;
  });
