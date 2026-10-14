import { pool } from './db.js';

async function searchDb() {
  console.log('--- Searching in MySQL ---');
  try {
    const [tables] = await pool.execute('SHOW TABLES');
    const tableNames = tables.map(t => Object.values(t)[0]);
    console.log('Tables:', tableNames);
    
    // Check cutting_header, scans, material_issues, designs, etc. for 0005 or Jain Hosiery
    for (const t of tableNames) {
      try {
        const [rows] = await pool.execute(`SELECT * FROM \`${t}\` WHERE 
          CONCAT_WS(' ', '') LIKE '%0005%' OR 
          CONCAT_WS(' ', '') LIKE '%JAIN%' LIMIT 5`);
        // instead search all varchar/text columns
        const [cols] = await pool.execute(`DESCRIBE \`${t}\``);
        const textCols = cols.filter(c => c.Type.includes('varchar') || c.Type.includes('text')).map(c => c.Field);
        if (textCols.length > 0) {
          const whereClause = textCols.map(c => `\`${c}\` LIKE '%0005%'`).join(' OR ');
          const [m1] = await pool.execute(`SELECT * FROM \`${t}\` WHERE ${whereClause} LIMIT 5`);
          if (m1.length > 0) {
            console.log(`Found in table ${t}:`, m1);
          }
        }
      } catch (e) {
        // ignore
      }
    }
  } catch (err) {
    console.error('DB error:', err.message);
  } finally {
    process.exit(0);
  }
}
searchDb();
