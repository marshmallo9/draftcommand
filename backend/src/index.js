require('dotenv').config();

const express = require('express');
const cors = require('cors');

const { init } = require('./db');
const insightsRouter = require('./routes/insights');
const playersRouter = require('./routes/players');

const PORT = process.env.PORT || 3001;
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';

const app = express();
app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json());

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api', insightsRouter);
app.use('/api', playersRouter);

// Basic error handler so a bad query doesn't crash the process.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

init()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Draft Command podcast-insights backend running on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
  });
