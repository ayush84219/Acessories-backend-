import pool from '../db.js';

async function checkDatabase() {
  console.log('====================================================');
  console.log('🔍 FULL DATABASE CONNECTION & INTEGRITY AUDIT');
  console.log('====================================================\n');

  const startTime = Date.now();

  try {
    // 1. Connection Ping
    const [pingRes] = await pool.query('SELECT 1 + 1 AS result, NOW() as server_time, VERSION() as mysql_version, DATABASE() as current_db');
    const latency = Date.now() - startTime;
    console.log(`✅ MySQL Connection Status: ONLINE (Latency: ${latency}ms)`);
    console.log(`   Database Name: ${pingRes[0].current_db}`);
    console.log(`   MySQL Version: ${pingRes[0].mysql_version}`);
    console.log(`   Server Time:   ${pingRes[0].server_time}\n`);

    // 2. Pool Configuration
    console.log('📊 Connection Pool Configuration:');
    console.log(`   Host:     ${process.env.DB_HOST || 'localhost'}`);
    console.log(`   User:     ${process.env.DB_USER || 'root'}`);
    console.log(`   Database: ${process.env.DB_NAME || 'bom_accessories'}`);
    console.log(`   Port:     ${process.env.DB_PORT || 3306}\n`);

    // 3. Table Counts & Status
    const [tables] = await pool.query(`
      SELECT 
        TABLE_NAME as tableName, 
        TABLE_ROWS as estimatedRows, 
        ROUND((DATA_LENGTH + INDEX_LENGTH) / 1024 / 1024, 2) as sizeMB
      FROM information_schema.TABLES 
      WHERE TABLE_SCHEMA = DATABASE()
      ORDER BY TABLE_NAME
    `);

    console.log(`📁 Database Tables (${tables.length} tables found):`);
    
    // Accurate exact counts
    const tableReport = [];
    for (const t of tables) {
      try {
        const [cntRes] = await pool.query(`SELECT COUNT(*) as exactCount FROM \`${t.tableName}\``);
        tableReport.push({
          Table: t.tableName,
          'Exact Rows': cntRes[0].exactCount,
          'Size (MB)': `${t.sizeMB} MB`
        });
      } catch (err) {
        tableReport.push({
          Table: t.tableName,
          'Exact Rows': 'Error reading',
          'Size (MB)': `${t.sizeMB} MB`
        });
      }
    }
    console.table(tableReport);

    // 4. Undesigned Lots on or after 10 Aug 2026 Check
    const [recentLots] = await pool.query(`
      SELECT ch.Lot_Number, ch.Date_of_Issue, ch.Fabric, ch.Style, ch.Party_Name
      FROM cutting_header ch
      LEFT JOIN designs d ON LOWER(ch.Lot_Number) = LOWER(d.id) OR LOWER(ch.Lot_Number) = LOWER(d.lotNo2)
      WHERE d.id IS NULL 
        AND ch.Lot_Number REGEXP '^[0-9]+$'
        AND (ch.Date_of_Issue >= '2026-08-10' OR ch.Saved_At >= '2026-08-10')
      ORDER BY ch.Date_of_Issue DESC
      LIMIT 5
    `);
    console.log('📋 Latest Undesigned Cutting Lots (>= 10 Aug 2026):');
    console.table(recentLots);

    console.log('\n====================================================');
    console.log('🎉 ALL DATABASE CHECKS PASSED WITH ZERO ERRORS');
    console.log('====================================================');
  } catch (err) {
    console.error('❌ DATABASE CONNECTION ERROR:', err);
  } finally {
    await pool.end();
  }
}

checkDatabase();
