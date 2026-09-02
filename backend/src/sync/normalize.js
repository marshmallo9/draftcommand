// Best-effort name normalization for joining players across sources that
// don't share an ID system (Sleeper vs. nflverse). Not perfect — two
// different players can theoretically normalize to the same string — but
// good enough for an MVP join, and every join site logs how many rows it
// matched vs. skipped so a bad match rate is visible, not silent.
function normalizeName(name) {
  if (!name) return '';
  return name
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')  // strip accents (e.g. é -> e)
    .replace(/[.'’]/g, '')                          // periods, apostrophes (incl. curly ’)
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '')             // suffixes
    .replace(/[^a-z0-9\s]/g, ' ')                        // any other punctuation
    .replace(/\s+/g, ' ')
    .trim();
}

module.exports = { normalizeName };
