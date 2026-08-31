import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import * as XLSX from 'xlsx';

dotenv.config();

function toInt(val) {
  if (val === null || val === undefined || val === '') return null;
  const n = parseInt(val, 10);
  return isNaN(n) ? null : n;
}

function toStr(val) {
  if (val === null || val === undefined) return '';
  return String(val).trim();
}

async function importFullScheduleAndMatrix() {
  const pool = mysql.createPool({
    host: process.env.MYSQL_HOST || 'localhost',
    port: Number(process.env.MYSQL_PORT) || 3306,
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || 'Mohitca011',
    database: process.env.MYSQL_DATABASE || 'bom_of_accessories'
  });

  console.log('1. Downloading Excel schedule from Google Sheets...');
  const sheetId = '1vmwXCAXTY5OT6MoGu13VmygNmeK3S4bve3cbQQNhKqs';
  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=xlsx`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download spreadsheet: ${response.status} ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const workbook = XLSX.read(buffer, { type: 'buffer' });

  console.log('Available sheets in workbook:', workbook.SheetNames);

  // Clear existing headers & matrix rows to ensure fresh synchronized state
  await pool.execute('DELETE FROM cuttings_matrix');
  await pool.execute('DELETE FROM cutting_header');

  const lotToHeaderId = new Map();
  let headerCount = 0;

  // --- 1. Import Index Sheet ---
  if (workbook.SheetNames.includes('Index')) {
    console.log('2. Parsing Index sheet...');
    const indexSheet = workbook.Sheets['Index'];
    const indexRows = XLSX.utils.sheet_to_json(indexSheet, { defval: null });

    for (const row of indexRows) {
      const lotNumber = toStr(row['Lot Number'] || row['Lot No']);
      if (!lotNumber) continue;

      const [res] = await pool.execute(
        `INSERT INTO cutting_header (
          Lot_Number, StartRow, NumRows, HeaderCols, Fabric, Garment_Type, Style,
          Sizes, Shades, Saved_At, Date_of_Issue, Supervisor, Image_Url,
          Party_Name, Brand, Season, Direct_Stitching, Challan_History,
          Zip_Order_Date, Zip_Received_Date, WIP_Status, Completed_Status,
          MWK, JobOrder_Date, Manpower, Cutting_Qty, Stitching_Issue_Qty, Priority, Sticker
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          lotNumber.substring(0, 100),
          toInt(row['StartRow']),
          toInt(row['NumRows']),
          toInt(row['HeaderCols']),
          toStr(row['Fabric']).substring(0, 255),
          toStr(row['Garment Type']).substring(0, 255),
          toStr(row['Style']).substring(0, 255),
          toStr(row['Sizes']).substring(0, 255),
          toStr(row['Shades']),
          toStr(row['Saved At']) || new Date().toISOString(),
          toStr(row['Date of Issue']).substring(0, 100),
          toStr(row['Supervisor']).substring(0, 255),
          toStr(row['Image Url']),
          toStr(row['PARTY NAME']).substring(0, 255),
          toStr(row['BRAND']).substring(0, 255),
          toStr(row['SEASON']).substring(0, 100),
          toStr(row['DIRECT STITCHING']).substring(0, 100),
          toStr(row['CHALLAN HISTORY']),
          toStr(row['ZIP ORDER DATE']).substring(0, 100),
          toStr(row['ZIP RECEIVED DATE']).substring(0, 100),
          toStr(row['WIP Status']),
          toStr(row['Completed Status']),
          toStr(row['M/W/K']).substring(0, 100),
          toStr(row['JobOrder Date']).substring(0, 100),
          toInt(row['Manpower']),
          toInt(row['Cutting Qty']),
          toInt(row['Stitching Issue Qty']),
          toStr(row['Prioirty'] || row['Priority'] || 'Normal').substring(0, 50),
          toStr(row['Sticker']).substring(0, 100)
        ]
      );

      const dbId = res.insertId;
      lotToHeaderId.set(lotNumber, dbId);
      headerCount++;
    }
    console.log(`Successfully imported ${headerCount} lot cards into cutting_header!`);
  }

  // --- 2. Import Matrix Sheets (Color, Table, M, L, XL, XXL, Total Pcs) ---
  let matrixCount = 0;
  for (const sheetName of workbook.SheetNames) {
    if (sheetName === 'Index') continue;

    const sheet = workbook.Sheets[sheetName];
    const sheetData = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

    let currentLotNo = null;
    let inMatrix = false;
    let colorIdx = -1;
    let tableIdx = -1;
    let mIdx = -1;
    let lIdx = -1;
    let xlIdx = -1;
    let xxlIdx = -1;
    let totalIdx = -1;

    for (let r = 0; r < sheetData.length; r++) {
      const row = sheetData[r];
      if (!row || row.length === 0 || row.every(cell => cell === '')) {
        inMatrix = false;
        continue;
      }

      const val0 = String(row[0] || '').trim();
      const val1 = String(row[1] || '').trim();

      if (val0.includes('Lot Number:')) {
        currentLotNo = toStr(val1 || row[2] || '');
        inMatrix = false;
        continue;
      } else if (val1.includes('Lot Number:')) {
        currentLotNo = toStr(row[2] || row[3] || '');
        inMatrix = false;
        continue;
      }

      if (val0.toLowerCase() === 'color' && val1.toLowerCase().includes('table')) {
        colorIdx = 0;
        tableIdx = 1;
        mIdx = -1;
        lIdx = -1;
        xlIdx = -1;
        xxlIdx = -1;
        totalIdx = -1;

        for (let col = 0; col < row.length; col++) {
          const cVal = String(row[col] || '').trim().toLowerCase();
          if (cVal === 'color') colorIdx = col;
          else if (cVal.includes('table')) tableIdx = col;
          else if (cVal === 'm') mIdx = col;
          else if (cVal === 'l') lIdx = col;
          else if (cVal === 'xl') xlIdx = col;
          else if (cVal === 'xxl' || cVal === '2xl') xxlIdx = col;
          else if (cVal.includes('total')) totalIdx = col;
        }
        inMatrix = true;
        continue;
      }

      if (inMatrix) {
        if (val0.toLowerCase().includes('total') || val0.toLowerCase().includes('cutting matrix')) {
          inMatrix = false;
          continue;
        }

        const colorVal = colorIdx !== -1 ? toStr(row[colorIdx]) : '';
        if (!colorVal) continue;

        const tableVal = tableIdx !== -1 ? toInt(row[tableIdx]) : null;
        const mVal = mIdx !== -1 ? toInt(row[mIdx]) : null;
        const lVal = lIdx !== -1 ? toInt(row[lIdx]) : null;
        const xlVal = xlIdx !== -1 ? toInt(row[xlIdx]) : null;
        const xxlVal = xxlIdx !== -1 ? toInt(row[xxlIdx]) : null;
        const totalPcs = totalIdx !== -1 ? toInt(row[totalIdx]) : ((mVal || 0) + (lVal || 0) + (xlVal || 0) + (xxlVal || 0));

        let headerId = lotToHeaderId.get(currentLotNo);
        if (!headerId && currentLotNo) {
          // Check DB directly
          const [hRows] = await pool.execute('SELECT id FROM cutting_header WHERE Lot_Number = ?', [currentLotNo]);
          if (hRows.length > 0) {
            headerId = hRows[0].id;
          }
        }

        await pool.execute(
          `INSERT INTO cuttings_matrix
          (header_id, Lot_No, Color, Cutting_Table, M, L, XL, XXL, Total_Pcs)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            headerId || null,
            currentLotNo || '',
            colorVal,
            tableVal,
            mVal,
            lVal,
            xlVal,
            xxlVal,
            totalPcs
          ]
        );
        matrixCount++;
      }
    }
  }

  console.log(`3. Successfully imported ${matrixCount} cutting matrix rows across tables & colors!`);
  const [finalHeaders] = await pool.execute('SELECT COUNT(*) as count FROM cutting_header');
  const [finalMatrix] = await pool.execute('SELECT COUNT(*) as count FROM cuttings_matrix');
  console.log(`Total DB Records: ${finalHeaders[0].count} cutting_headers, ${finalMatrix[0].count} cuttings_matrix rows.`);

  await pool.end();
}

importFullScheduleAndMatrix().catch(err => {
  console.error('Import error:', err);
  process.exit(1);
});
