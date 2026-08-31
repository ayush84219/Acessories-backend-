import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(line => line.trim() !== '');
  if (lines.length === 0) return [];
  const splitRow = (rowStr) => {
    const res = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < rowStr.length; i++) {
      const c = rowStr[i];
      if (c === '"') {
        inQuotes = !inQuotes;
      } else if (c === ',' && !inQuotes) {
        res.push(cur.trim());
        cur = '';
      } else {
        cur += c;
      }
    }
    res.push(cur.trim());
    return res;
  };

  const headers = splitRow(lines[0]);
  const results = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = splitRow(lines[i]);
    const row = {};
    headers.forEach((h, idx) => {
      row[h] = vals[idx] !== undefined ? vals[idx] : '';
    });
    results.push(row);
  }
  return results;
}

async function syncLots() {
  const pool = mysql.createPool({
    host: process.env.MYSQL_HOST || 'localhost',
    port: Number(process.env.MYSQL_PORT) || 3306,
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || 'Mohitca011',
    database: process.env.MYSQL_DATABASE || 'bom_of_accessories'
  });

  const url = 'https://docs.google.com/spreadsheets/d/1fKSwGBIpzWEFk566WRQ4bzQ0anJlmasoY8TwrTLQHXI/export?format=csv&gid=0';
  console.log('Fetching Google Sheet CSV...');
  const res = await fetch(url);
  const csv = await res.text();
  const rows = parseCSV(csv);
  console.log('Parsed CSV Rows:', rows.length);

  let inserted = 0;
  for (const r of rows) {
    const rawLot = r['Lot Number'] || r['Lot No'] || r['Job Order No'];
    if (!rawLot || rawLot.trim() === '') continue;

    const trimmedLot = rawLot.trim().substring(0, 100);
    // Ignore long comment header lines that get mistaken for lots
    if (trimmedLot.length > 50 || trimmedLot.toLowerCase().includes('total') || trimmedLot.toLowerCase().includes('summary')) {
      continue;
    }

    const [existing] = await pool.execute('SELECT id FROM cutting_header WHERE Lot_Number = ?', [trimmedLot]);
    if (existing.length === 0) {
      await pool.execute(
        `INSERT INTO cutting_header (
          Lot_Number, Fabric, Garment_Type, Style, Sizes, Shades, Saved_At, Date_of_Issue, Supervisor,
          Party_Name, Brand, Season, Direct_Stitching, Cutting_Qty, Priority, Sticker, zip_payload
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          trimmedLot,
          (r['Fabric'] || '').substring(0, 255),
          (r['Garment Type'] || '').substring(0, 255),
          (r['Style'] || '').substring(0, 255),
          (r['Size'] || '').substring(0, 255),
          r['Shade'] || '',
          new Date().toISOString(),
          (r['Date'] || '').substring(0, 100),
          (r['Submitted By'] || '').substring(0, 255),
          (r['Party Name'] || '').substring(0, 255),
          (r['Brand'] || '').substring(0, 255),
          (r['Season'] || '').substring(0, 100),
          (r['Direct Stitching'] || '').substring(0, 100),
          parseInt(r['Quantity']) || 0,
          (r['Priority'] || 'Normal').substring(0, 50),
          (r['Sticker'] || '').substring(0, 100),
          null
        ]
      );
      inserted++;
    }
  }

  console.log(`Successfully imported ${inserted} lot cards into MySQL cutting_header table!`);
  const [total] = await pool.execute('SELECT COUNT(*) as count FROM cutting_header');
  console.log('Total cutting_header rows in database:', total[0].count);
  await pool.end();
}

syncLots().catch(err => {
  console.error('Sync error:', err);
  process.exit(1);
});
