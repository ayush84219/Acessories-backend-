import { getAllMaterials, getAllCaptures } from '../db.js';

async function check() {
  const materials = await getAllMaterials();
  console.log('--- ALL MATERIALS IN MATERIALS TABLE (' + materials.length + ') ---');
  console.log(materials.map(m => ({ id: m.id, name: m.name, category: m.category, stock: m.stock, location: m.location, packets: m.packets })));

  const captures = await getAllCaptures();
  console.log('\n--- ALL CAPTURES IN WEIGHT_CAPTURE TABLE (' + captures.length + ') ---');
  console.log(captures.map(c => ({ id: c.id, code: c.materialCode, name: c.materialName, pieces: c.pieces, loc: c.storeLocation, po: c.poNumber, inv: c.invoiceNo, status: c.status, appStatus: c.approvalStatus, mode: c.entryMode })));

  process.exit(0);
}

check();
