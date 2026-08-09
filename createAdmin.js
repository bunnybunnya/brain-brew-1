/**
 * One-off CLI script to create the first (or additional) admin
 * account. Admins are intentionally NOT created through any public
 * signup API - only through this script (run by whoever controls the
 * server/database) or, later, by an existing admin via a dedicated
 * admin-only endpoint you may choose to add.
 *
 * Usage:
 *   node src/db/createAdmin.js "Admin Name" admin@example.com "StrongPassword123!"
 */
const { pool } = require('../config/db');
const { hashPassword } = require('../utils/password');

async function main() {
  const [name, email, password] = process.argv.slice(2);
  if (!name || !email || !password) {
    console.error('Usage: node src/db/createAdmin.js "Admin Name" admin@example.com "StrongPassword123!"');
    process.exit(1);
  }

  const passwordHash = await hashPassword(password);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const userResult = await client.query(
      `INSERT INTO users (role, name, email, password_hash, email_verified)
       VALUES ('admin', $1, $2, $3, TRUE)
       RETURNING id, name, email`,
      [name, email, passwordHash]
    );
    const user = userResult.rows[0];
    await client.query(`INSERT INTO admin_profiles (user_id) VALUES ($1)`, [user.id]);
    await client.query('COMMIT');
    console.log('Admin account created:', user);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Failed to create admin:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
