import { pool } from './db.js';

async function checkLots() {
  try {
    const [ch] = await pool.execute(`SELECT Lot_Number, Style, Fabric, Party_Name, Saved_At FROM cutting_header WHERE Party_Name LIKE '%JAIN%' OR Style LIKE '%T-SHIRT%' OR Lot_Number = '1' LIMIT 10`);
    console.log('cutting_header matching:', ch);

    const [ds] = await pool.execute(`SELECT id, designNo, partyName FROM designs WHERE partyName LIKE '%JAIN%' OR id = '1' LIMIT 10`);
    console.log('designs matching:', ds);
  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    process.exit(0);
  }
}
checkLots();
