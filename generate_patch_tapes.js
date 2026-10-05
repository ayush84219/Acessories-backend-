import { pool } from './db.js';

function normalizeCategory(rawCat) {
  const cat = String(rawCat || '').trim().toUpperCase();
  if (cat.includes('MATEL') || cat.includes('METAL')) return 'Metal Patch';
  if (cat.includes('PATCH')) return 'Patch';
  if (cat.includes('TAPE')) return 'Tapes';
  if (cat.includes('TAG')) return 'Tags';
  if (cat.includes('LABEL')) return 'Labels';
  return rawCat || 'Trims';
}

export const generatePatchAndTapeItemCodesSql = async () => {
  // 1. Ensure columns exist
  try {
    const [cols] = await pool.execute("SHOW COLUMNS FROM item_codes LIKE 'mt_code'");
    if (cols.length === 0) {
      await pool.execute("ALTER TABLE item_codes ADD COLUMN mt_code VARCHAR(100) DEFAULT ''");
    }
  } catch (_) { }

  try {
    const [cols] = await pool.execute("SHOW COLUMNS FROM weight_capture LIKE 'itemCode'");
    if (cols.length === 0) {
      await pool.execute("ALTER TABLE weight_capture ADD COLUMN itemCode VARCHAR(100) DEFAULT ''");
    }
  } catch (_) { }

  try {
    const [cols] = await pool.execute("SHOW COLUMNS FROM materials LIKE 'itemCode'");
    if (cols.length === 0) {
      await pool.execute("ALTER TABLE materials ADD COLUMN itemCode VARCHAR(100) DEFAULT ''");
    }
  } catch (_) { }

  // 2. Find max existing sequence in item_codes
  const [existingCodes] = await pool.execute('SELECT * FROM item_codes ORDER BY id ASC');
  let maxSeq = 0;
  existingCodes.forEach(ic => {
    const match = String(ic.item_code || '').match(/^ST(\d+)$/i);
    if (match) {
      const num = parseInt(match[1], 10);
      if (!isNaN(num) && num > maxSeq) maxSeq = num;
    }
  });

  let nextSeqNum = maxSeq + 1;

  // 3. Fetch all Patch and Tape rows from weight_capture
  const [wcRows] = await pool.execute(
    `SELECT * FROM weight_capture 
     WHERE UPPER(category) LIKE '%PATCH%' 
        OR UPPER(materialName) LIKE '%PATCH%' 
        OR UPPER(category) LIKE '%MATEL%' 
        OR UPPER(category) LIKE '%TAPE%' 
        OR UPPER(materialName) LIKE '%TAPE%' 
     ORDER BY id ASC`
  );

  const existingByMt = new Map();
  const existingByNameBrand = new Map();

  existingCodes.forEach(ic => {
    if (ic.mt_code) {
      existingByMt.set(String(ic.mt_code).trim().toUpperCase(), ic);
    }
    const key = `${String(ic.item_name || '').trim().toUpperCase()}|||${String(ic.brand || '').trim().toUpperCase()}`;
    if (!existingByNameBrand.has(key)) {
      existingByNameBrand.set(key, ic);
    }
  });

  const createdItems = [];
  const linkedItems = [];

  for (const row of wcRows) {
    const mtCode = String(row.materialCode || '').trim().toUpperCase();
    const matName = String(row.materialName || '').trim().toUpperCase();
    const supBrand = String(row.supplier || 'General').trim().toUpperCase();
    const cat = normalizeCategory(row.category || (matName.includes('TAPE') ? 'TAPES' : 'PATCH'));
    const uom = String(row.unit || (cat === 'Tapes' ? 'MTR' : 'PCS')).trim().toUpperCase();
    const style = String(row.lotNo || 'N/A').trim();
    const rate = 0;

    let assignedItemCode = null;

    if (existingByMt.has(mtCode)) {
      const existing = existingByMt.get(mtCode);
      assignedItemCode = existing.item_code;
    } else {
      const key = `${matName}|||${supBrand}`;
      const nameMatch = existingByNameBrand.get(key);

      if (nameMatch && !nameMatch.mt_code) {
        // Link existing ST code
        assignedItemCode = nameMatch.item_code;
        await pool.execute('UPDATE item_codes SET mt_code = ? WHERE id = ?', [mtCode, nameMatch.id]);
        nameMatch.mt_code = mtCode;
        existingByMt.set(mtCode, nameMatch);
        linkedItems.push({
          id: nameMatch.id,
          item_code: assignedItemCode,
          mt_code: mtCode,
          item_name: matName,
          brand: supBrand,
          category: cat,
          uom,
          rate
        });
      } else {
        // Generate new ST code
        assignedItemCode = `ST${String(nextSeqNum).padStart(5, '0')}`;
        nextSeqNum++;

        const [res] = await pool.execute(
          `INSERT INTO item_codes (item_code, item_name, brand, style, category, uom, rate, mt_code)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [assignedItemCode, matName, supBrand, style, cat, uom, rate, mtCode]
        );

        const newRec = {
          id: res.insertId,
          item_code: assignedItemCode,
          mt_code: mtCode,
          item_name: matName,
          brand: supBrand,
          style,
          category: cat,
          uom,
          rate,
          pieces: row.pieces || 0
        };

        existingByMt.set(mtCode, newRec);
        existingByNameBrand.set(key, newRec);
        createdItems.push(newRec);
      }
    }

    // Sync weight_capture & materials tables
    if (assignedItemCode && mtCode) {
      await pool.execute('UPDATE weight_capture SET itemCode = ? WHERE materialCode = ?', [assignedItemCode, mtCode]);
      await pool.execute('UPDATE materials SET itemCode = ? WHERE id = ?', [assignedItemCode, mtCode]);
    }
  }

  const [allItemCodes] = await pool.execute('SELECT * FROM item_codes ORDER BY id DESC');

  return {
    success: true,
    createdCount: createdItems.length,
    linkedCount: linkedItems.length,
    totalProcessed: wcRows.length,
    createdItems,
    linkedItems,
    itemCodes: allItemCodes || []
  };
};

// Run standalone if executed directly
if (process.argv[1] && process.argv[1].endsWith('generate_patch_tapes.js')) {
  generatePatchAndTapeItemCodesSql()
    .then(res => {
      console.log('Execution completed successfully:');
      console.log(`Created new ST codes: ${res.createdCount}`);
      console.log(`Linked existing ST codes: ${res.linkedCount}`);
      console.log(`Total processed: ${res.totalProcessed}`);
      console.log(`Total item codes in DB now: ${res.itemCodes.length}`);
      process.exit(0);
    })
    .catch(err => {
      console.error('Error running generation:', err);
      process.exit(1);
    });
}
