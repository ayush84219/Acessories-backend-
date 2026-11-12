import { pool } from './db.js';

const DEFAULT_API_KEY = process.env.GOOGLE_API_KEY || "";
const DEFAULT_SPREADSHEET_ID = process.env.RGP_SPREADSHEET_ID || "1BZ-ufmxeqa9XdU-jkuIgeNxHvhnYKjWj4UpnI3bHJKo";

export async function ensureOldRgpTable() {
  await pool.execute(`CREATE TABLE IF NOT EXISTS old_rgp (
    rgp_no VARCHAR(100) PRIMARY KEY,
    date VARCHAR(100) DEFAULT '',
    rgp_type VARCHAR(100) DEFAULT '',
    department VARCHAR(100) DEFAULT '',
    vendor VARCHAR(255) DEFAULT '',
    purpose VARCHAR(255) DEFAULT '',
    item_description TEXT DEFAULT NULL,
    quantity_sent VARCHAR(100) DEFAULT '',
    uom VARCHAR(50) DEFAULT '',
    expected_return_date VARCHAR(100) DEFAULT '',
    vehicle_no VARCHAR(100) DEFAULT '',
    authorized_by VARCHAR(255) DEFAULT '',
    returned_quantity VARCHAR(100) DEFAULT '',
    return_date VARCHAR(100) DEFAULT '',
    remarks TEXT DEFAULT NULL,
    status VARCHAR(100) DEFAULT '',
    prepared_by VARCHAR(255) DEFAULT '',
    gate_in_at VARCHAR(100) DEFAULT '',
    gate_in_by VARCHAR(100) DEFAULT '',
    gate_out_at VARCHAR(100) DEFAULT '',
    gate_out_by VARCHAR(100) DEFAULT '',
    raw_main_json LONGTEXT,
    items_json LONGTEXT,
    synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_old_rgp_vendor (vendor(191)),
    INDEX idx_old_rgp_type (rgp_type),
    INDEX idx_old_rgp_status (status),
    INDEX idx_old_rgp_date (date)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
}

function normalizeRgpNo(val) {
  if (!val) return "";
  return String(val).trim().toUpperCase();
}

export async function syncOldRgpFromGoogleSheet(options = {}) {
  const apiKey = options.apiKey || DEFAULT_API_KEY;
  const spreadsheetId = options.spreadsheetId || DEFAULT_SPREADSHEET_ID;

  if (!apiKey || !spreadsheetId) {
    throw new Error("Missing Google API Key or RGP Spreadsheet ID");
  }

  await ensureOldRgpTable();

  const mainUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent("Fabric_RGP!A1:Z")}?key=${apiKey}`;
  const itemsUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent("Fabric_RGP_Items!A1:Z")}?key=${apiKey}`;

  console.log('[Old RGP Sync] Fetching Fabric_RGP and Fabric_RGP_Items from Google Sheets...');
  const [mainRes, itemsRes] = await Promise.all([
    fetch(mainUrl),
    fetch(itemsUrl)
  ]);

  if (!mainRes.ok) {
    const errText = await mainRes.text();
    throw new Error(`Failed to fetch Fabric_RGP: HTTP ${mainRes.status} - ${errText.slice(0, 150)}`);
  }

  const [mainData, itemsData] = await Promise.all([
    mainRes.json(),
    itemsRes.ok ? itemsRes.json() : { values: [] }
  ]);

  const mainRows = mainData.values || [];
  const itemsRows = itemsData.values || [];

  if (mainRows.length < 2) {
    return { success: true, count: 0, message: "No data rows found in Fabric_RGP." };
  }

  // 1. Parse Items and group by RGP No
  const rgpToItemsMap = new Map();
  if (itemsRows.length > 0) {
    const itemsHeaders = itemsRows[0].map(h => String(h || "").trim());
    for (let i = 1; i < itemsRows.length; i++) {
      const row = itemsRows[i];
      const rgpNo = normalizeRgpNo(row[0]);
      if (!rgpNo) continue;

      const itemObj = {};
      itemsHeaders.forEach((hdr, idx) => {
        itemObj[hdr] = row[idx] !== undefined ? String(row[idx]).trim() : "";
      });

      if (!rgpToItemsMap.has(rgpNo)) {
        rgpToItemsMap.set(rgpNo, []);
      }
      rgpToItemsMap.get(rgpNo).push(itemObj);
    }
  }

  // 2. Parse Main Rows and prepare DB records
  const mainHeaders = mainRows[0].map(h => String(h || "").trim());
  const headerIdx = (name) => mainHeaders.findIndex(h => h.toLowerCase() === name.toLowerCase());

  const idxRgpNo = headerIdx("RGP No") >= 0 ? headerIdx("RGP No") : headerIdx("RGP No.");
  const idxDate = headerIdx("Date");
  const idxRgpType = headerIdx("RGP Type");
  const idxDept = headerIdx("Department");
  const idxVendor = headerIdx("Vendor / Party") >= 0 ? headerIdx("Vendor / Party") : headerIdx("Vendor");
  const idxPurpose = headerIdx("Purpose");
  const idxItemDesc = headerIdx("Item Description");
  const idxQtySent = headerIdx("Quantity Sent");
  const idxUom = headerIdx("UOM");
  const idxExpected = headerIdx("Expected Return Date");
  const idxVehicle = headerIdx("Vehicle No") >= 0 ? headerIdx("Vehicle No") : headerIdx("Vehicle No.");
  const idxAuthBy = headerIdx("Authorized By");
  const idxRetQty = headerIdx("Returned Quantity");
  const idxRetDate = headerIdx("Return Date");
  const idxRemarks = headerIdx("Remarks");
  const idxStatus = headerIdx("Status");
  const idxPreparedBy = headerIdx("Prepared By");
  const idxGateInAt = headerIdx("Gate In At");
  const idxGateInBy = headerIdx("Gate In By");
  const idxGateOutAt = headerIdx("Gate Out At");
  const idxGateOutBy = headerIdx("Gate Out By");

  const records = [];
  const processedRgpNos = new Set();

  for (let i = 1; i < mainRows.length; i++) {
    const row = mainRows[i];
    const rgpNoRaw = idxRgpNo >= 0 ? String(row[idxRgpNo] || "").trim() : "";
    if (!rgpNoRaw) continue;

    const rgpNoNorm = normalizeRgpNo(rgpNoRaw);
    if (processedRgpNos.has(rgpNoNorm)) continue;
    processedRgpNos.add(rgpNoNorm);

    // Build raw main object matching Google Sheet columns for 100% compatibility with RgpRedownload
    const rawMainObj = {};
    mainHeaders.forEach((hdr, idx) => {
      rawMainObj[hdr] = row[idx] !== undefined ? String(row[idx]).trim() : "";
    });

    const items = rgpToItemsMap.get(rgpNoNorm) || [];

    records.push([
      rgpNoRaw,
      idxDate >= 0 ? String(row[idxDate] || "").trim() : "",
      idxRgpType >= 0 ? String(row[idxRgpType] || "").trim() : "",
      idxDept >= 0 ? String(row[idxDept] || "").trim() : "",
      idxVendor >= 0 ? String(row[idxVendor] || "").trim() : "",
      idxPurpose >= 0 ? String(row[idxPurpose] || "").trim() : "",
      idxItemDesc >= 0 ? String(row[idxItemDesc] || "").trim() : "",
      idxQtySent >= 0 ? String(row[idxQtySent] || "").trim() : "",
      idxUom >= 0 ? String(row[idxUom] || "").trim() : "",
      idxExpected >= 0 ? String(row[idxExpected] || "").trim() : "",
      idxVehicle >= 0 ? String(row[idxVehicle] || "").trim() : "",
      idxAuthBy >= 0 ? String(row[idxAuthBy] || "").trim() : "",
      idxRetQty >= 0 ? String(row[idxRetQty] || "").trim() : "",
      idxRetDate >= 0 ? String(row[idxRetDate] || "").trim() : "",
      idxRemarks >= 0 ? String(row[idxRemarks] || "").trim() : "",
      idxStatus >= 0 ? String(row[idxStatus] || "").trim() : "Dispatched",
      idxPreparedBy >= 0 ? String(row[idxPreparedBy] || "").trim() : "",
      idxGateInAt >= 0 ? String(row[idxGateInAt] || "").trim() : "",
      idxGateInBy >= 0 ? String(row[idxGateInBy] || "").trim() : "",
      idxGateOutAt >= 0 ? String(row[idxGateOutAt] || "").trim() : "",
      idxGateOutBy >= 0 ? String(row[idxGateOutBy] || "").trim() : "",
      JSON.stringify(rawMainObj),
      JSON.stringify(items)
    ]);
  }

  console.log(`[Old RGP Sync] Prepared ${records.length} RGP records with items for database upsert...`);

  // Batch insert in chunks of 150
  const CHUNK_SIZE = 150;
  let insertedOrUpdated = 0;

  for (let c = 0; c < records.length; c += CHUNK_SIZE) {
    const chunk = records.slice(c, c + CHUNK_SIZE);
    const placeholders = chunk.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").join(", ");
    const flatValues = chunk.flat();

    const sql = `
      INSERT INTO old_rgp (
        rgp_no, date, rgp_type, department, vendor, purpose, item_description,
        quantity_sent, uom, expected_return_date, vehicle_no, authorized_by,
        returned_quantity, return_date, remarks, status, prepared_by,
        gate_in_at, gate_in_by, gate_out_at, gate_out_by,
        raw_main_json, items_json
      ) VALUES ${placeholders}
      ON DUPLICATE KEY UPDATE
        date = VALUES(date),
        rgp_type = VALUES(rgp_type),
        department = VALUES(department),
        vendor = VALUES(vendor),
        purpose = VALUES(purpose),
        item_description = VALUES(item_description),
        quantity_sent = VALUES(quantity_sent),
        uom = VALUES(uom),
        expected_return_date = VALUES(expected_return_date),
        vehicle_no = VALUES(vehicle_no),
        authorized_by = VALUES(authorized_by),
        returned_quantity = VALUES(returned_quantity),
        return_date = VALUES(return_date),
        remarks = VALUES(remarks),
        status = VALUES(status),
        prepared_by = VALUES(prepared_by),
        gate_in_at = VALUES(gate_in_at),
        gate_in_by = VALUES(gate_in_by),
        gate_out_at = VALUES(gate_out_at),
        gate_out_by = VALUES(gate_out_by),
        raw_main_json = VALUES(raw_main_json),
        items_json = VALUES(items_json),
        synced_at = CURRENT_TIMESTAMP
    `;

    await pool.query(sql, flatValues);
    insertedOrUpdated += chunk.length;
  }

  console.log(`[Old RGP Sync] Successfully synchronized ${insertedOrUpdated} RGPs into MySQL old_rgp table.`);
  return {
    success: true,
    totalRecords: records.length,
    syncedCount: insertedOrUpdated,
    syncedAt: new Date().toISOString()
  };
}

export async function getOldRgps(filter = {}) {
  await ensureOldRgpTable();

  const { search = '', status = 'ALL', vendor = '', limit = 3500, offset = 0 } = filter;

  let whereClauses = [];
  let params = [];

  if (search) {
    whereClauses.push('(rgp_no LIKE ? OR vendor LIKE ? OR department LIKE ? OR rgp_type LIKE ? OR purpose LIKE ?)');
    const s = `%${search}%`;
    params.push(s, s, s, s, s);
  }

  if (status && status !== 'ALL') {
    whereClauses.push('UPPER(status) = ?');
    params.push(status.toUpperCase());
  }

  if (vendor && vendor !== 'ALL') {
    whereClauses.push('vendor = ?');
    params.push(vendor);
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

  // Get total count
  const [countRows] = await pool.query(`
    SELECT COUNT(*) as totalCount, MAX(synced_at) as lastSyncedAt
    FROM old_rgp
    ${whereSql}
  `, params);

  const totalCount = countRows[0]?.totalCount || 0;
  const lastSyncedAt = countRows[0]?.lastSyncedAt || null;

  // Query RGP list
  const sql = `
    SELECT 
      rgp_no, date, rgp_type, department, vendor, purpose, item_description,
      quantity_sent, uom, expected_return_date, vehicle_no, authorized_by,
      returned_quantity, return_date, remarks, status, prepared_by,
      gate_in_at, gate_in_by, gate_out_at, gate_out_by,
      raw_main_json, items_json, synced_at
    FROM old_rgp
    ${whereSql}
    ORDER BY synced_at DESC, rgp_no ASC
    LIMIT ? OFFSET ?
  `;

  const parsedLimit = Math.min(Math.max(parseInt(limit) || 3500, 1), 10000);
  const parsedOffset = Math.max(parseInt(offset) || 0, 0);

  const [rows] = await pool.query(sql, [...params, parsedLimit, parsedOffset]);

  const mainRecords = [];
  const itemsRecords = [];

  const records = rows.map(r => {
    let mainObj = {};
    if (r.raw_main_json) {
      try {
        mainObj = typeof r.raw_main_json === 'string' ? JSON.parse(r.raw_main_json) : r.raw_main_json;
      } catch (_) {
        mainObj = {};
      }
    } else {
      mainObj = {
        "RGP No": r.rgp_no,
        "Date": r.date,
        "RGP Type": r.rgp_type,
        "Department": r.department,
        "Vendor / Party": r.vendor,
        "Purpose": r.purpose,
        "Item Description": r.item_description,
        "Quantity Sent": r.quantity_sent,
        "UOM": r.uom,
        "Expected Return Date": r.expected_return_date,
        "Vehicle No": r.vehicle_no,
        "Authorized By": r.authorized_by,
        "Returned Quantity": r.returned_quantity,
        "Return Date": r.return_date,
        "Remarks": r.remarks,
        "Status": r.status,
        "Prepared By": r.prepared_by,
        "Gate In At": r.gate_in_at,
        "Gate In By": r.gate_in_by,
        "Gate Out At": r.gate_out_at,
        "Gate Out By": r.gate_out_by
      };
    }

    let items = [];
    if (r.items_json) {
      try {
        items = typeof r.items_json === 'string' ? JSON.parse(r.items_json) : r.items_json;
      } catch (_) {
        items = [];
      }
    }

    mainRecords.push(mainObj);
    if (Array.isArray(items) && items.length > 0) {
      itemsRecords.push(...items);
    }

    return {
      ...mainObj,
      items,
      synced_at: r.synced_at
    };
  });

  return {
    success: true,
    totalCount,
    lastSyncedAt,
    records,
    mainRecords,
    itemsRecords
  };
}

export async function getOldRgpByNumber(rgpNo) {
  await ensureOldRgpTable();

  const [rows] = await pool.execute(
    'SELECT * FROM old_rgp WHERE rgp_no = ? OR LOWER(rgp_no) = LOWER(?)',
    [rgpNo, rgpNo]
  );

  if (rows.length === 0) return null;

  const r = rows[0];
  let mainObj = {};
  if (r.raw_main_json) {
    try {
      mainObj = typeof r.raw_main_json === 'string' ? JSON.parse(r.raw_main_json) : r.raw_main_json;
    } catch (_) {}
  }

  let items = [];
  if (r.items_json) {
    try {
      items = typeof r.items_json === 'string' ? JSON.parse(r.items_json) : r.items_json;
    } catch (_) {}
  }

  return {
    ...mainObj,
    items,
    synced_at: r.synced_at
  };
}

