const { Pool } = require('pg');
const env = require('./env');

if (!env.db.connectionString) {
  // eslint-disable-next-line no-console
  console.warn('[db] DATABASE_URL is not set. Set it in .env before starting the server.');
}

const pool = new Pool({
  connectionString: env.db.connectionString,
  ssl: env.db.ssl,
});

pool.on('error', (err) => {
  // eslint-disable-next-line no-console
  console.error('[db] Unexpected error on idle client', err);
});

module.exports = {
  pool,
  query: (text, params) => pool.query(text, params),
  // For multi-statement transactions
  getClient: () => pool.connect(),
};
