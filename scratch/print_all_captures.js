import pool from '../db.js';

async function check() {
  const [captures] = await pool.execute('SELECT id, materialCode, materialName, category, pieces, packets, storeLocation, poNumber, invoiceNo, approvalStatus, status, entryMode FROM weight_capture ORDER BY id ASC');
  console.log('TOTAL CAPTURES IN DB:', captures.length);
  console.log(JSON.stringify(captures, null, 2));
  process.exit(0);
}

check();
