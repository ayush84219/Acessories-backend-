import pool from '../db.js';

async function testDateFilter() {
  const [rows] = await pool.execute(`
    SELECT ch.id, ch.Lot_Number, ch.Date_of_Issue, ch.Fabric, ch.Style, ch.Garment_Type, ch.Cutting_Qty, ch.Supervisor, ch.Party_Name, ch.Brand, ch.Shades, ch.Sizes
    FROM cutting_header ch
    LEFT JOIN designs d ON LOWER(ch.Lot_Number) = LOWER(d.id) OR LOWER(ch.Lot_Number) = LOWER(d.lotNo2)
    WHERE d.id IS NULL 
      AND ch.Lot_Number REGEXP '^[0-9]+$'
    ORDER BY ch.id DESC
  `);

  console.log(`Total valid numeric undesigned lots: ${rows.length}`);
  
  // Filter for Date_of_Issue on or after 2026-08-10
  const after10Aug = rows.filter(r => {
    if (!r.Date_of_Issue) return false;
    const dStr = r.Date_of_Issue.trim();
    // Handles '2026-08-10' or '10/08/2026' or '10-08-2026'
    if (dStr.startsWith('2026-08-')) {
      const day = parseInt(dStr.split('-')[2], 10);
      return day >= 10;
    }
    const d = new Date(dStr);
    return !isNaN(d.getTime()) && d >= new Date('2026-08-10T00:00:00');
  });

  console.log(`Lots on or after 10 August 2026: ${after10Aug.length}`);
  console.table(after10Aug.map(r => ({
    Lot: r.Lot_Number,
    Date: r.Date_of_Issue,
    Fabric: r.Fabric,
    Style: r.Style,
    Qty: r.Cutting_Qty,
    Supervisor: r.Supervisor
  })));
  
  pool.end();
}

testDateFilter();
