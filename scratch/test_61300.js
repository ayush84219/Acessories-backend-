import mysql from 'mysql2/promise';

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

async function checkLot61300() {
  console.log('=== Checking Google Sheet for 61300 ===');
  const url = 'https://docs.google.com/spreadsheets/d/1fKSwGBIpzWEFk566WRQ4bzQ0anJlmasoY8TwrTLQHXI/export?format=csv&gid=0';
  const res = await fetch(url);
  const csv = await res.text();
  const rows = parseCSV(csv);
  console.log('Total CSV rows:', rows.length);
  const match = rows.find(r => {
    const val = r['Lot Number'] || r['Lot No'] || r['Job Order No'];
    return val && String(val).trim().toLowerCase() === '61300'.toLowerCase();
  });
  console.log('Google Sheet match for 61300:', match);

  console.log('\n=== Checking MySQL Database for 61300 ===');
  const pool = mysql.createPool({ host: 'localhost', user: 'root', password: 'Mohitca011', database: 'bom_of_accessories' });
  const [cutRows] = await pool.execute('SELECT * FROM cutting_header WHERE LOWER(Lot_Number) = LOWER(?)', ['61300']);
  console.log('cutting_header rows for 61300:', cutRows.length, cutRows[0] || null);

  const [desRows] = await pool.execute('SELECT * FROM designs WHERE LOWER(id) = LOWER(?) OR LOWER(lotNo2) = LOWER(?)', ['61300', '61300']);
  console.log('designs rows for 61300:', desRows.length, desRows[0] || null);

  const [partialCut] = await pool.execute('SELECT Lot_Number FROM cutting_header WHERE Lot_Number LIKE "%61300%"');
  console.log('Partial cutting_header matches for 61300:', partialCut);

  const [partialDes] = await pool.execute('SELECT id, name, lotNo2 FROM designs WHERE id LIKE "%61300%" OR lotNo2 LIKE "%61300%"');
  console.log('Partial designs matches for 61300:', partialDes);

  await pool.end();
}
checkLot61300().catch(console.error);
