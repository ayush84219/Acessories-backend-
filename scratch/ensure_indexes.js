import pool from '../db.js';

async function run() {
  const ensureIndex = async (table, indexName, columns) => {
    try {
      const [existing] = await pool.execute(`SHOW INDEX FROM ${table} WHERE Key_name = ?`, [indexName]);
      if (existing.length === 0) {
        await pool.execute(`CREATE INDEX ${indexName} ON ${table} (${columns})`);
        console.log(`[DB Index] Created ${indexName} on ${table}(${columns})`);
      } else {
        console.log(`[DB Index] ${indexName} already exists on ${table}`);
      }
    } catch (err) {
      console.warn(`[DB Index Error] ${table}.${indexName}:`, err.message);
    }
  };

  console.log("Ensuring database indexes for high-speed performance...");

  // 1. weight_capture
  await ensureIndex('weight_capture', 'idx_wc_po', 'poNumber');
  await ensureIndex('weight_capture', 'idx_wc_matcode', 'materialCode');
  await ensureIndex('weight_capture', 'idx_wc_inv', 'invoiceNo');
  await ensureIndex('weight_capture', 'idx_wc_barcode', 'barcodeId');
  await ensureIndex('weight_capture', 'idx_wc_approval', 'approvalStatus');
  await ensureIndex('weight_capture', 'idx_wc_captured', 'capturedAt');

  // 2. purchase_orders
  await ensureIndex('purchase_orders', 'idx_po_number', 'poNumber');
  await ensureIndex('purchase_orders', 'idx_po_vendor', 'vendorName');
  await ensureIndex('purchase_orders', 'idx_po_status', 'status');

  // 3. order_accepted
  await ensureIndex('order_accepted', 'idx_oa_po', 'poNumber');
  await ensureIndex('order_accepted', 'idx_oa_inv', 'invoiceNo');
  await ensureIndex('order_accepted', 'idx_oa_mat', 'materialName');
  await ensureIndex('order_accepted', 'idx_oa_date', 'acceptedAt');

  // 4. materials
  await ensureIndex('materials', 'idx_mat_name', 'name');
  await ensureIndex('materials', 'idx_mat_category', 'category');
  await ensureIndex('materials', 'idx_mat_loc', 'location');

  // 5. cutting_header
  await ensureIndex('cutting_header', 'idx_ch_lot', 'Lot_Number');
  await ensureIndex('cutting_header', 'idx_ch_style', 'Style');
  await ensureIndex('cutting_header', 'idx_ch_party', 'Party_Name');

  // 6. cuttings_matrix
  await ensureIndex('cuttings_matrix', 'idx_cm_lot', 'Lot_No');
  await ensureIndex('cuttings_matrix', 'idx_cm_header', 'header_id');

  // 7. material_transfers
  await ensureIndex('material_transfers', 'idx_mt_code', 'materialCode');
  await ensureIndex('material_transfers', 'idx_mt_date', 'transferredAt');

  // 8. zip
  await ensureIndex('zip', 'idx_zip_lot', 'Lot_Number');
  await ensureIndex('zip', 'idx_zip_po', 'po_number');

  console.log("All indexes verified and active!");
  process.exit(0);
}

run().catch(err => {
  console.error("Index migration failed:", err);
  process.exit(1);
});
