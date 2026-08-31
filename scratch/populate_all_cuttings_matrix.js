import mysql from 'mysql2/promise';

async function populateAllMatrix() {
  const pool = mysql.createPool({ host: 'localhost', user: 'root', password: 'Mohitca011', database: 'bom_of_accessories' });

  const [headers] = await pool.execute('SELECT id, Lot_Number, Shades, Sizes, Cutting_Qty FROM cutting_header');
  console.log(`Checking ${headers.length} cutting_header rows...`);

  let addedHeaders = 0;
  let totalMatrixRowsAdded = 0;

  for (const h of headers) {
    const [existing] = await pool.execute('SELECT id FROM cuttings_matrix WHERE header_id = ?', [h.id]);
    if (existing.length > 0) continue;

    const shadesStr = h.Shades;
    const sizesStr = h.Sizes;
    const totalQty = h.Cutting_Qty;

    const rawShades = (shadesStr || 'Standard')
      .split(/[,/;\r\n]+/)
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.toLowerCase().includes('total'));

    const parsedShades = rawShades.map(s => {
      const qtyMatch = s.match(/\[(\d+)\]|\((\d+)\)/);
      const count = qtyMatch ? parseInt(qtyMatch[1] || qtyMatch[2], 10) : 1;
      const cleanColor = s.replace(/\[\d+\]|\(\d+\)/g, '').trim();
      return { color: cleanColor || s, count };
    });

    const uniqueShades = parsedShades.filter(s => s.color.length > 0);
    if (uniqueShades.length === 0) uniqueShades.push({ color: 'Standard', count: 1 });

    const rawSizes = (sizesStr || 'M, L, XL, XXL')
      .split(/[,/;\r\n]+/)
      .map(s => s.trim().toUpperCase())
      .filter(s => s.length > 0);

    const standardSizes = ['M', 'L', 'XL', 'XXL'];
    const activeSizes = rawSizes.length > 0 ? rawSizes : standardSizes;

    const total = parseInt(totalQty, 10) || uniqueShades.length;
    const qtyPerShade = Math.max(1, Math.floor(total / uniqueShades.length));

    for (const shade of uniqueShades) {
      const sizeMap = {};
      const shadeTotal = Math.max(shade.count, qtyPerShade);
      const perSize = Math.max(1, Math.floor(shadeTotal / (activeSizes.length || 1)));

      activeSizes.forEach(sz => {
        sizeMap[sz] = perSize;
      });
      standardSizes.forEach(sz => {
        if (sizeMap[sz] === undefined) sizeMap[sz] = 0;
      });

      await pool.execute(
        `INSERT INTO cuttings_matrix (header_id, Lot_No, Color, Cutting_Table, M, L, XL, XXL, Total_Pcs)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          h.id,
          h.Lot_Number || '',
          shade.color,
          1,
          sizeMap['M'] || 0,
          sizeMap['L'] || 0,
          sizeMap['XL'] || 0,
          sizeMap['XXL'] || 0,
          shadeTotal
        ]
      );
      totalMatrixRowsAdded++;
    }
    addedHeaders++;
  }

  console.log(`Finished! Added matrix rows for ${addedHeaders} lots (Total new cuttings_matrix rows: ${totalMatrixRowsAdded}).`);
  const [matrixCount] = await pool.execute('SELECT COUNT(*) as count FROM cuttings_matrix');
  console.log(`Total rows in cuttings_matrix table now: ${matrixCount[0].count}`);
  await pool.end();
}

populateAllMatrix().catch(console.error);
