import pool from '../db.js';

async function testExclusion() {
  const sql = `
    SELECT ch.Lot_Number, ch.Date_of_Issue, ch.Style, ch.Fabric, d.id as designed_id
    FROM cutting_header ch
    LEFT JOIN designs d ON (
      LOWER(TRIM(ch.Lot_Number)) = LOWER(TRIM(d.id)) 
      OR LOWER(TRIM(ch.Lot_Number)) = LOWER(TRIM(d.lotNo2))
      OR LOWER(TRIM(ch.Lot_Number)) = LOWER(TRIM(d.name))
    )
    WHERE d.id IS NULL 
      AND ch.Lot_Number REGEXP '^[0-9]+$'
      AND (ch.Date_of_Issue >= '2026-08-10')
    ORDER BY ch.Date_of_Issue DESC, ch.id DESC
  `;
  const [rows] = await pool.execute(sql);
  console.log('Undesigned lots count after 10 Aug:', rows.length);
  
  const designedLotsInDb = ['61300', '62161', '11028', '10011', '11809', '11810', '11033'];
  const leakedLots = rows.filter(r => designedLotsInDb.includes(r.Lot_Number));
  
  console.log('Designed lots in database:', designedLotsInDb);
  console.log('Leaked lots in OnlyCutting (should be 0):', leakedLots.length);
  
  pool.end();
}

testExclusion();
