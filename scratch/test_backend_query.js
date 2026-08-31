import pool from '../db.js';

async function testBackendFilter() {
  const [rows] = await pool.execute(`
    SELECT ch.Lot_Number, ch.Date_of_Issue, ch.Party_Name, ch.Fabric, ch.Style, ch.Garment_Type
    FROM cutting_header ch
    WHERE ch.Lot_Number IS NOT NULL 
      AND ch.Lot_Number != ''
      AND ch.Lot_Number REGEXP '^[0-9]+$'
      AND (
        (ch.Date_of_Issue LIKE '2026-08-%' AND CAST(SUBSTRING(ch.Date_of_Issue, 9, 2) AS UNSIGNED) >= 10)
        OR (ch.Date_of_Issue >= '2026-09-01' AND ch.Date_of_Issue LIKE '2026-%')
      )
      AND NOT EXISTS (
        SELECT 1 FROM designs d 
        WHERE LOWER(TRIM(d.id)) = LOWER(TRIM(ch.Lot_Number))
           OR LOWER(TRIM(COALESCE(d.lotNo2, ''))) = LOWER(TRIM(ch.Lot_Number))
           OR LOWER(TRIM(COALESCE(d.name, ''))) = LOWER(TRIM(ch.Lot_Number))
           OR LOWER(TRIM(COALESCE(d.repeat_against, ''))) = LOWER(TRIM(ch.Lot_Number))
      )
    ORDER BY ch.Date_of_Issue DESC, ch.id DESC
  `);

  console.log('Total undesigned cutting lots strictly from 10 Aug 2026 onwards:', rows.length);
  console.table(rows.slice(0, 15));
  pool.end();
}

testBackendFilter();
