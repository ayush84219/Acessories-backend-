import { pool } from './db.js';

const DEFAULT_API_KEY = process.env.GOOGLE_API_KEY || "";
const DEFAULT_SPREADSHEET_ID = process.env.PO_SPREADSHEET_ID || "";

export async function ensureOldPurchaseOrdersTable() {
  await pool.execute(`CREATE TABLE IF NOT EXISTS old_purchase_orders (
    po_number VARCHAR(100) PRIMARY KEY,
    supplier VARCHAR(255) DEFAULT '',
    order_date VARCHAR(50) DEFAULT '',
    order_time VARCHAR(50) DEFAULT '',
    expected_date VARCHAR(50) DEFAULT '',
    expected_time VARCHAR(50) DEFAULT '',
    lead_time_ms VARCHAR(50) DEFAULT '',
    lead_time_human VARCHAR(50) DEFAULT '',
    supervisor VARCHAR(255) DEFAULT '',
    total_amount DOUBLE DEFAULT 0,
    status VARCHAR(50) DEFAULT 'Pending',
    gate_in_at VARCHAR(100) DEFAULT '',
    received_at VARCHAR(100) DEFAULT '',
    created_at VARCHAR(100) DEFAULT '',
    updated_at VARCHAR(100) DEFAULT '',
    requisition_raised_by VARCHAR(255) DEFAULT '',
    authorized_by VARCHAR(255) DEFAULT '',
    lot_no VARCHAR(255) DEFAULT 'N/A',
    items_json LONGTEXT,
    synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_opo_supplier (supplier),
    INDEX idx_opo_status (status),
    INDEX idx_opo_order_date (order_date),
    INDEX idx_opo_lot_no (lot_no)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  // Ensure lot_no column and index exist on existing tables
  try {
    await pool.execute(`ALTER TABLE old_purchase_orders ADD COLUMN lot_no VARCHAR(255) DEFAULT 'N/A' AFTER authorized_by`);
  } catch (_) {}

  try {
    await pool.execute(`CREATE INDEX idx_opo_lot_no ON old_purchase_orders (lot_no)`);
  } catch (_) {}
}

export async function syncOldPurchaseOrdersFromGoogleSheet(options = {}) {
  const apiKey = options.apiKey || DEFAULT_API_KEY;
  const spreadsheetId = options.spreadsheetId || DEFAULT_SPREADSHEET_ID;

  await ensureOldPurchaseOrdersTable();

  const mainRange = "PO_Main!A:Q";
  const itemsRange = "PO_Items!A:I";
  const mapRange = "PO_Lot_PO_Mapping!A:D";
  const histRange = "PO_Lot_History!A:E";
  const recvRange = "PO_Lot_Receiving!A:F";

  const buildUrl = (range) => `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?key=${apiKey}`;

  console.log('[Old PO Sync] Fetching sheets data and comprehensive lot mapping...');
  const [mainRes, itemsRes, mapRes, histRes, recvRes] = await Promise.all([
    fetch(buildUrl(mainRange)),
    fetch(buildUrl(itemsRange)),
    fetch(buildUrl(mapRange)).catch(() => ({ ok: false })),
    fetch(buildUrl(histRange)).catch(() => ({ ok: false })),
    fetch(buildUrl(recvRange)).catch(() => ({ ok: false }))
  ]);

  if (!mainRes.ok) {
    const errText = await mainRes.text();
    throw new Error(`Failed to fetch PO_Main: HTTP ${mainRes.status} - ${errText.slice(0, 150)}`);
  }
  if (!itemsRes.ok) {
    const errText = await itemsRes.text();
    throw new Error(`Failed to fetch PO_Items: HTTP ${itemsRes.status} - ${errText.slice(0, 150)}`);
  }

  const [mainData, itemsData, mapData, histData, recvData] = await Promise.all([
    mainRes.json(),
    itemsRes.json(),
    mapRes.ok ? mapRes.json().catch(() => ({})) : {},
    histRes.ok ? histRes.json().catch(() => ({})) : {},
    recvRes.ok ? recvRes.json().catch(() => ({})) : {}
  ]);

  const mainRows = mainData.values || [];
  const itemsRows = itemsData.values || [];

  if (mainRows.length < 2) {
    return { success: true, count: 0, message: "No data rows found in PO_Main." };
  }

  // 1. Build Lot Mapping with normalized PO variations
  const poLotsMap = new Map(); // poNumber -> Set of lot strings
  const poLineLotsMap = new Map(); // `${poNumber}_${line}` -> lot string

  const registerLot = (po, line, lot) => {
    po = String(po || "").trim();
    line = String(line || "").trim();
    lot = String(lot || "").trim();
    if (!po || !lot) return;

    // Generate normalization keys: e.g. '0001' -> 'PO-0001', 'PO-000001', 'PO-1'
    const keys = [po];
    if (/^\d+$/.test(po)) {
      keys.push('PO-' + po);
      keys.push('PO-' + po.padStart(4, '0'));
      keys.push('PO-' + po.padStart(6, '0'));
    } else if (po.startsWith('PO-')) {
      const stripped = po.replace(/^PO-0*/i, '');
      if (stripped) {
        keys.push(stripped);
        keys.push('PO-' + stripped);
        keys.push('PO-' + stripped.padStart(4, '0'));
        keys.push('PO-' + stripped.padStart(6, '0'));
      }
    }

    for (const k of keys) {
      if (!poLotsMap.has(k)) poLotsMap.set(k, new Set());
      poLotsMap.get(k).add(lot);

      if (line) {
        poLineLotsMap.set(`${k}_${line}`, lot);
      }
    }
  };

  // Process PO_Lot_PO_Mapping (Col A: PO #, Col B: Line #, Col C: Lot No)
  (mapData.values || []).slice(1).forEach(r => {
    registerLot(r[0], r[1], r[2]);
  });

  // Process PO_Lot_History (Col B: Lot No, Col D: PO #, Col E: Line #)
  (histData.values || []).slice(1).forEach(r => {
    registerLot(r[3], r[4], r[1]);
  });

  // Process PO_Lot_Receiving (Col C: PO #, Col D: Line #, Col E: Lot No)
  (recvData.values || []).slice(1).forEach(r => {
    registerLot(r[2], r[3], r[4]);
  });

  // 2. Cross-reference Design BOM -> Materials -> PO mapping
  try {
    const [designs] = await pool.query('SELECT id, name, bom FROM designs');
    const [materials] = await pool.query('SELECT id, name, poNumber FROM materials');
    const matToPo = new Map();
    materials.forEach(m => {
      if (m.poNumber) matToPo.set(m.id, m.poNumber);
    });

    for (const d of designs) {
      const lot = String(d.name || d.id || '').trim();
      let bom = [];
      try { bom = typeof d.bom === 'string' ? JSON.parse(d.bom) : (d.bom || []); } catch(_) {}
      for (const b of bom) {
        if (b.materialId && matToPo.has(b.materialId)) {
          registerLot(matToPo.get(b.materialId), '1', lot);
        }
      }
    }
  } catch (_) {}

  // 3. Cross-reference internal MySQL zip & doori tables
  try {
    const [zipRows] = await pool.query("SELECT po_number, Lot_Number FROM zip WHERE po_number IS NOT NULL AND po_number != '' AND Lot_Number IS NOT NULL AND Lot_Number != ''");
    zipRows.forEach(z => registerLot(z.po_number, '1', z.Lot_Number));
  } catch (_) {}

  try {
    const [dooriRows] = await pool.query("SELECT po_number, Lot_Number FROM doori WHERE po_number IS NOT NULL AND po_number != '' AND Lot_Number IS NOT NULL AND Lot_Number != ''");
    dooriRows.forEach(d => registerLot(d.po_number, '1', d.Lot_Number));
  } catch (_) {}

  // 4. Cutting header fabric PO mentions (e.g. "K.C PO NO 4058")
  try {
    const [chRows] = await pool.query("SELECT Lot_Number, Fabric FROM cutting_header WHERE Fabric LIKE '%PO%'");
    chRows.forEach(c => {
      const m = (c.Fabric || '').match(/PO\s*(?:NO\.?)?\s*(\d+)/i);
      if (m && c.Lot_Number) registerLot('PO-' + m[1], '1', String(c.Lot_Number).trim());
    });
  } catch (_) {}

  // 5. Gather known lot numbers from cutting_header and designs for text extraction
  const knownLots = new Set();
  try {
    const [chLots] = await pool.query("SELECT DISTINCT Lot_Number FROM cutting_header WHERE Lot_Number != ''");
    chLots.forEach(c => knownLots.add(String(c.Lot_Number).trim()));
    const [dLots] = await pool.query("SELECT DISTINCT id, name FROM designs");
    dLots.forEach(d => {
      if (d.id) knownLots.add(String(d.id).trim());
      if (d.name) knownLots.add(String(d.name).trim());
    });
  } catch (_) {}

  // 6. Parse items and group by PO #
  const itemsHeaders = (itemsRows[0] || []).map(h => String(h || "").trim());
  const poToItemsMap = new Map();

  for (let i = 1; i < itemsRows.length; i++) {
    const row = itemsRows[i];
    const poNum = String(row[0] || "").trim();
    if (!poNum) continue;

    const item = {};
    itemsHeaders.forEach((hdr, idx) => {
      item[hdr] = row[idx] !== undefined ? String(row[idx]).trim() : "";
    });

    const line = parseInt(item["Line #"]) || (poToItemsMap.get(poNum)?.length || 0) + 1;
    const desc = item["Description"] || "";

    // 1) Explicit regex match for Lot (e.g. "LOT NO: 6161", "LOT 11883", "LOT (12030, 12031)")
    const descLotMatch = desc.match(/\b(?:lot|lot\s*no\.?|lot\s*#)\s*[:#-]?\s*\(?([0-9][0-9\s,/-]*[0-9]|[0-9]+)\)?/i);
    if (descLotMatch && descLotMatch[1]) {
      registerLot(poNum, String(line), descLotMatch[1].trim());
    }

    // 2) Match bracketed lot number e.g. "(61057)"
    const bracketMatch = desc.match(/\(([0-9]{4,6})\)/);
    if (bracketMatch && knownLots.has(bracketMatch[1])) {
      registerLot(poNum, String(line), bracketMatch[1].trim());
    }

    // 3) Match words in description against known cutting lots
    const words = desc.split(/[^0-9a-zA-Z]+/);
    for (const w of words) {
      if (knownLots.has(w) && w.length >= 4) {
        registerLot(poNum, String(line), w);
      }
    }

    const assignedLot = poLineLotsMap.get(`${poNum}_${line}`) || "";

    const parsedItem = {
      line,
      department: item["Department"] || "",
      description: desc,
      shade: item["Shade"] || "",
      uom: item["UOM"] || "PCS",
      qty: parseFloat(item["Qty"]) || 0,
      rate: parseFloat(item["Rate"]) || 0,
      amount: parseFloat(item["Amount"]) || ((parseFloat(item["Qty"]) || 0) * (parseFloat(item["Rate"]) || 0)),
      lot_no: assignedLot,
      createdAt: item["Created At"] || ""
    };

    if (!poToItemsMap.has(poNum)) {
      poToItemsMap.set(poNum, []);
    }
    poToItemsMap.get(poNum).push(parsedItem);
  }

  // 7. Ensure line items inherit the PO-level lot if no individual line lot was set
  for (const [poNum, items] of poToItemsMap.entries()) {
    const poLots = poLotsMap.get(poNum);
    const poLotStr = poLots && poLots.size > 0 ? Array.from(poLots).join(', ') : "";
    if (poLotStr) {
      items.forEach(it => {
        if (!it.lot_no) {
          it.lot_no = poLotStr;
        }
      });
    }
  }

  // 8. Parse main rows and prepare batch upsert
  const mainHeaders = (mainRows[0] || []).map(h => String(h || "").trim());
  const headerIdx = (name) => mainHeaders.findIndex(h => h.toLowerCase() === name.toLowerCase());

  const idxPo = headerIdx("PO #");
  const idxSup = headerIdx("Supplier");
  const idxODate = headerIdx("Order Date");
  const idxOTime = headerIdx("Order Time");
  const idxEDate = headerIdx("Expected Date");
  const idxETime = headerIdx("Expected Time");
  const idxLeadMs = headerIdx("Lead Time (ms)");
  const idxLeadHuman = headerIdx("Lead Time (human)");
  const idxSupervisor = headerIdx("Supervisor");
  const idxTotal = headerIdx("Total Amount");
  const idxStatus = headerIdx("Status");
  const idxGateIn = headerIdx("Gate In At");
  const idxRecvAt = headerIdx("Received At");
  const idxCreated = headerIdx("Created At");
  const idxUpdated = headerIdx("Updated At");
  const idxReqBy = headerIdx("REQUISITION RAISED BY");
  const idxAuthBy = headerIdx("AUTHORIZED BY");

  const records = [];
  for (let i = 1; i < mainRows.length; i++) {
    const r = mainRows[i];
    const poNum = idxPo >= 0 ? String(r[idxPo] || "").trim() : "";
    if (!poNum) continue;

    const items = poToItemsMap.get(poNum) || [];
    const totalAmount = parseFloat(r[idxTotal]) || items.reduce((sum, it) => sum + (it.amount || 0), 0);

    const poLots = poLotsMap.get(poNum);
    // If a PO has lots, store comma-separated lot numbers; if not, store 'N/A' so it is clear and not a blank cell
    const lotNo = poLots && poLots.size > 0 ? Array.from(poLots).join(', ') : "N/A";

    records.push([
      poNum,
      idxSup >= 0 ? String(r[idxSup] || "").trim() : "",
      idxODate >= 0 ? String(r[idxODate] || "").trim() : "",
      idxOTime >= 0 ? String(r[idxOTime] || "").trim() : "",
      idxEDate >= 0 ? String(r[idxEDate] || "").trim() : "",
      idxETime >= 0 ? String(r[idxETime] || "").trim() : "",
      idxLeadMs >= 0 ? String(r[idxLeadMs] || "").trim() : "",
      idxLeadHuman >= 0 ? String(r[idxLeadHuman] || "").trim() : "",
      idxSupervisor >= 0 ? String(r[idxSupervisor] || "").trim() : "",
      totalAmount,
      idxStatus >= 0 ? String(r[idxStatus] || "Pending").trim() : "Pending",
      idxGateIn >= 0 ? String(r[idxGateIn] || "").trim() : "",
      idxRecvAt >= 0 ? String(r[idxRecvAt] || "").trim() : "",
      idxCreated >= 0 ? String(r[idxCreated] || "").trim() : "",
      idxUpdated >= 0 ? String(r[idxUpdated] || "").trim() : "",
      idxReqBy >= 0 ? String(r[idxReqBy] || "").trim() : "",
      idxAuthBy >= 0 ? String(r[idxAuthBy] || "").trim() : "",
      lotNo,
      JSON.stringify(items)
    ]);
  }

  console.log(`[Old PO Sync] Prepared ${records.length} PO records with Lot Numbers for database upsert...`);

  // Batch insert in chunks of 200
  const CHUNK_SIZE = 200;
  let insertedOrUpdated = 0;

  for (let c = 0; c < records.length; c += CHUNK_SIZE) {
    const chunk = records.slice(c, c + CHUNK_SIZE);
    const placeholders = chunk.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").join(", ");
    const flatValues = chunk.flat();

    const sql = `
      INSERT INTO old_purchase_orders (
        po_number, supplier, order_date, order_time, expected_date, expected_time,
        lead_time_ms, lead_time_human, supervisor, total_amount, status,
        gate_in_at, received_at, created_at, updated_at, requisition_raised_by, authorized_by,
        lot_no, items_json
      ) VALUES ${placeholders}
      ON DUPLICATE KEY UPDATE
        supplier = VALUES(supplier),
        order_date = VALUES(order_date),
        order_time = VALUES(order_time),
        expected_date = VALUES(expected_date),
        expected_time = VALUES(expected_time),
        lead_time_ms = VALUES(lead_time_ms),
        lead_time_human = VALUES(lead_time_human),
        supervisor = VALUES(supervisor),
        total_amount = VALUES(total_amount),
        status = VALUES(status),
        gate_in_at = VALUES(gate_in_at),
        received_at = VALUES(received_at),
        updated_at = VALUES(updated_at),
        requisition_raised_by = VALUES(requisition_raised_by),
        authorized_by = VALUES(authorized_by),
        lot_no = VALUES(lot_no),
        items_json = VALUES(items_json),
        synced_at = CURRENT_TIMESTAMP
    `;

    await pool.query(sql, flatValues);
    insertedOrUpdated += chunk.length;
  }

  console.log(`[Old PO Sync] Successfully synchronized ${insertedOrUpdated} POs into MySQL old_purchase_orders table with lot numbers.`);
  return {
    success: true,
    totalRecords: records.length,
    syncedCount: insertedOrUpdated,
    syncedAt: new Date().toISOString()
  };
}

export async function getOldPurchaseOrders(filter = {}) {
  await ensureOldPurchaseOrdersTable();

  const { search = '', status = 'ALL', supplier = '', hasLot = 'ALL', limit = 3500, offset = 0 } = filter;

  let whereClauses = [];
  let params = [];

  if (search) {
    whereClauses.push('(po_number LIKE ? OR supplier LIKE ? OR supervisor LIKE ? OR lot_no LIKE ?)');
    const s = `%${search}%`;
    params.push(s, s, s, s);
  }

  if (status && status !== 'ALL') {
    whereClauses.push('UPPER(status) = ?');
    params.push(status.toUpperCase());
  }

  if (supplier && supplier !== 'ALL') {
    whereClauses.push('supplier = ?');
    params.push(supplier);
  }

  if (hasLot === 'YES') {
    whereClauses.push("lot_no != '' AND lot_no != 'N/A'");
  } else if (hasLot === 'NO') {
    whereClauses.push("(lot_no = '' OR lot_no = 'N/A')");
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

  // Get total count and stats
  const [statsRows] = await pool.query(`
    SELECT 
      COUNT(*) as totalCount,
      COALESCE(SUM(total_amount), 0) as totalSpend,
      SUM(CASE WHEN UPPER(status) IN ('APPROVED', 'COMPLETED', 'RECEIVED') THEN 1 ELSE 0 END) as approvedCount,
      SUM(CASE WHEN UPPER(status) IN ('PENDING', 'ACTIVE', 'DRAFT', 'ISSUED') THEN 1 ELSE 0 END) as pendingCount,
      SUM(CASE WHEN lot_no != '' AND lot_no != 'N/A' THEN 1 ELSE 0 END) as lotCount
    FROM old_purchase_orders
    ${whereSql}
  `, params);

  // Get distinct suppliers for dropdown
  const [supplierRows] = await pool.query(`
    SELECT DISTINCT supplier 
    FROM old_purchase_orders 
    WHERE supplier != '' 
    ORDER BY supplier ASC
  `);

  // Query PO list
  const sql = `
    SELECT 
      po_number, supplier, order_date, order_time, expected_date, expected_time,
      lead_time_ms, lead_time_human, supervisor, total_amount, status,
      gate_in_at, received_at, created_at, updated_at, requisition_raised_by, authorized_by,
      lot_no, items_json, synced_at
    FROM old_purchase_orders
    ${whereSql}
    ORDER BY 
      CASE WHEN lot_no != '' AND lot_no != 'N/A' THEN 0 ELSE 1 END,
      po_number DESC
    LIMIT ? OFFSET ?
  `;

  const [rows] = await pool.query(sql, [...params, Number(limit), Number(offset)]);

  const parsedRows = rows.map(r => {
    let items = [];
    try {
      items = typeof r.items_json === 'string' ? JSON.parse(r.items_json) : (r.items_json || []);
    } catch (_) {
      items = [];
    }

    const lotNo = (r.lot_no && r.lot_no !== 'N/A') ? r.lot_no : "";

    // Ensure each item has lot_no attached
    const enrichedItems = items.map(it => ({
      ...it,
      lot_no: (it.lot_no && it.lot_no !== 'N/A') ? it.lot_no : lotNo,
      "Lot #": (it.lot_no && it.lot_no !== 'N/A') ? it.lot_no : lotNo
    }));

    return {
      "PO #": r.po_number,
      "Supplier": r.supplier,
      "Order Date": r.order_date,
      "Order Time": r.order_time,
      "Expected Date": r.expected_date,
      "Expected Time": r.expected_time,
      "Lead Time (ms)": r.lead_time_ms,
      "Lead Time (human)": r.lead_time_human,
      "Supervisor": r.supervisor,
      "Total Amount": r.total_amount,
      "Status": r.status,
      "Gate In At": r.gate_in_at,
      "Received At": r.received_at,
      "Created At": r.created_at,
      "Updated At": r.updated_at,
      "REQUISITION RAISED BY": r.requisition_raised_by,
      "AUTHORIZED BY": r.authorized_by,
      "Lot No": lotNo,
      "lot_no": r.lot_no || "N/A",
      "Items": enrichedItems,
      "ItemCount": enrichedItems.length,
      "synced_at": r.synced_at
    };
  });

  return {
    records: parsedRows,
    stats: {
      total: statsRows[0]?.totalCount || 0,
      spend: statsRows[0]?.totalSpend || 0,
      approved: statsRows[0]?.approvedCount || 0,
      pending: statsRows[0]?.pendingCount || 0,
      withLot: statsRows[0]?.lotCount || 0
    },
    suppliers: ["ALL", ...supplierRows.map(s => s.supplier)],
    count: parsedRows.length
  };
}

export async function getOldPurchaseOrderByNumber(poNumber) {
  await ensureOldPurchaseOrdersTable();
  const [rows] = await pool.query(
    'SELECT * FROM old_purchase_orders WHERE po_number = ? LIMIT 1',
    [poNumber]
  );
  if (rows.length === 0) return null;

  const r = rows[0];
  let items = [];
  try {
    items = typeof r.items_json === 'string' ? JSON.parse(r.items_json) : (r.items_json || []);
  } catch (_) {
    items = [];
  }

  const lotNo = (r.lot_no && r.lot_no !== 'N/A') ? r.lot_no : "";
  const enrichedItems = items.map(it => ({
    ...it,
    lot_no: (it.lot_no && it.lot_no !== 'N/A') ? it.lot_no : lotNo,
    "Lot #": (it.lot_no && it.lot_no !== 'N/A') ? it.lot_no : lotNo
  }));

  return {
    "PO #": r.po_number,
    "Supplier": r.supplier,
    "Order Date": r.order_date,
    "Order Time": r.order_time,
    "Expected Date": r.expected_date,
    "Expected Time": r.expected_time,
    "Lead Time (ms)": r.lead_time_ms,
    "Lead Time (human)": r.lead_time_human,
    "Supervisor": r.supervisor,
    "Total Amount": r.total_amount,
    "Status": r.status,
    "Gate In At": r.gate_in_at,
    "Received At": r.received_at,
    "Created At": r.created_at,
    "Updated At": r.updated_at,
    "REQUISITION RAISED BY": r.requisition_raised_by,
    "AUTHORIZED BY": r.authorized_by,
    "Lot No": lotNo,
    "lot_no": r.lot_no || "N/A",
    "Items": enrichedItems,
    "synced_at": r.synced_at
  };
}
