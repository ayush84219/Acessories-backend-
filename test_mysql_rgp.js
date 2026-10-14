import { pool } from './db.js';

async function check() {
  try {
    const [rows] = await pool.execute('SELECT * FROM rgp LIMIT 10');
    console.log('MySQL rgp count:', rows.length);
    if (rows.length > 0) {
      console.log('First rgp:', JSON.stringify(rows[0]));
    }
  } catch (err) {
    console.error('MySQL query error:', err.message);
  } finally {
    process.exit(0);
  }
}
check();
