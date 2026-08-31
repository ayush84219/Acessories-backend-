import pool from '../db.js';

async function listOnlyCuttingAfter10Aug() {
  const [rows] = await pool.execute(`
    SELECT 
      ch.Lot_Number,
      ch.Date_of_Issue,
      ch.Party_Name,
      ch.Fabric,
      ch.Garment_Type,
      ch.Style,
      ch.Cutting_Qty,
      ch.Supervisor
    FROM cutting_header ch
    LEFT JOIN designs d ON LOWER(ch.Lot_Number) = LOWER(d.id) OR LOWER(ch.Lot_Number) = LOWER(d.lotNo2)
    WHERE d.id IS NULL 
      AND ch.Lot_Number REGEXP '^[0-9]+$'
      AND (ch.Date_of_Issue >= '2026-08-10')
    ORDER BY ch.Date_of_Issue DESC, ch.id DESC
  `);
  
  console.log(`\n========================================================================================`);
  console.log(`✂️ TOTAL ONLY CUTTING LOTS (NOT DESIGNED YET) ISSUED >= 10 AUG 2026: ${rows.length}`);
  console.log(`========================================================================================\n`);
  
  console.table(rows);
  pool.end();
}

listOnlyCuttingAfter10Aug();
