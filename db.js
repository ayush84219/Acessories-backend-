import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '.env') });

// ── MySQL Connection Pool ──────────────────────────────────────────────────────
const getPoolConfig = () => {
  const connectionUri = process.env.MYSQL_URL || process.env.DATABASE_URL;
  if (connectionUri) {
    try {
      const parsedUrl = new URL(connectionUri);
      return {
        host: parsedUrl.hostname,
        port: Number(parsedUrl.port) || 3306,
        user: decodeURIComponent(parsedUrl.username),
        password: decodeURIComponent(parsedUrl.password),
        database: parsedUrl.pathname.replace(/^\//, '') || 'defaultdb',
        ssl: { rejectUnauthorized: false },
        waitForConnections: true,
        connectionLimit: 25,
        queueLimit: 0,
        enableKeepAlive: true,
        keepAliveInitialDelay: 10000,
        connectTimeout: 30000,
      };
    } catch (e) {
      console.warn('[DB] Could not parse connection URL, falling back to individual variables:', e.message);
    }
  }

  const host = (process.env.MYSQL_HOST || process.env.DB_HOST || 'localhost').trim();
  const isAivenOrRemote = host.includes('aivencloud.com') || host.includes('railway.internal') || process.env.MYSQL_SSL === 'true';

  const config = {
    host: host,
    port: Number(process.env.MYSQL_PORT || process.env.DB_PORT) || 3306,
    user: (process.env.MYSQL_USER || process.env.DB_USER || 'root').trim(),
    password: process.env.MYSQL_PASSWORD ?? process.env.DB_PASSWORD ?? 'Ayush123',
    database: (process.env.MYSQL_DATABASE || process.env.DB_NAME || 'accessories2').trim(),
    waitForConnections: true,
    connectionLimit: 25,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000,
    connectTimeout: 30000,
  };

  if (isAivenOrRemote && process.env.MYSQL_SSL !== 'false') {
    config.ssl = { rejectUnauthorized: false };
  }

  return config;
};

const pool = mysql.createPool(getPoolConfig());

// Periodic connection pool keepalive (runs every 30s to keep connection pool warm & healthy)
setInterval(async () => {
  try {
    const conn = await pool.getConnection();
    await conn.query('SELECT 1');
    conn.release();
  } catch (err) {
    console.warn('[DB Heartbeat] Connection check warning:', err.message);
  }
}, 30000).unref();

// ── Seed Data ─────────────────────────────────────────────────────────────────

const initialMaterials = [
  { id: 'M1302', name: 'Organic Cotton Fabric Roll', category: 'Fabric', stock: 2400, unit: 'meters', cost: 25.00, threshold: 200, color: 'Pure White', location: 'Main Store' },
  { id: 'M1303', name: 'Indigo Denim Raw Roll', category: 'Fabric', stock: 850, unit: 'meters', cost: 45.00, threshold: 150, color: 'Raw Deep Indigo', location: 'Main Store' },
  { id: 'M1304', name: 'YKK Brass Zippers (15cm)', category: 'Trim', stock: 150, unit: 'pieces', cost: 2.50, threshold: 200, color: 'Matte Gold', location: 'Main Store' },
  { id: 'M1305', name: 'Polyester Thread Spool', category: 'Trim', stock: 45, unit: 'rolls', cost: 8.00, threshold: 50, color: 'Neutral Gray', location: 'Main Store' },
  { id: 'M1306', name: 'Metal Rivets (Pack of 100)', category: 'Trim', stock: 60, unit: 'pieces', cost: 5.00, threshold: 20, color: 'Silver Metallic', location: 'Main Store' },
  { id: 'M1307', name: 'Printed Satin Brand Labels', category: 'Accessory', stock: 500, unit: 'pieces', cost: 0.80, threshold: 100, color: 'Glossy White', location: 'Main Store' }
];

const initialDesigns = [
  {
    id: '11000', name: 'Summer Denim Jacket', lotNo2: 'MH-4458', brand: 'Zara',
    category: 'JACKET', designer: 'Admin', fabricType: 'Raw Denim Cotton 100%',
    targetSizes: 'S, M, L, XL', colorCode: '#1e40af', status: 'In Verification',
    date: '10/08/2023', comments: '', section: 'Men', season: 'Winter', style: 'ST-9921',
    tapeLace: 'No', bottomType: 'N/A', zip: 'Yes', sticker: 'No', collar: 'No', bone: 'No', fullBaju: 'No',
    bom: JSON.stringify([
      { name: 'Zip', status: 'Yes', detail: '1', description: 'YKK Brass Zippers (15cm)', materialId: 'M1304' },
      { name: 'Button', status: 'Yes', detail: '6', description: 'Metal Rivets (Pack of 100)', materialId: 'M1306' },
      { name: 'Elastic', status: 'No', detail: '', description: '', materialId: '' },
      { name: 'Tape / Lace', status: 'No', detail: '', description: '', materialId: '' },
      { name: 'Rib', status: 'No', detail: '', description: '', materialId: '' },
      { name: 'Collar', status: 'No', detail: '', description: '', materialId: '' },
      { name: 'Sticker / Label', status: 'Yes', detail: '1', description: 'Printed Satin Brand Labels', materialId: 'M1307' },
      { name: 'Thread', status: 'Yes', detail: '1', description: 'Polyester Thread Spool', materialId: 'M1305' },
      { name: 'Pocket', status: 'Yes', detail: '2', description: 'Chest pockets', materialId: '' },
      { name: 'Drawstring / Nara', status: 'No', detail: '', description: '', materialId: '' },
      { name: 'Hook, buckle, velcro', status: 'No', detail: '', description: '', materialId: '' },
      { name: 'Interlining / fusing', status: 'Yes', detail: '1', description: 'Placket fusing', materialId: '' }
    ]),
    totalCost: 0, imageUrl: ''
  },
  {
    id: '11001', name: 'Organic Cotton Polo Shirt', lotNo2: 'MH-4459', brand: 'Nike',
    category: 'T-SHIRT COLLAR', designer: 'Admin', fabricType: 'Pima Cotton Pique',
    targetSizes: 'M, L, XL', colorCode: '#059669', status: 'Approved',
    date: '08/08/2023', comments: '', section: 'Men', season: 'Summer', style: 'TS-2201',
    tapeLace: 'No', bottomType: 'N/A', zip: 'No', sticker: 'No', collar: 'Yes', bone: 'No', fullBaju: 'No',
    bom: JSON.stringify([
      { name: 'Zip', status: 'No', detail: '', description: '', materialId: '' },
      { name: 'Button', status: 'Yes', detail: '3', description: 'Polo neck buttons', materialId: '' },
      { name: 'Elastic', status: 'No', detail: '', description: '', materialId: '' },
      { name: 'Tape / Lace', status: 'No', detail: '', description: '', materialId: '' },
      { name: 'Rib', status: 'Yes', detail: '2', description: 'Collar & cuff rib', materialId: '' },
      { name: 'Collar', status: 'Yes', detail: '1', description: 'Flat knit collar', materialId: '' },
      { name: 'Sticker / Label', status: 'Yes', detail: '1', description: 'Printed Satin Brand Labels', materialId: 'M1307' },
      { name: 'Thread', status: 'Yes', detail: '1', description: 'Polyester Thread Spool', materialId: 'M1305' },
      { name: 'Pocket', status: 'No', detail: '', description: '', materialId: '' },
      { name: 'Drawstring / Nara', status: 'No', detail: '', description: '', materialId: '' },
      { name: 'Hook, buckle, velcro', status: 'No', detail: '', description: '', materialId: '' },
      { name: 'Interlining / fusing', status: 'Yes', detail: '1', description: 'Collar stand fusing', materialId: '' }
    ]),
    totalCost: 0, imageUrl: ''
  },
  {
    id: '11002', name: 'Linen Comfort Trousers', lotNo2: 'MH-4460', brand: 'H&M',
    category: 'LOWER', designer: 'Admin', fabricType: 'Pure Linen Weave',
    targetSizes: 'S, M, L', colorCode: '#d97706', status: 'Approved',
    date: '02/08/2023', comments: '', section: 'Women', season: 'Summer', style: 'TR-3304',
    tapeLace: 'No', bottomType: 'Elastic mohri', zip: 'No', sticker: 'No', collar: 'No', bone: 'No', fullBaju: 'No',
    bom: JSON.stringify([
      { name: 'Zip', status: 'Yes', detail: '1', description: 'YKK Fly Zipper', materialId: '' },
      { name: 'Button', status: 'Yes', detail: '1', description: 'Waistband button', materialId: '' },
      { name: 'Elastic', status: 'Yes', detail: '1', description: 'Waistband elastic', materialId: '' },
      { name: 'Tape / Lace', status: 'No', detail: '', description: '', materialId: '' },
      { name: 'Rib', status: 'No', detail: '', description: '', materialId: '' },
      { name: 'Collar', status: 'No', detail: '', description: '', materialId: '' },
      { name: 'Sticker / Label', status: 'Yes', detail: '1', description: 'Brand Label', materialId: '' },
      { name: 'Thread', status: 'Yes', detail: '1', description: 'Polyester Thread Spool', materialId: 'M1305' },
      { name: 'Pocket', status: 'Yes', detail: '2', description: 'Side pockets', materialId: '' },
      { name: 'Drawstring / Nara', status: 'Yes', detail: '1', description: 'Waist drawstring', materialId: '' },
      { name: 'Hook, buckle, velcro', status: 'No', detail: '', description: '', materialId: '' },
      { name: 'Interlining / fusing', status: 'Yes', detail: '1', description: 'Waistband fusing', materialId: '' }
    ]),
    totalCost: 0, imageUrl: ''
  }
];

const initialPOs = [
  {
    id: 'PO1301', poNumber: 'PO-11000', vendorName: 'YKK Trim Solutions',
    vendorEmail: 'sales@ykk-trims.com', vendorAddress: 'Industrial Block C, Mumbai',
    designName: 'Summer Denim Jacket', designCategory: 'JACKET',
    items: JSON.stringify([
      { name: 'YKK Brass Zippers (15cm)', qty: 500, unit: 'pieces', price: 2.50 },
      { name: 'Metal Rivets (Pack of 100)', qty: 627, unit: 'pieces', price: 5.00 }
    ]),
    subtotal: 4385, taxRate: 18, tax: 789.3, total: 38500,
    date: '23/02/2023', deliveryDate: '15/03/2023', status: 'Sent to Vendor'
  }
];

const initialVendors = [
  { id: 'V101', name: 'YKK Trim Solutions', email: 'sales@ykk-trims.com', address: 'Industrial Block C, Mumbai', materialsJoined: 'Metal Buttons & Rivets' },
  { id: 'V102', name: 'EuroCotton Mills', email: 'orders@eurocotton.co', address: 'Textile Center Hub, Gujarat', materialsJoined: 'Fabrics & Yarn' },
  { id: 'V103', name: 'Global Tags & Trims', email: 'info@globaltags.com', address: 'Apparel Center Complex, Mumbai', materialsJoined: 'Labels, Tags & Hangers' }
];

const initialAccessories = [
  'Zip', 'Button', 'Elastic', 'Tape / Lace', 'Rib', 'Collar',
  'Sticker / Label', 'Thread', 'Pocket', 'Drawstring / Nara',
  'Hook, buckle, velcro', 'Interlining / fusing', 'Bone', 'Full Baju'
];

const initialDesigners = ['Admin'];

// ── initDb: create tables + seed ──────────────────────────────────────────────

export async function initDb() {
  // Test connection on startup
  try {
    await pool.execute('SELECT 1');
    console.log('[DB] MySQL connected successfully.');
  } catch (err) {
    console.error('[DB] MySQL connection FAILED:', err.message);
    process.exit(1);
  }

  // Users
  await pool.execute(`CREATE TABLE IF NOT EXISTS users (
    id           INT PRIMARY KEY AUTO_INCREMENT,
    name         VARCHAR(255) NOT NULL,
    email        VARCHAR(255) UNIQUE NOT NULL,
    password     TEXT NOT NULL,
    role         VARCHAR(50) NOT NULL,
    verified     TINYINT DEFAULT 0,
    otp_code     VARCHAR(50),
    otp_expires  DATETIME,
    created_at   DATETIME
  )`);

  // Designs
  await pool.execute(`CREATE TABLE IF NOT EXISTS designs (
    id           VARCHAR(100) PRIMARY KEY,
    name         VARCHAR(255),
    lotNo2       VARCHAR(255),
    brand        VARCHAR(255),
    category     VARCHAR(255),
    designer     VARCHAR(255),
    fabricType   VARCHAR(255),
    targetSizes  VARCHAR(255),
    colorCode    VARCHAR(50),
    status       VARCHAR(100),
    date         VARCHAR(100),
    comments     TEXT,
    section      VARCHAR(100),
    season       VARCHAR(100),
    style        VARCHAR(100),
    tapeLace     VARCHAR(50),
    bottomType   VARCHAR(255),
    zip          VARCHAR(50),
    sticker      VARCHAR(50),
    collar       VARCHAR(50),
    bone         VARCHAR(50),
    fullBaju     VARCHAR(50),
    bom          TEXT,
    totalCost    DOUBLE DEFAULT 0,
    imageUrl     TEXT,
    quantity     INT DEFAULT 100
  )`);
  try { await pool.execute(`ALTER TABLE designs ADD COLUMN quantity INT DEFAULT 100`); } catch (_) { }
  try { await pool.execute(`ALTER TABLE designs ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`); } catch (_) { }
  try { await pool.execute(`ALTER TABLE designs ADD COLUMN repeat_against VARCHAR(100) NULL`); } catch (_) { }

  await pool.execute(`CREATE TABLE IF NOT EXISTS materials (
    id         VARCHAR(100) PRIMARY KEY,
    name       VARCHAR(255) NOT NULL,
    category   VARCHAR(100),
    stock      DOUBLE DEFAULT 0,
    unit       VARCHAR(50),
    cost       DOUBLE DEFAULT 0,
    threshold  DOUBLE DEFAULT 0,
    color      VARCHAR(100),
    location   VARCHAR(255) DEFAULT 'Main Store',
    packets    INT DEFAULT 1,
    poNumber   VARCHAR(100) DEFAULT 'N/A',
    invoiceNo  VARCHAR(100) DEFAULT 'N/A'
  )`);
  try { await pool.execute(`ALTER TABLE materials ADD COLUMN packets INT DEFAULT 1`); } catch (_) { }
  try { await pool.execute(`ALTER TABLE materials ADD COLUMN poNumber VARCHAR(100) DEFAULT "N/A"`); } catch (_) { }
  try { await pool.execute(`ALTER TABLE materials ADD COLUMN invoiceNo VARCHAR(100) DEFAULT "N/A"`); } catch (_) { }
  try { await pool.execute(`ALTER TABLE materials ADD COLUMN imageUrl LONGTEXT NULL`); } catch (_) { }
  try {
    await pool.execute(`ALTER TABLE materials ADD COLUMN location VARCHAR(255) DEFAULT 'Main Store'`);
    // Copy existing location values (which were stored in 'color' column) into 'location' column if 'location' is at default
    await pool.execute(`UPDATE materials SET location = color WHERE location = 'Main Store' OR location IS NULL`);
  } catch (_) { }

  // Approval Requests
  await pool.execute(`CREATE TABLE IF NOT EXISTS approval_requests (
    id              VARCHAR(100) PRIMARY KEY,
    type            VARCHAR(100) NOT NULL,
    status          VARCHAR(50)  DEFAULT 'pending',
    requesterName   VARCHAR(255),
    requesterRole   VARCHAR(100),
    date            VARCHAR(100),
    lotId           VARCHAR(100),
    pieces          INT DEFAULT 0,
    personName      VARCHAR(255),
    isReissue       TINYINT DEFAULT 0,
    items           TEXT,
    materialId      VARCHAR(100),
    materialName    VARCHAR(255),
    reason          TEXT,
    rejectionReason TEXT,
    resolvedDate    VARCHAR(100)
  )`);

  // Purchase Orders
  await pool.execute(`CREATE TABLE IF NOT EXISTS purchase_orders (
    id              VARCHAR(100) PRIMARY KEY,
    poNumber        VARCHAR(100),
    vendorName      VARCHAR(255),
    designName      VARCHAR(255),
    designCategory  VARCHAR(100),
    items           TEXT,
    subtotal        DOUBLE DEFAULT 0,
    taxRate         DOUBLE DEFAULT 18,
    tax             DOUBLE DEFAULT 0,
    total           DOUBLE DEFAULT 0,
    date            VARCHAR(100),
    deliveryDate    VARCHAR(100),
    status          VARCHAR(100)
  )`);
  try {
    await pool.execute(`CREATE UNIQUE INDEX idx_po_number ON purchase_orders (poNumber)`);
  } catch (_) {}

  // Vendors
  await pool.execute(`CREATE TABLE IF NOT EXISTS vendors (
    id              VARCHAR(100) PRIMARY KEY,
    name            VARCHAR(255) NOT NULL,
    email           VARCHAR(255),
    address         TEXT,
    materialsJoined TEXT
  )`);

  // Settings (key-value store)
  await pool.execute(`CREATE TABLE IF NOT EXISTS settings (
    setting_key     VARCHAR(100) PRIMARY KEY,
    setting_value   TEXT
  )`);

  // Issue Logs
  await pool.execute(`CREATE TABLE IF NOT EXISTS issue_logs (
    id          VARCHAR(100) PRIMARY KEY,
    lotId       VARCHAR(100),
    isReissue   TINYINT DEFAULT 0,
    isReturn    TINYINT DEFAULT 0,
    category    VARCHAR(100),
    volume      INT DEFAULT 0,
    personName  VARCHAR(255),
    date        VARCHAR(100),
    materials   TEXT
  )`);

  // Design History Logs
  await pool.execute(`CREATE TABLE IF NOT EXISTS design_history (
    id          INT PRIMARY KEY AUTO_INCREMENT,
    lotId       VARCHAR(100) NOT NULL,
    action      VARCHAR(50) NOT NULL,
    actorName   VARCHAR(255) NOT NULL,
    timestamp   VARCHAR(100) NOT NULL,
    details     TEXT
  )`);

  // Scans Log
  await pool.execute(`CREATE TABLE IF NOT EXISTS scans (
    id             INT PRIMARY KEY AUTO_INCREMENT,
    lot_number     VARCHAR(100),
    scan_type      VARCHAR(100),
    person_name    VARCHAR(255) NOT NULL,
    material_name  VARCHAR(255) NOT NULL,
    quantity       DOUBLE DEFAULT 0,
    supplier_name  VARCHAR(255) NOT NULL,
    scanned_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
    rgp_payload    TEXT NULL
  )`);

  // ZIP PO Orders Table
  await pool.execute(`CREATE TABLE IF NOT EXISTS zip (
    id                   INT PRIMARY KEY AUTO_INCREMENT,
    Lot_Number           VARCHAR(100) NOT NULL UNIQUE,
    Garment_Type         VARCHAR(255) DEFAULT '',
    Style                VARCHAR(255) DEFAULT '',
    Fabric               VARCHAR(255) DEFAULT '',
    Total_Pieces         INT DEFAULT 0,
    Issue_Date           VARCHAR(100) DEFAULT '',
    Supervisor           VARCHAR(255) DEFAULT '',
    Priority             VARCHAR(100) DEFAULT 'Normal',
    Selected_Placements  TEXT,
    Placement_Quantities TEXT,
    Placement_Zip_Types  TEXT,
    Zip_Selections       TEXT,
    Zip_Quality_Data     TEXT,
    Total_Cost           DOUBLE DEFAULT 0,
    Saved_At             TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    Gate_Entry_Person    VARCHAR(255) DEFAULT '',
    Gate_Entry_Date      VARCHAR(100) DEFAULT '',
    Material_Received_By VARCHAR(255) DEFAULT '',
    Material_Received_Date VARCHAR(100) DEFAULT '',
    Supplier_Name        VARCHAR(255) DEFAULT '',
    Material_Entry_Date  VARCHAR(100) DEFAULT '',
    zip_payload          LONGTEXT
  )`);
  // Add scanner columns to zip if upgrading from older schema
  try { await pool.execute(`ALTER TABLE zip ADD COLUMN Gate_Entry_Person VARCHAR(255) DEFAULT ''`); } catch (_) { }
  try { await pool.execute(`ALTER TABLE zip ADD COLUMN Gate_Entry_Date VARCHAR(100) DEFAULT ''`); } catch (_) { }
  try { await pool.execute(`ALTER TABLE zip ADD COLUMN Material_Received_By VARCHAR(255) DEFAULT ''`); } catch (_) { }
  try { await pool.execute(`ALTER TABLE zip ADD COLUMN Material_Received_Date VARCHAR(100) DEFAULT ''`); } catch (_) { }
  try { await pool.execute(`ALTER TABLE zip ADD COLUMN Supplier_Name VARCHAR(255) DEFAULT ''`); } catch (_) { }
  try { await pool.execute(`ALTER TABLE zip ADD COLUMN Material_Entry_Date VARCHAR(100) DEFAULT ''`); } catch (_) { }
  // Add PO number column to zip
  try { await pool.execute(`ALTER TABLE zip ADD COLUMN po_number VARCHAR(30) DEFAULT ''`); } catch (_) { }
  // Drop UNIQUE constraint on Lot_Number in zip table so same lot can have multiple orders (new SR NO each time)
  try { await pool.execute(`ALTER TABLE zip DROP INDEX Lot_Number`); } catch (_) { }
  try { await pool.execute(`ALTER TABLE zip DROP INDEX lot_number`); } catch (_) { }
  // Add version column so duplicate lots are tracked as Version 1, Version 2, etc.
  try { await pool.execute(`ALTER TABLE zip ADD COLUMN version INT DEFAULT 1`); } catch (_) { }
  // Add PO number column to doori
  try { await pool.execute(`ALTER TABLE doori ADD COLUMN po_number VARCHAR(30) DEFAULT ''`); } catch (_) { }
  // Drop UNIQUE constraint on Lot_Number in doori — same lot can have multiple versioned orders
  try { await pool.execute(`ALTER TABLE doori DROP INDEX Lot_Number`); } catch (_) { }
  try { await pool.execute(`ALTER TABLE doori DROP INDEX lot_number`); } catch (_) { }
  // Add version column to doori so duplicate lots show as Version 1, Version 2, etc.
  try { await pool.execute(`ALTER TABLE doori ADD COLUMN version INT DEFAULT 1`); } catch (_) { }
  // Seed PO counters if missing
  try { await pool.execute(`INSERT IGNORE INTO settings (setting_key, setting_value) VALUES ('zip_po_counter', '0')`); } catch (_) { }
  try { await pool.execute(`INSERT IGNORE INTO settings (setting_key, setting_value) VALUES ('doori_po_counter', '0')`); } catch (_) { }



  // DOORI PO Orders Table (ensure all columns exist)
  await pool.execute(`CREATE TABLE IF NOT EXISTS doori (
    id                   INT PRIMARY KEY AUTO_INCREMENT,
    Lot_Number           VARCHAR(100) NOT NULL UNIQUE,
    Garment_Type         VARCHAR(255) DEFAULT '',
    Style                VARCHAR(255) DEFAULT '',
    Fabric               VARCHAR(255) DEFAULT '',
    Total_Pieces         INT DEFAULT 0,
    Issue_Date           VARCHAR(100) DEFAULT '',
    Timestamp            VARCHAR(100) DEFAULT '',
    Supervisor           VARCHAR(255) DEFAULT '',
    Dori_Selections      TEXT,
    Selected_Placements  TEXT,
    Placement_Quantities TEXT,
    Placement_Dori_Types TEXT,
    Total_Cost           DOUBLE DEFAULT 0,
    Gate_Entry_Person    VARCHAR(255) DEFAULT '',
    Gate_Entry_Date      VARCHAR(100) DEFAULT '',
    Material_Received_By VARCHAR(255) DEFAULT '',
    Material_Received_Date VARCHAR(100) DEFAULT '',
    Supplier_Name        VARCHAR(255) DEFAULT '',
    Material_Entry_Date  VARCHAR(100) DEFAULT '',
    dori_payload         LONGTEXT
  )`);

  // Cutting Header Table
  await pool.execute(`CREATE TABLE IF NOT EXISTS cutting_header (
    id INT AUTO_INCREMENT PRIMARY KEY,
    Lot_Number VARCHAR(255),
    StartRow INT,
    NumRows INT,
    HeaderCols INT,
    Fabric VARCHAR(255),
    Garment_Type VARCHAR(255),
    Style VARCHAR(255),
    Sizes VARCHAR(255),
    Shades TEXT,
    Saved_At VARCHAR(255),
    Date_of_Issue VARCHAR(255),
    Supervisor VARCHAR(255),
    Image_Url TEXT,
    Party_Name VARCHAR(255),
    Brand VARCHAR(255),
    Season VARCHAR(255),
    Direct_Stitching VARCHAR(255),
    Challan_History TEXT,
    Zip_Order_Date VARCHAR(255),
    Zip_Received_Date VARCHAR(255),
    WIP_Status TEXT,
    Completed_Status TEXT,
    MWK VARCHAR(255),
    JobOrder_Date VARCHAR(255),
    Manpower INT,
    Cutting_Qty INT,
    Stitching_Issue_Qty INT,
    Priority VARCHAR(255),
    Sticker VARCHAR(255),
    zip_payload LONGTEXT
  )`);

  // Cuttings Matrix Table
  await pool.execute(`CREATE TABLE IF NOT EXISTS cuttings_matrix (
    id INT AUTO_INCREMENT PRIMARY KEY,
    header_id INT,
    Lot_No VARCHAR(100),
    Color VARCHAR(100),
    Cutting_Table INT,
    M INT,
    L INT,
    XL INT,
    XXL INT,
    Total_Pcs INT
  )`);

  // Returnable Gate Pass (RGP) Table
  await pool.execute(`CREATE TABLE IF NOT EXISTS rgp (
    id                   INT PRIMARY KEY AUTO_INCREMENT,
    rgpNo                VARCHAR(100) NOT NULL UNIQUE,
    date                 VARCHAR(100) NOT NULL,
    vendor               VARCHAR(255) NOT NULL,
    rgpType              VARCHAR(100) NOT NULL,
    department           VARCHAR(100) DEFAULT '',
    purpose              VARCHAR(255) DEFAULT '',
    expectedReturnDate   VARCHAR(100) DEFAULT '',
    vehicleNo            VARCHAR(100) DEFAULT '',
    preparedBy           VARCHAR(255) DEFAULT '',
    authorizedBy         VARCHAR(255) DEFAULT '',
    remarks              TEXT,
    createdAt            TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);

  // Weight Capture Table
  await pool.execute(`CREATE TABLE IF NOT EXISTS weight_capture (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    materialCode    VARCHAR(100),
    materialName    VARCHAR(255),
    unit            VARCHAR(50) DEFAULT 'Pcs',
    category        VARCHAR(100),
    supplier        VARCHAR(255),
    lotNo           VARCHAR(100),
    poNumber        VARCHAR(100),
    invoiceNo       VARCHAR(100),
    storeLocation   VARCHAR(255),
    storeIncharge   VARCHAR(100),
    grossWeightKg   DOUBLE DEFAULT 0,
    tareWeightKg    DOUBLE DEFAULT 0,
    netWeightKg     DOUBLE DEFAULT 0,
    weightPerPieceG DOUBLE DEFAULT 0,
    sampleQty       INT DEFAULT 10,
    sampleWeightKg  DOUBLE DEFAULT 0,
    pieces          INT DEFAULT 0,
    packets         INT DEFAULT 1,
    barcodeId       VARCHAR(100),
    status          VARCHAR(50) DEFAULT 'Captured',
    approvalStatus  VARCHAR(50) DEFAULT 'Approved',
    approvedBy      VARCHAR(100) NULL,
    approvedAt      DATETIME NULL,
    rejectionReason TEXT NULL,
    entryMode       VARCHAR(50) DEFAULT 'Weight Machine',
    remarks         TEXT,
    capturedAt      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);
  try { await pool.execute(`ALTER TABLE weight_capture ADD COLUMN approvalStatus VARCHAR(50) DEFAULT 'Approved'`); } catch (_) { }
  try { await pool.execute(`ALTER TABLE weight_capture ADD COLUMN approvedBy VARCHAR(100) NULL`); } catch (_) { }
  try { await pool.execute(`ALTER TABLE weight_capture ADD COLUMN approvedAt DATETIME NULL`); } catch (_) { }
  try { await pool.execute(`ALTER TABLE weight_capture ADD COLUMN rejectionReason TEXT NULL`); } catch (_) { }
  try { await pool.execute(`ALTER TABLE weight_capture ADD COLUMN entryMode VARCHAR(50) DEFAULT 'Weight Machine'`); } catch (_) { }
  try { await pool.execute(`ALTER TABLE weight_capture ADD COLUMN imageUrl LONGTEXT NULL`); } catch (_) { }

  // Dedicated Accepted Orders Table
  await pool.execute(`CREATE TABLE IF NOT EXISTS order_accepted (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    poNumber        VARCHAR(100) NOT NULL,
    poId            VARCHAR(50),
    vendorName      VARCHAR(255),
    materialName    VARCHAR(255),
    orderedQty      DECIMAL(10,2) DEFAULT 0,
    acceptedQty     DECIMAL(10,2) DEFAULT 0,
    extraQty        DECIMAL(10,2) DEFAULT 0,
    invoiceNo       VARCHAR(100),
    invoiceDate     VARCHAR(100),
    storeLocation   VARCHAR(255),
    approvedBy      VARCHAR(100) DEFAULT 'Admin',
    status          VARCHAR(50) DEFAULT 'Accepted',
    remarks         TEXT,
    acceptedAt      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);

  // ── Seed data (only if tables are empty) ────────────────────────────────────

  const [[{ count: dCount }]] = await pool.execute('SELECT COUNT(*) as count FROM designs');
  if (dCount === 0) {
    for (const d of initialDesigns) {
      await pool.execute(
        `REPLACE INTO designs
          (id,name,lotNo2,brand,category,designer,fabricType,targetSizes,colorCode,status,date,
           comments,section,season,style,tapeLace,bottomType,zip,sticker,collar,bone,fullBaju,
           bom,totalCost,imageUrl,quantity)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [d.id, d.name, d.lotNo2, d.brand, d.category, d.designer, d.fabricType, d.targetSizes,
        d.colorCode, d.status, d.date, d.comments || '', d.section, d.season, d.style, d.tapeLace,
        d.bottomType, d.zip, d.sticker, d.collar, d.bone, d.fullBaju, d.bom, d.totalCost || 0, d.imageUrl || '', 100]
      );
    }
  }

  const [[{ count: mCount }]] = await pool.execute('SELECT COUNT(*) as count FROM materials');
  if (mCount === 0) {
    for (const m of initialMaterials) {
      await pool.execute(
        'INSERT INTO materials (id,name,category,stock,unit,cost,threshold,color,location) VALUES (?,?,?,?,?,?,?,?,?)',
        [m.id, m.name, m.category, m.stock, m.unit, m.cost, m.threshold, m.color, m.location || 'Main Store']
      );
    }
  }

  const [[{ count: poCount }]] = await pool.execute('SELECT COUNT(*) as count FROM purchase_orders');
  if (poCount === 0) {
    for (const po of initialPOs) {
      await pool.execute(
        `REPLACE INTO purchase_orders
          (id,poNumber,vendorName,designName,designCategory,
           items,subtotal,taxRate,tax,total,date,deliveryDate,status)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [po.id, po.poNumber, po.vendorName,
        po.designName, po.designCategory, po.items, po.subtotal, po.taxRate,
        po.tax, po.total, po.date, po.deliveryDate, po.status]
      );
    }
  }

  const [[{ count: vCount }]] = await pool.execute('SELECT COUNT(*) as count FROM vendors');
  if (vCount === 0) {
    for (const v of initialVendors) {
      await pool.execute(
        'INSERT INTO vendors (id,name,email,address,materialsJoined) VALUES (?,?,?,?,?)',
        [v.id, v.name, v.email, v.address, v.materialsJoined]
      );
    }
  }

  const [[{ count: sCount }]] = await pool.execute('SELECT COUNT(*) as count FROM settings');
  if (sCount === 0) {
    await pool.execute('REPLACE INTO settings (setting_key,setting_value) VALUES (?,?)',
      ['accessories_list', JSON.stringify(initialAccessories)]);
    await pool.execute('REPLACE INTO settings (setting_key,setting_value) VALUES (?,?)',
      ['designers_list', JSON.stringify(initialDesigners)]);
  } else {
    // Sanitize any legacy dummy designer names
    try {
      const [dRows] = await pool.execute("SELECT setting_value FROM settings WHERE setting_key = 'designers_list'");
      if (dRows.length > 0) {
        const parsed = JSON.parse(dRows[0].setting_value);
        if (Array.isArray(parsed)) {
          const cleaned = parsed.filter(d => !['sarah connor', 'michael scott'].includes(String(d).toLowerCase().trim()));
          const finalDesigners = cleaned.length > 0 ? (cleaned.includes('Admin') ? cleaned : ['Admin', ...cleaned]) : ['Admin'];
          await pool.execute("REPLACE INTO settings (setting_key, setting_value) VALUES ('designers_list', ?)", [JSON.stringify(finalDesigners)]);
        }
      }
    } catch (_) {}
  }

  const [[{ count: hCount }]] = await pool.execute('SELECT COUNT(*) as count FROM design_history');
  if (hCount === 0) {
    await pool.execute("INSERT INTO design_history (lotId, action, actorName, timestamp, details) VALUES ('11000', 'created', 'Sarah Connor', '10/08/2023 10:24', 'Lot created with category JACKET, style ST-9921')");
    await pool.execute("INSERT INTO design_history (lotId, action, actorName, timestamp, details) VALUES ('11001', 'created', 'Michael Scott', '08/08/2023 11:15', 'Lot created with category T-SHIRT COLLAR, style TS-2201')");
    await pool.execute("INSERT INTO design_history (lotId, action, actorName, timestamp, details) VALUES ('11001', 'approved', 'Admin', '08/08/2023 16:40', 'BOM verified and approved.')");
    await pool.execute("INSERT INTO design_history (lotId, action, actorName, timestamp, details) VALUES ('11002', 'created', 'Sarah Connor', '02/08/2023 09:30', 'Lot created with category LOWER, style TR-3304')");
    await pool.execute("INSERT INTO design_history (lotId, action, actorName, timestamp, details) VALUES ('11002', 'approved', 'Admin', '02/08/2023 14:12', 'BOM verified and approved.')");
  }

  // Weight Capture (Weighbridge Audit Log)
  await pool.execute(`CREATE TABLE IF NOT EXISTS weight_capture (
    id               INT PRIMARY KEY AUTO_INCREMENT,
    materialCode     VARCHAR(50)   NOT NULL,
    materialName     VARCHAR(255)  NOT NULL,
    unit             VARCHAR(30)   DEFAULT 'Pcs',
    category         VARCHAR(100)  DEFAULT '',
    supplier         VARCHAR(255)  DEFAULT '',
    lotNo            VARCHAR(100)  DEFAULT '',
    poNumber         VARCHAR(100)  DEFAULT '',
    invoiceNo        VARCHAR(100)  DEFAULT '',
    storeLocation    VARCHAR(255)  DEFAULT '',
    storeIncharge    VARCHAR(255)  DEFAULT '',
    grossWeightKg    DOUBLE        DEFAULT 0,
    tareWeightKg     DOUBLE        DEFAULT 0,
    netWeightKg      DOUBLE        DEFAULT 0,
    weightPerPieceG  DOUBLE        DEFAULT 0,
    sampleQty        INT           DEFAULT 0,
    sampleWeightKg   DOUBLE        DEFAULT 0,
    pieces           INT           DEFAULT 0,
    packets          INT           DEFAULT 1,
    barcodeId        VARCHAR(100)  DEFAULT '',
    status           VARCHAR(50)   DEFAULT 'Captured',
    remarks          TEXT,
    capturedAt       DATETIME      DEFAULT CURRENT_TIMESTAMP
  )`);
  // Add sampleQty/sampleWeightKg columns if upgrading from older schema
  try { await pool.execute(`ALTER TABLE weight_capture ADD COLUMN sampleQty INT DEFAULT 0`); } catch (_) { }
  try { await pool.execute(`ALTER TABLE weight_capture ADD COLUMN sampleWeightKg DOUBLE DEFAULT 0`); } catch (_) { }

  // Material Transfers Table
  await pool.execute(`CREATE TABLE IF NOT EXISTS material_transfers (
    id               INT PRIMARY KEY AUTO_INCREMENT,
    materialCode     VARCHAR(50)   NOT NULL,
    materialName     VARCHAR(255)  NOT NULL,
    fromLocation     VARCHAR(255)  NOT NULL,
    toLocation       VARCHAR(255)  NOT NULL,
    quantity         INT           DEFAULT 0,
    transferType     VARCHAR(50)   DEFAULT 'packet',
    operator         VARCHAR(255)  DEFAULT 'Admin',
    transferredAt    DATETIME      DEFAULT CURRENT_TIMESTAMP
  )`);

  // Warehouse Locations Table
  await pool.execute(`CREATE TABLE IF NOT EXISTS warehouse_locations (
    id          VARCHAR(100) PRIMARY KEY,
    code        VARCHAR(255) NOT NULL,
    warehouse   VARCHAR(255) NOT NULL,
    capacity    INT DEFAULT 20
  )`);

  // Auto-sync warehouse_locations from configured warehouse_racks settings if custom racks exist
  try {
    const [hallSetting] = await pool.execute('SELECT setting_value FROM settings WHERE setting_key = ?', ['warehouse_halls']);
    if (!hallSetting || hallSetting.length === 0 || !hallSetting[0].setting_value) {
      const defaultHalls = ['Main Store'];
      await pool.execute("REPLACE INTO settings (setting_key, setting_value) VALUES ('warehouse_halls', ?)", [JSON.stringify(defaultHalls)]);
    }

    const [rackSetting] = await pool.execute('SELECT setting_value FROM settings WHERE setting_key = ?', ['warehouse_racks']);
    let parsedRacks = [];
    if (rackSetting && rackSetting.length > 0 && rackSetting[0].setting_value) {
      try {
        parsedRacks = JSON.parse(rackSetting[0].setting_value);
      } catch (_) {}
    }

    if (Array.isArray(parsedRacks) && parsedRacks.length > 0) {
      await bulkSaveWarehouseLocations(parsedRacks);
      console.log(`[DB] Synced ${parsedRacks.length} custom locations to warehouse_locations table.`);
    }
  } catch (syncErr) {
    console.warn('[DB] Could not initialize/sync warehouse_locations on startup:', syncErr.message);
  }

  // ── High-Speed Performance Indexes for Large Datasets ─────────────────────
  const ensureIndex = async (table, indexName, columns) => {
    try {
      const [existing] = await pool.execute(`SHOW INDEX FROM ${table} WHERE Key_name = ?`, [indexName]);
      if (existing.length === 0) {
        await pool.execute(`CREATE INDEX ${indexName} ON ${table} (${columns})`);
      }
    } catch (_) {}
  };

  try {
    await Promise.all([
      ensureIndex('weight_capture', 'idx_wc_po', 'poNumber'),
      ensureIndex('weight_capture', 'idx_wc_matcode', 'materialCode'),
      ensureIndex('weight_capture', 'idx_wc_inv', 'invoiceNo'),
      ensureIndex('weight_capture', 'idx_wc_barcode', 'barcodeId'),
      ensureIndex('weight_capture', 'idx_wc_approval', 'approvalStatus'),
      ensureIndex('weight_capture', 'idx_wc_captured', 'capturedAt'),
      ensureIndex('weight_capture', 'idx_wc_po_inv', 'poNumber, invoiceNo'),
      ensureIndex('purchase_orders', 'idx_po_number', 'poNumber'),
      ensureIndex('purchase_orders', 'idx_po_vendor', 'vendorName'),
      ensureIndex('purchase_orders', 'idx_po_status', 'status'),
      ensureIndex('order_accepted', 'idx_oa_po', 'poNumber'),
      ensureIndex('order_accepted', 'idx_oa_inv', 'invoiceNo'),
      ensureIndex('order_accepted', 'idx_oa_mat', 'materialName'),
      ensureIndex('order_accepted', 'idx_oa_date', 'acceptedAt'),
      ensureIndex('materials', 'idx_mat_name', 'name'),
      ensureIndex('materials', 'idx_mat_category', 'category'),
      ensureIndex('materials', 'idx_mat_loc', 'location'),
      ensureIndex('materials', 'idx_mat_cat_name', 'category, name'),
      ensureIndex('cutting_header', 'idx_ch_lot', 'Lot_Number'),
      ensureIndex('cutting_header', 'idx_ch_style', 'Style'),
      ensureIndex('cutting_header', 'idx_ch_party', 'Party_Name'),
      ensureIndex('cuttings_matrix', 'idx_cm_lot', 'Lot_No'),
      ensureIndex('cuttings_matrix', 'idx_cm_header', 'header_id'),
      ensureIndex('cuttings_matrix', 'idx_cm_lot_style', 'Lot_No, style'),
      ensureIndex('material_transfers', 'idx_mt_code', 'materialCode'),
      ensureIndex('material_transfers', 'idx_mt_date', 'transferredAt'),
      ensureIndex('zip', 'idx_zip_lot', 'Lot_Number'),
      ensureIndex('zip', 'idx_zip_po', 'po_number'),
      ensureIndex('issue_logs', 'idx_issue_lot', 'lotId'),
      ensureIndex('scans', 'idx_scans_lot_date', 'lot_number, scanned_at')
    ]);
  } catch (_) { }

  console.log('[DB] All tables and high-speed indexes ready.');
}

// ── Users ─────────────────────────────────────────────────────────────────────

// Helper to format Date/ISO string to MySQL DATETIME format in local timezone (YYYY-MM-DD HH:mm:ss)
const toMysqlDatetime = (dateInput) => {
  if (!dateInput) return null;
  const d = (dateInput instanceof Date) ? dateInput : new Date(dateInput);
  if (isNaN(d.getTime())) return null;

  const pad = (n) => String(n).padStart(2, '0');
  const year = d.getFullYear();
  const month = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hours = pad(d.getHours());
  const minutes = pad(d.getMinutes());
  const seconds = pad(d.getSeconds());

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
};

export const addOrUpdateMaterialFromCapture = async (data) => {
  const name = (data.materialName || '').trim();
  const code = (data.materialCode || '').trim();
  const pieces = Number(data.pieces) || 0;
  const packets = Number(data.packets) || 1;
  const unit = data.unit || 'Pcs';
  const category = data.category || 'Accessory';
  const location = data.storeLocation || 'Main Store';
  const poNumber = data.poNumber || 'N/A';
  const invoiceNo = data.invoiceNo || 'N/A';
  const imageUrl = data.imageUrl || '';

  if (!name && !code) return;

  // Search by exact id (materialCode) first if present
  let rows = [];
  if (code) {
    const [idRows] = await pool.execute('SELECT * FROM materials WHERE id = ?', [code]);
    rows = idRows;
  }
  // Fall back to matching name only if no materialCode was provided
  if (rows.length === 0 && name && !code) {
    const [nameRows] = await pool.execute('SELECT * FROM materials WHERE name = ?', [name]);
    rows = nameRows;
  }

  if (rows.length > 0) {
    // Existing material found -> add pieces to stock and update packets
    const existing = rows[0];
    const updatedStock = (Number(existing.stock) || 0) + pieces;
    await pool.execute(
      'UPDATE materials SET stock = ?, packets = ?, unit = COALESCE(NULLIF(?, ""), unit), name = COALESCE(NULLIF(?, ""), name), location = COALESCE(NULLIF(?, ""), location), category = COALESCE(NULLIF(?, ""), category), poNumber = COALESCE(NULLIF(?, ""), poNumber), invoiceNo = COALESCE(NULLIF(?, ""), invoiceNo), imageUrl = COALESCE(NULLIF(?, ""), imageUrl) WHERE id = ?',
      [updatedStock, packets, data.unit || existing.unit, name || existing.name, location || existing.location, category || existing.category, poNumber || existing.poNumber, invoiceNo || existing.invoiceNo, imageUrl || existing.imageUrl || '', existing.id]
    );
    console.log(`[DB] Updated stock for material ${existing.id} (${existing.name}): +${pieces} (New total: ${updatedStock}, Packets: ${packets}, PO: ${poNumber}, Invoice: ${invoiceNo})`);
  } else {
    // New material -> insert into materials table
    const matId = code || `M${Math.floor(1000 + Math.random() * 9000)}`;
    await pool.execute(
      'INSERT INTO materials (id, name, category, stock, unit, cost, threshold, color, location, packets, poNumber, invoiceNo, imageUrl) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [matId, name || 'Accessory Material', category, pieces, unit, 0, 50, 'Default', location, packets, poNumber, invoiceNo, imageUrl]
    );
    console.log(`[DB] Created new material in Stock DB: ${matId} - ${name} (${pieces} ${unit}, ${packets} packets, PO: ${poNumber}, Invoice: ${invoiceNo})`);
  }
};

export const syncWeightCapturesToMaterials = async () => {
  try {
    const [captures] = await pool.execute("SELECT * FROM weight_capture ORDER BY id ASC");
    for (const c of captures) {
      const code = (c.materialCode || '').trim();
      const name = (c.materialName || 'Accessory Material').trim();
      const category = (c.category || 'Accessory').trim();
      const pieces = Number(c.pieces) || 0;
      const unit = c.unit || 'Pcs';
      const location = c.storeLocation || 'Main Store';
      const packets = Number(c.packets) || 1;
      const poNumber = c.poNumber || 'N/A';
      const invoiceNo = c.invoiceNo || 'N/A';

      if (!code && !name) continue;
      const matId = code || `M${Math.floor(1000 + Math.random() * 9000)}`;

      const [existing] = await pool.execute('SELECT * FROM materials WHERE id = ?', [matId]);
      if (existing.length > 0) {
        const ext = existing[0];
        const newName = ext.name === 'Accessory Material' || !ext.name ? name : ext.name;
        const newCategory = ext.category === 'Accessory' || !ext.category ? category : ext.category;
        const newUnit = !ext.unit ? unit : ext.unit;
        const newPo = (!ext.poNumber || ext.poNumber === 'N/A') ? poNumber : ext.poNumber;
        const newInv = (!ext.invoiceNo || ext.invoiceNo === 'N/A') ? invoiceNo : ext.invoiceNo;
        const newLoc = (!ext.location || ext.location === 'Main Store') ? location : ext.location;

        await pool.execute(
          'UPDATE materials SET name = ?, category = ?, unit = ?, poNumber = ?, invoiceNo = ?, location = ? WHERE id = ?',
          [newName, newCategory, newUnit, newPo, newInv, newLoc, matId]
        );
      } else {
        const isApproved = c.approvalStatus === 'Approved' || !c.approvalStatus;
        await pool.execute(
          'INSERT INTO materials (id, name, category, stock, unit, cost, threshold, color, location, packets, poNumber, invoiceNo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [matId, name, category, isApproved ? pieces : 0, unit, 0, 50, 'Default', location, packets, poNumber, invoiceNo]
        );
        console.log(`[DB] Synced weight capture material into DB: ${matId} - ${name} (PO: ${poNumber}, Invoice: ${invoiceNo})`);
      }
    }
  } catch (err) {
    console.error('[DB] Error syncing weight captures to materials:', err.message);
  }
};

export const getUserByEmail = async (email) => {
  if (!email) return null;
  const [rows] = await pool.execute('SELECT * FROM users WHERE LOWER(TRIM(email)) = LOWER(TRIM(?))', [email]);
  return rows[0] || null;
};

// ── Material Capture & Stock Sync ─────────────────────────────────────────────

export const createMaterialCapture = async (data) => {
  const {
    materialCode, materialName, unit = 'Pcs', category = '', supplier = '',
    lotNo = '', poNumber = '', invoiceNo = '', storeLocation = '', storeIncharge = '',
    grossWeightKg = 0, tareWeightKg = 0, netWeightKg = 0, weightPerPieceG = 0,
    sampleQty = 0, sampleWeightKg = 0,
    pieces = 0, packets = 1, barcodeId = '',
    entryMode = (data.status === 'Manually' || data.status === 'Manual' || data.entryMode === 'Manually' || data.entryMode === 'Manual' || data.isManual || data.captureMethod === 'Manual' ? 'Manually' : 'Weight Machine'),
    status = data.status || entryMode,
    approvalStatus = 'Approved',
    remarks = '',
    imageUrl = ''
  } = data;

  const [result] = await pool.execute(
    `INSERT INTO weight_capture
     (materialCode,materialName,unit,category,supplier,lotNo,poNumber,invoiceNo,
      storeLocation,storeIncharge,grossWeightKg,tareWeightKg,netWeightKg,
      weightPerPieceG,sampleQty,sampleWeightKg,pieces,packets,barcodeId,status,approvalStatus,entryMode,remarks,imageUrl)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [materialCode, materialName, unit, category, supplier, lotNo, poNumber, invoiceNo,
      storeLocation, storeIncharge,
      Number(grossWeightKg), Number(tareWeightKg), Number(netWeightKg),
      Number(weightPerPieceG), Number(sampleQty), Number(sampleWeightKg),
      Number(pieces), Number(packets),
      barcodeId, status, approvalStatus, entryMode, remarks, imageUrl || '']
  );

  const captureId = result.insertId;

  // ONLY sync to stock and warehouse locations if approved!
  if (approvalStatus === 'Approved') {
    try {
      await addOrUpdateMaterialFromCapture(data);
    } catch (syncErr) {
      console.error('[DB] Material stock sync error:', syncErr.message);
    }

    try {
      await saveWarehouseLocationsFromCapture(storeLocation, packets);
    } catch (locErr) {
      console.error('[DB] Warehouse location sync error:', locErr.message);
    }

    if (poNumber) {
      try {
        await updatePOCompletionStatus(poNumber);
      } catch (poErr) {
        console.error('[DB] PO completion status sync error:', poErr.message);
      }
    }
  }

  return captureId;
};

export const approveInwardCapture = async (id, approvedBy = 'Admin', note = '') => {
  const [rows] = await pool.execute('SELECT * FROM weight_capture WHERE id = ?', [id]);
  if (rows.length === 0) throw new Error('Capture record not found.');

  const capture = rows[0];

  await pool.execute(
    `UPDATE weight_capture 
     SET approvalStatus = 'Approved', approvedBy = ?, approvedAt = NOW(), remarks = CONCAT(COALESCE(remarks, ''), ' [Approved: ', ?, ']')
     WHERE id = ?`,
    [approvedBy, note || 'Approved by Manager', id]
  );

  // Now finalize and add into inventory/stock and rack location
  try {
    await addOrUpdateMaterialFromCapture({
      ...capture,
      pieces: Number(capture.pieces) || 0,
      packets: Number(capture.packets) || 1
    });
  } catch (syncErr) {
    console.error('[DB] Material stock sync error on approve:', syncErr.message);
  }

  try {
    await saveWarehouseLocationsFromCapture(capture.storeLocation, capture.packets);
  } catch (locErr) {
    console.error('[DB] Warehouse location sync error on approve:', locErr.message);
  }

  if (capture.poNumber) {
    try {
      await updatePOCompletionStatus(capture.poNumber);
    } catch (poErr) {
      console.error('[DB] PO completion status sync error on approve:', poErr.message);
    }
  }

  return true;
};

export const rejectInwardCapture = async (id, rejectedBy = 'Admin', reason = '') => {
  const [rows] = await pool.execute('SELECT * FROM weight_capture WHERE id = ?', [id]);
  const poNumber = rows[0]?.poNumber;
  await pool.execute(
    `UPDATE weight_capture 
     SET approvalStatus = 'Rejected', approvedBy = ?, approvedAt = NOW(), rejectionReason = ?, status = 'Rejected'
     WHERE id = ?`,
    [rejectedBy, reason || 'Rejected due to excess quantity / not matching PO', id]
  );
  if (poNumber) {
    try {
      await updatePOCompletionStatus(poNumber);
    } catch (poErr) {
      console.error('[DB] PO completion status sync error on reject:', poErr.message);
    }
  }
  return true;
};

export const saveWarehouseLocationsFromCapture = async (locationStr, packets = 1) => {
  if (!locationStr || typeof locationStr !== 'string') return;
  const rawSegments = locationStr.split(',');
  for (const seg of rawSegments) {
    const cleanName = seg.replace(/\([^)]*\)/g, '').trim();
    if (!cleanName || cleanName.toLowerCase() === 'main store' || cleanName.toLowerCase() === 'n/a') continue;
    const slug = cleanName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (!slug) continue;

    let warehouseName = 'Warehouse 1';
    if (cleanName.toLowerCase().includes('hall')) {
      const match = cleanName.match(/(hall\s*\d+)/i);
      if (match) warehouseName = match[1].toUpperCase();
    }

    try {
      await pool.execute(
        `INSERT INTO warehouse_locations (id, code, warehouse, capacity)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE code = VALUES(code)`,
        [slug, cleanName, warehouseName, 20]
      );
      console.log(`[DB] Auto-saved location to warehouse_locations table: ${cleanName} (ID: ${slug})`);
    } catch (locErr) {
      console.warn('[DB] Could not sync warehouse_locations:', locErr.message);
    }
  }
};

export const getAllWarehouseLocations = async () => {
  const [rows] = await pool.execute('SELECT * FROM warehouse_locations ORDER BY warehouse ASC, code ASC');
  return rows;
};

export const bulkSaveWarehouseLocations = async (locationsArray) => {
  if (!Array.isArray(locationsArray) || locationsArray.length === 0) return 0;
  
  const chunkSize = 100;
  let totalSaved = 0;

  for (let i = 0; i < locationsArray.length; i += chunkSize) {
    const chunk = locationsArray.slice(i, i + chunkSize);
    const valuePlaceholders = [];
    const params = [];

    for (const r of chunk) {
      const warehouse = r.warehouse || 'Hall 1';
      const codeStr = (r.code !== undefined && r.code !== null) ? String(r.code).trim() : '';
      let rackLabel = r.name ? String(r.name).trim() : '';
      if (!rackLabel) {
        rackLabel = codeStr ? `Rack ${codeStr}` : 'Rack';
      } else if (codeStr && !rackLabel.toLowerCase().includes(codeStr.toLowerCase())) {
        rackLabel = `${rackLabel} ${codeStr}`;
      }
      const fullDisplay = `${warehouse} - ${rackLabel}`;
      const slug = r.id || `${warehouse}-${rackLabel}`.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const capacity = Number(r.capacity) || 10;

      valuePlaceholders.push('(?, ?, ?, ?)');
      params.push(slug, fullDisplay, warehouse, capacity);
    }

    if (valuePlaceholders.length > 0) {
      const sql = `INSERT INTO warehouse_locations (id, code, warehouse, capacity)
                   VALUES ${valuePlaceholders.join(', ')}
                   ON DUPLICATE KEY UPDATE code = VALUES(code), warehouse = VALUES(warehouse), capacity = VALUES(capacity)`;
      await pool.execute(sql, params);
      totalSaved += chunk.length;
    }
  }

  return totalSaved;
};

export const createWarehouseLocation = async ({ id, code, warehouse = 'Hall 1', capacity = 10 }) => {
  const cleanCode = String(code || 'Rack').trim();
  const fullDisplay = cleanCode.toLowerCase().includes(warehouse.toLowerCase()) ? cleanCode : `${warehouse} - ${cleanCode}`;
  const slug = id || fullDisplay.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const cap = Number(capacity) > 0 ? Number(capacity) : 10;
  await pool.execute(
    `INSERT INTO warehouse_locations (id, code, warehouse, capacity)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE code = VALUES(code), warehouse = VALUES(warehouse), capacity = VALUES(capacity)`,
    [slug, fullDisplay, warehouse, cap]
  );
  return { id: slug, code: fullDisplay, warehouse, capacity: cap };
};

export const deleteWarehouseLocation = async (idOrCode) => {
  if (!idOrCode) return false;
  await pool.execute('DELETE FROM warehouse_locations WHERE id = ? OR code = ?', [idOrCode, idOrCode]);
  
  // Also clean up from warehouse_racks in settings
  try {
    const [rackSetting] = await pool.execute('SELECT setting_value FROM settings WHERE setting_key = ?', ['warehouse_racks']);
    if (rackSetting && rackSetting[0] && rackSetting[0].setting_value) {
      let parsed = JSON.parse(rackSetting[0].setting_value);
      if (Array.isArray(parsed)) {
        parsed = parsed.filter(r => r.id !== idOrCode && r.code !== idOrCode && `${r.warehouse} - ${r.name || `Rack ${r.code}`}` !== idOrCode);
        await pool.execute("REPLACE INTO settings (setting_key, setting_value) VALUES ('warehouse_racks', ?)", [JSON.stringify(parsed)]);
      }
    }
  } catch (_) {}
  return true;
};

export const clearAllWarehouseLocations = async () => {
  await pool.execute('DELETE FROM warehouse_locations');
  await pool.execute("REPLACE INTO settings (setting_key, setting_value) VALUES ('warehouse_racks', '[]')");
  return true;
};

export const getAllMaterialCaptures = async () => {
  const [rows] = await pool.execute(
    'SELECT * FROM weight_capture ORDER BY capturedAt DESC'
  );
  return rows;
};


export const getUserById = async (id) => {
  const [rows] = await pool.execute('SELECT * FROM users WHERE id = ?', [id]);
  return rows[0] || null;
};

export const createUser = async (name, email, password, role, otp_code = null, otp_expires = null) => {
  const createdAt = toMysqlDatetime(new Date());
  const formattedOtpExpires = toMysqlDatetime(otp_expires);
  const [result] = await pool.execute(
    'INSERT INTO users (name,email,password,role,otp_code,otp_expires,created_at) VALUES (?,?,?,?,?,?,?)',
    [name, email, password, role, otp_code, formattedOtpExpires, createdAt]
  );
  return result.insertId;
};

export const verifyUserOtp = async (email) => {
  await pool.execute('UPDATE users SET verified=1, otp_code=NULL, otp_expires=NULL WHERE email=?', [email]);
};

export const updateUserOtp = async (email, otpCode, otpExpires) => {
  const formattedOtpExpires = toMysqlDatetime(otpExpires);
  await pool.execute('UPDATE users SET otp_code=?, otp_expires=? WHERE email=?', [otpCode, formattedOtpExpires, email]);
};


// ── Designs ───────────────────────────────────────────────────────────────────

export const getAllDesigns = async () => {
  const [rows] = await pool.execute('SELECT * FROM designs');
  return rows;
};

export const getDesignById = async (id) => {
  const [rows] = await pool.execute('SELECT * FROM designs WHERE id = ?', [id]);
  return rows[0] || null;
};

export const createDesign = async (d) => {
  const repeatAgainst = d.repeat_against || null;
  if (d.created_at) {
    const localDate = new Date(d.created_at);
    const pad = n => String(n).padStart(2, '0');
    const dbDate = `${localDate.getFullYear()}-${pad(localDate.getMonth() + 1)}-${pad(localDate.getDate())} ${pad(localDate.getHours())}:${pad(localDate.getMinutes())}:${pad(localDate.getSeconds())}`;
    await pool.execute(
      `REPLACE INTO designs
        (id,name,lotNo2,brand,category,designer,fabricType,targetSizes,colorCode,status,date,
         comments,section,season,style,tapeLace,bottomType,zip,sticker,collar,bone,fullBaju,
         bom,totalCost,imageUrl,quantity,created_at,repeat_against)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [d.id, d.name, d.lotNo2, d.brand, d.category, d.designer, d.fabricType, d.targetSizes,
      d.colorCode, d.status, d.date, d.comments || '', d.section, d.season, d.style, d.tapeLace,
      d.bottomType, d.zip, d.sticker, d.collar, d.bone, d.fullBaju, d.bom, d.totalCost || 0, d.imageUrl || '', d.quantity || 100, dbDate, repeatAgainst]
    );
  } else {
    await pool.execute(
      `REPLACE INTO designs
        (id,name,lotNo2,brand,category,designer,fabricType,targetSizes,colorCode,status,date,
         comments,section,season,style,tapeLace,bottomType,zip,sticker,collar,bone,fullBaju,
         bom,totalCost,imageUrl,quantity,repeat_against)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [d.id, d.name, d.lotNo2, d.brand, d.category, d.designer, d.fabricType, d.targetSizes,
      d.colorCode, d.status, d.date, d.comments || '', d.section, d.season, d.style, d.tapeLace,
      d.bottomType, d.zip, d.sticker, d.collar, d.bone, d.fullBaju, d.bom, d.totalCost || 0, d.imageUrl || '', d.quantity || 100, repeatAgainst]
    );
  }
};

export const updateDesignStatus = async (id, status, comments) => {
  await pool.execute('UPDATE designs SET status=?, comments=? WHERE id=?', [status, comments, id]);
};

// ── Materials ─────────────────────────────────────────────────────────────────

export const getAllMaterials = async () => {
  await syncWeightCapturesToMaterials();
  const [rows] = await pool.execute('SELECT * FROM materials ORDER BY id ASC');
  return rows;
};

export const upsertMaterial = async (m) => {
  const [existing] = await pool.execute('SELECT * FROM materials WHERE id = ?', [m.id]);
  if (existing.length > 0) {
    const ext = existing[0];
    await pool.execute(
      `UPDATE materials SET
        name = ?,
        category = ?,
        stock = ?,
        unit = ?,
        cost = ?,
        threshold = ?,
        color = ?,
        location = ?,
        packets = ?,
        poNumber = ?,
        invoiceNo = ?
       WHERE id = ?`,
      [
        m.name !== undefined ? m.name : ext.name,
        m.category !== undefined ? m.category : ext.category,
        m.stock !== undefined ? m.stock : ext.stock,
        m.unit !== undefined ? m.unit : ext.unit,
        m.cost !== undefined ? m.cost : ext.cost,
        m.threshold !== undefined ? m.threshold : ext.threshold,
        m.color !== undefined ? m.color : ext.color,
        m.location !== undefined ? m.location : ext.location,
        m.packets !== undefined ? m.packets : ext.packets,
        m.poNumber !== undefined ? m.poNumber : ext.poNumber,
        m.invoiceNo !== undefined ? m.invoiceNo : ext.invoiceNo,
        m.id
      ]
    );

    // Sync updated location and packets count back to weight_capture table so they match
    if (m.location !== undefined) {
      await pool.execute(
        'UPDATE weight_capture SET storeLocation = ?, packets = ? WHERE materialCode = ?',
        [m.location, m.packets !== undefined ? m.packets : ext.packets, m.id]
      );
    }
  } else {
    await pool.execute(
      `INSERT INTO materials (id, name, category, stock, unit, cost, threshold, color, location, packets, poNumber, invoiceNo)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        m.id,
        m.name || 'Accessory Material',
        m.category || 'Accessory',
        m.stock || 0,
        m.unit || 'Pcs',
        m.cost || 0,
        m.threshold || 50,
        m.color || 'Default',
        m.location || 'Main Store',
        m.packets || 1,
        m.poNumber || 'N/A',
        m.invoiceNo || 'N/A'
      ]
    );
  }
};

export const deleteMaterial = async (id) => {
  await pool.execute('DELETE FROM materials WHERE id=?', [id]);
};

// ── Approval Requests ─────────────────────────────────────────────────────────

export const getAllApprovalRequests = async () => {
  const [rows] = await pool.execute('SELECT * FROM approval_requests ORDER BY date DESC');
  return rows.map(r => ({ ...r, items: r.items ? JSON.parse(r.items) : [], isReissue: !!r.isReissue }));
};

export const createApprovalRequest = async (req) => {
  const itemsJson = req.items ? JSON.stringify(req.items) : '[]';
  await pool.execute(
    `INSERT INTO approval_requests
      (id,type,status,requesterName,requesterRole,date,lotId,pieces,personName,isReissue,items,materialId,materialName,reason)
     VALUES (?,?,'pending',?,?,?,?,?,?,?,?,?,?,?)`,
    [req.id, req.type, req.requesterName || '', req.requesterRole || '', req.date || '',
    req.lotId || '', req.pieces || 0, req.personName || '', req.isReissue ? 1 : 0,
      itemsJson, req.materialId || '', req.materialName || '', req.reason || '']
  );
};

export const updateApprovalRequestStatus = async (id, status, extra = {}) => {
  const normStatus = (status || '').toLowerCase();
  await pool.execute(
    'UPDATE approval_requests SET status=?, rejectionReason=?, resolvedDate=? WHERE id=?',
    [normStatus, extra.rejectionReason || '', extra.resolvedDate || '', id]
  );

  // Automatically connect approval_requests to weight_capture, materials inventory, and purchase_orders
  try {
    const [reqRows] = await pool.execute('SELECT * FROM approval_requests WHERE id = ?', [id]);
    if (reqRows.length > 0) {
      const ar = reqRows[0];
      const isTypeInward = ar.type === 'inward_approval' || (ar.type && ar.type.toLowerCase().includes('inward'));

      let parsedItems = [];
      try {
        parsedItems = typeof ar.items === 'string' ? JSON.parse(ar.items) : (ar.items || []);
      } catch (_) {}

      const firstItem = Array.isArray(parsedItems) && parsedItems.length > 0 ? parsedItems[0] : {};
      const targetPo = (firstItem.poNumber || ar.lotId || '').trim();
      const targetMatCode = (firstItem.materialCode || ar.materialId || '').trim();

      if (isTypeInward || targetPo || targetMatCode) {
        // Find matching weight_capture records that are Pending Approval
        let captureQuery = 'SELECT * FROM weight_capture WHERE (approvalStatus = "Pending Approval" OR approvalStatus IS NULL)';
        const params = [];
        if (targetPo && targetMatCode) {
          captureQuery += ' AND (LOWER(poNumber) = LOWER(?) OR LOWER(materialCode) = LOWER(?))';
          params.push(targetPo, targetMatCode);
        } else if (targetPo) {
          captureQuery += ' AND LOWER(poNumber) = LOWER(?)';
          params.push(targetPo);
        } else if (targetMatCode) {
          captureQuery += ' AND LOWER(materialCode) = LOWER(?)';
          params.push(targetMatCode);
        }

        const [matchingCaps] = await pool.execute(captureQuery, params);

        for (const cap of matchingCaps) {
          if (normStatus === 'approved') {
            await approveInwardCapture(cap.id, extra.resolvedBy || ar.requesterName || 'Admin', extra.rejectionReason || 'Approved via Queue');
          } else if (normStatus === 'rejected') {
            await rejectInwardCapture(cap.id, extra.resolvedBy || ar.requesterName || 'Admin', extra.rejectionReason || 'Rejected via Queue');
          }
        }

        // Always recalculate PO status for purchase_orders
        if (targetPo) {
          await updatePOCompletionStatus(targetPo);
        }
      }
    }
  } catch (syncErr) {
    console.error('[DB] Failed to sync approval_request status to weight_capture/purchase_orders:', syncErr.message);
  }
};

// ── Purchase Orders ───────────────────────────────────────────────────────────

export const updatePOCompletionStatus = async (poNumber) => {
  if (!poNumber) return null;
  const cleanPo = String(poNumber).trim();
  if (!cleanPo) return null;

  try {
    const [poRows] = await pool.execute('SELECT * FROM purchase_orders WHERE LOWER(poNumber) = ?', [cleanPo.toLowerCase()]);
    if (poRows.length === 0) return null;
    const po = poRows[0];

    let items = [];
    try {
      items = typeof po.items === 'string' ? JSON.parse(po.items) : (po.items || []);
    } catch (_) {
      items = [];
    }

    const totalOrdered = items.reduce((sum, itm) => sum + (parseFloat(itm.qty || itm.quantity || 0) || 0), 0);

    const [recvRows] = await pool.execute(
      `SELECT 
        SUM(CASE WHEN approvalStatus = 'Approved' OR approvalStatus IS NULL THEN pieces ELSE 0 END) as approvedPieces,
        SUM(CASE WHEN approvalStatus = 'Pending Approval' THEN pieces ELSE 0 END) as pendingPieces,
        SUM(CASE WHEN approvalStatus = 'Pending Approval' THEN 1 ELSE 0 END) as pendingCount
       FROM weight_capture WHERE LOWER(poNumber) = ?`,
      [cleanPo.toLowerCase()]
    );
    const approvedReceived = Number(recvRows[0]?.approvedPieces) || 0;
    const pendingPieces = Number(recvRows[0]?.pendingPieces) || 0;
    const pendingCount = Number(recvRows[0]?.pendingCount) || 0;

    let newStatus = po.status || 'Sent to Vendor';
    if (pendingCount > 0) {
      newStatus = 'Pending Approval';
    } else if (totalOrdered > 0) {
      if (approvedReceived >= totalOrdered) {
        newStatus = 'Completed';
      } else if (approvedReceived > 0) {
        newStatus = 'Partially Received';
      } else {
        newStatus = 'Sent to Vendor';
      }
    } else if (approvedReceived > 0) {
      newStatus = 'Completed';
    } else {
      newStatus = 'Sent to Vendor';
    }

    if (newStatus !== po.status) {
      await pool.execute('UPDATE purchase_orders SET status=? WHERE id=?', [newStatus, po.id]);
    }
    return { poNumber: cleanPo, totalOrdered, approvedReceived, pendingPieces, status: newStatus };
  } catch (err) {
    console.error('[DB] updatePOCompletionStatus error:', err.message);
    return null;
  }
};

export const getAllPOs = async () => {
  const [rows] = await pool.execute('SELECT * FROM purchase_orders ORDER BY date DESC');
  let captureMap = new Map();
  let statusMap = new Map();
  try {
    const [captures] = await pool.execute(
      'SELECT poNumber, approvalStatus, SUM(pieces) as totalPieces, COUNT(*) as count FROM weight_capture WHERE poNumber IS NOT NULL AND poNumber != "" GROUP BY poNumber, approvalStatus'
    );
    captures.forEach(c => {
      if (c.poNumber) {
        const raw = String(c.poNumber).trim().toLowerCase();
        const clean = raw.replace(/^po-?/i, '');
        const isApproved = c.approvalStatus === 'Approved' || !c.approvalStatus;
        const isRejected = c.approvalStatus === 'Rejected';
        const isPending = c.approvalStatus === 'Pending Approval';
        const pcs = Number(c.totalPieces) || 0;

        [raw, clean, 'po-' + clean].forEach(k => {
          if (!captureMap.has(k)) captureMap.set(k, { approved: 0, rejected: 0, pending: 0 });
          const cur = captureMap.get(k);
          if (isApproved) cur.approved += pcs;
          if (isRejected) cur.rejected += pcs;
          if (isPending) cur.pending += pcs;
        });
      }
    });
  } catch (_) {}

  return rows.map(r => {
    let items = [];
    try {
      items = r.items ? (typeof r.items === 'string' ? JSON.parse(r.items) : r.items) : [];
    } catch (_) {
      items = [];
    }

    const totalOrdered = items.reduce((sum, itm) => sum + (parseFloat(itm.qty || itm.quantity || 0) || 0), 0);
    const rawPo = (r.poNumber || '').trim().toLowerCase();
    const cleanPo = rawPo.replace(/^po-?/i, '');
    const capInfo = captureMap.get(rawPo) || captureMap.get(cleanPo) || captureMap.get('po-' + cleanPo) || { approved: 0, rejected: 0, pending: 0 };
    const totalReceived = capInfo.approved;

    let computedStatus = r.status || 'Sent to Vendor';
    if (capInfo.pending > 0) {
      computedStatus = 'Pending Approval';
    } else if (capInfo.rejected > 0 && capInfo.approved === 0) {
      computedStatus = 'Rejected';
    } else if (totalOrdered > 0) {
      if (totalReceived >= totalOrdered) {
        computedStatus = 'Completed';
      } else if (totalReceived > 0) {
        computedStatus = 'Partially Received';
      }
    } else if (totalReceived > 0) {
      computedStatus = 'Completed';
    }

    return {
      ...r,
      items,
      totalOrdered,
      totalReceived,
      status: computedStatus
    };
  });
};

export const getAcceptedOrders = async () => {
  const all = await getAllPOs();
  let captures = [];
  try {
    const [rows] = await pool.execute(
      "SELECT * FROM weight_capture WHERE approvalStatus = 'Approved' OR approvalStatus IS NULL ORDER BY id ASC"
    );
    captures = rows;
  } catch (_) {}

  const cleanPo = str => String(str || '').trim().toLowerCase().replace(/^po-?/i, '');

  return all
    .filter(po => {
      const isAcc = po.status === 'Completed' || po.status === 'Accepted' || (po.totalOrdered > 0 && po.totalReceived >= po.totalOrdered) || (po.totalReceived > 0 && po.status !== 'Rejected' && po.status !== 'Pending Approval');
      return isAcc;
    })
    .map(po => {
      const norm = cleanPo(po.poNumber);
      const poCaptures = captures.filter(c => cleanPo(c.poNumber) === norm);
      return {
        ...po,
        acceptedCaptures: poCaptures,
        acceptedBills: poCaptures.map(c => ({
          id: c.id,
          invoiceNo: c.invoiceNo || c.billNo || 'N/A',
          materialName: c.materialName || c.category || 'Trim Item',
          pieces: Number(c.pieces) || 0,
          packets: Number(c.packets) || 1,
          location: c.storeLocation || 'Main Store',
          date: c.capturedAt ? new Date(c.capturedAt).toLocaleDateString('en-GB') : (c.date || 'N/A'),
          approvedBy: c.approvedBy || 'Admin',
          approvedAt: c.approvedAt || c.capturedAt || 'N/A'
        }))
      };
    });
};

export const createPO = async (po) => {
  const itemsJson = po.items ? (typeof po.items === 'string' ? po.items : JSON.stringify(po.items)) : '[]';
  let cleanPo = (po.poNumber || '').trim();

  // If no PO number provided, generate next starting from 11000
  if (!cleanPo) {
    cleanPo = await getNextGeneralPoNumber();
  }

  // Check if a record with this exact poNumber already exists to prevent duplicate rows
  const [existing] = await pool.execute('SELECT id FROM purchase_orders WHERE LOWER(poNumber) = LOWER(?)', [cleanPo]);

  let finalId = po.id;
  if (existing.length > 0) {
    finalId = existing[0].id;
  } else if (!po.id || String(po.id).startsWith('PO')) {
    try {
      const [rows] = await pool.execute('SELECT id FROM purchase_orders');
      const ids = rows.map(r => parseInt(r.id, 10)).filter(n => !isNaN(n));
      const maxId = ids.length > 0 ? Math.max(...ids) : 11000;
      finalId = String(Math.max(maxId, 11000) + 1);
    } catch (err) {
      console.warn("Failed to generate sequential PO ID:", err.message);
      finalId = cleanPo.replace(/^PO-?/i, '') || String(Date.now());
    }
  }

  await pool.execute(
    `REPLACE INTO purchase_orders
      (id,poNumber,vendorName,designName,designCategory,
       items,subtotal,taxRate,tax,total,date,deliveryDate,status)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [finalId, cleanPo, po.vendorName || '',
      po.designName || '', po.designCategory || '', itemsJson,
      po.subtotal || 0, po.taxRate || 18, po.tax || 0, po.total || 0,
      po.date || '', po.deliveryDate || '', po.status || 'Draft']
  );

  return { ...po, id: finalId, poNumber: cleanPo };
};

export const updatePOStatus = async (id, status) => {
  await pool.execute('UPDATE purchase_orders SET status=? WHERE id=?', [status, id]);
};

export const getPOByNumberOrId = async (poIdentifier) => {
  const [rows] = await pool.execute(
    'SELECT * FROM purchase_orders WHERE poNumber = ? OR id = ?',
    [poIdentifier, poIdentifier]
  );
  if (rows[0]) {
    const po = rows[0];
    let items = [];
    try {
      items = po.items ? (typeof po.items === 'string' ? JSON.parse(po.items) : po.items) : [];
    } catch (_) {
      items = [];
    }
    const totalOrdered = items.reduce((sum, itm) => sum + (parseFloat(itm.qty || itm.quantity || 0) || 0), 0);

    let totalReceived = 0;
    try {
      const [recvRows] = await pool.execute(
        'SELECT SUM(pieces) as totalPieces FROM weight_capture WHERE LOWER(poNumber) = ?',
        [(po.poNumber || '').toLowerCase()]
      );
      totalReceived = Number(recvRows[0]?.totalPieces) || 0;
    } catch (_) {}

    let computedStatus = po.status || 'Sent to Vendor';
    if (totalOrdered > 0) {
      if (totalReceived >= totalOrdered) {
        computedStatus = 'Completed';
      } else if (totalReceived > 0) {
        computedStatus = 'Partially Received';
      }
    } else if (totalReceived > 0) {
      computedStatus = 'Completed';
    }

    return {
      ...po,
      items,
      totalOrdered,
      totalReceived,
      status: computedStatus
    };
  }
  return null;
};


// ── Vendors ───────────────────────────────────────────────────────────────────

export const getAllVendors = async () => {
  const [rows] = await pool.execute('SELECT * FROM vendors');
  return rows;
};

export const createVendor = async (v) => {
  await pool.execute(
    'REPLACE INTO vendors (id,name,email,address,materialsJoined) VALUES (?,?,?,?,?)',
    [v.id, v.name, v.email || '', v.address || '', v.materialsJoined || '']
  );
};

export const deleteVendor = async (id) => {
  await pool.execute('DELETE FROM vendors WHERE id=?', [id]);
};

// ── Settings ──────────────────────────────────────────────────────────────────

export const getSetting = async (key) => {
  const [rows] = await pool.execute('SELECT setting_value FROM settings WHERE setting_key=?', [key]);
  if (!rows[0]) return null;
  const parsed = JSON.parse(rows[0].setting_value);
  if (key === 'designers_list' && Array.isArray(parsed)) {
    const cleaned = parsed.filter(d => !['sarah connor', 'michael scott'].includes(String(d).toLowerCase().trim()));
    return cleaned.length > 0 ? (cleaned.includes('Admin') ? cleaned : ['Admin', ...cleaned]) : ['Admin'];
  }
  return parsed;
};

export const setSetting = async (key, value) => {
  await pool.execute(
    'REPLACE INTO settings (setting_key,setting_value) VALUES (?,?)',
    [key, JSON.stringify(value)]
  );

  // If warehouse_racks is updated, automatically sync to warehouse_locations table
  if (key === 'warehouse_racks' && Array.isArray(value)) {
    try {
      if (value.length > 0) {
        await bulkSaveWarehouseLocations(value);
        console.log(`[DB] Successfully synced and updated ${value.length} racks in warehouse_locations table.`);
      }
    } catch (locSyncErr) {
      console.error('[DB] Failed to sync warehouse_locations on setting update:', locSyncErr.message);
    }
  }
};

// ── Issue Logs ────────────────────────────────────────────────────────────────

export const getAllIssueLogs = async () => {
  const [rows] = await pool.execute('SELECT * FROM issue_logs ORDER BY date DESC');
  return rows.map(r => ({
    ...r,
    materials: r.materials ? JSON.parse(r.materials) : [],
    isReissue: !!r.isReissue,
    isReturn: !!r.isReturn
  }));
};

export const createIssueLog = async (log) => {
  const materialsJson = log.materials ? JSON.stringify(log.materials) : '[]';
  await pool.execute(
    `INSERT INTO issue_logs (id,lotId,isReissue,isReturn,category,volume,personName,date,materials)
     VALUES (?,?,?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE lotId=VALUES(lotId), date=VALUES(date)`,
    [log.id, log.lotId || '', log.isReissue ? 1 : 0, log.isReturn ? 1 : 0,
    log.category || '', log.volume || 0, log.personName || '', log.date || '', materialsJson]
  );
};

export const getCuttingMatrixByLot = async (lotNo) => {
  const [headers] = await pool.execute('SELECT * FROM cutting_header WHERE LOWER(Lot_Number) = LOWER(?)', [lotNo]);
  if (headers.length === 0) return null;

  const header = headers[0];
  const [matrixRows] = await pool.execute('SELECT * FROM cuttings_matrix WHERE header_id = ?', [header.id]);

  let parsedRows = matrixRows.map(row => {
    const sizes = {};
    if (row.M !== null) sizes['M'] = row.M;
    if (row.L !== null) sizes['L'] = row.L;
    if (row.XL !== null) sizes['XL'] = row.XL;
    if (row.XXL !== null) sizes['XXL'] = row.XXL;

    return {
      color: row.Color || '',
      cuttingTable: row.Cutting_Table,
      sizes: sizes,
      totalPcs: row.Total_Pcs || 0
    };
  });

  // If no detailed matrix rows exist in cuttings_matrix table, generate them from Shades & Sizes
  if (parsedRows.length === 0 && (header.Shades || header.Sizes || header.Cutting_Qty)) {
    const rawShades = (header.Shades || 'Standard')
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
    if (uniqueShades.length === 0) uniqueShades.push({ color: 'As Per Spec', count: 1 });

    const rawSizes = (header.Sizes || 'M, L, XL, XXL')
      .split(/[,/;\r\n]+/)
      .map(s => s.trim().toUpperCase())
      .filter(s => s.length > 0);

    const standardSizes = ['M', 'L', 'XL', 'XXL'];
    const activeSizes = rawSizes.length > 0 ? rawSizes : standardSizes;

    const totalQty = parseInt(header.Cutting_Qty, 10) || uniqueShades.length;
    const qtyPerShade = Math.max(1, Math.floor(totalQty / uniqueShades.length));

    parsedRows = uniqueShades.map(shade => {
      const sizeMap = {};
      const shadeTotal = Math.max(shade.count, qtyPerShade);
      const perSize = Math.max(1, Math.floor(shadeTotal / (activeSizes.length || 1)));

      activeSizes.forEach(sz => {
        sizeMap[sz] = perSize;
      });

      standardSizes.forEach(sz => {
        if (sizeMap[sz] === undefined) sizeMap[sz] = 0;
      });

      return {
        color: shade.color,
        cuttingTable: 1,
        sizes: sizeMap,
        totalPcs: shadeTotal
      };
    });
  }

  // Query latest doori payload for this lot
  let dooriPayload = null;
  try {
    const [dooriRows] = await pool.execute(
      'SELECT dori_payload FROM doori WHERE LOWER(Lot_Number) = LOWER(?) ORDER BY version DESC LIMIT 1',
      [lotNo]
    );
    if (dooriRows.length > 0) {
      dooriPayload = dooriRows[0].dori_payload || null;
    }
  } catch (err) {
    console.warn('Failed to query latest doori_payload:', err.message);
  }

  return {
    lotNumber: header.Lot_Number,
    style: header.Style || '',
    fabric: header.Fabric || '',
    garmentType: header.Garment_Type || '',
    brand: header.Brand || '',
    partyName: header.Party_Name || '',
    zipPayload: header.zip_payload || null,
    doriPayload: dooriPayload,
    rows: parsedRows
  };
};

export const createHistoryEntry = async (lotId, action, actorName, details = '') => {
  const timestamp = new Date().toLocaleDateString('en-GB') + ' ' + new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  await pool.execute(
    'INSERT INTO design_history (lotId, action, actorName, timestamp, details) VALUES (?, ?, ?, ?, ?)',
    [lotId, action, actorName, timestamp, details]
  );
};

export const getAllHistory = async () => {
  const [rows] = await pool.execute('SELECT * FROM design_history ORDER BY id DESC');
  return rows;
};

// ── PO Number counter (atomic, stored in settings) ──────────────────────────
export const getNextPoNumber = async (type) => {
  // type = 'zip' → returns 'ZIP-PO-0001' | type = 'doori' → returns 'DORI-PO-0001'
  const key = type === 'zip' ? 'zip_po_counter' : 'doori_po_counter';
  const prefix = type === 'zip' ? 'ZIP-PO' : 'DORI-PO';

  // Use a transaction to safely increment
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute('SELECT setting_value FROM settings WHERE setting_key = ? FOR UPDATE', [key]);
    const [[row]] = await conn.execute('SELECT setting_value FROM settings WHERE setting_key = ?', [key]);
    const next = (parseInt(row?.setting_value || '0') + 1);
    await conn.execute('UPDATE settings SET setting_value = ? WHERE setting_key = ?', [String(next), key]);
    await conn.commit();
    // Format: ZIP-PO-0001 (padded to 4 digits)
    return `${prefix}-${String(next).padStart(4, '0')}`;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
};

export const getNextGeneralPoNumber = async () => {
  try {
    const [rows] = await pool.execute('SELECT poNumber FROM purchase_orders');
    const [wcRows] = await pool.execute('SELECT poNumber FROM weight_capture WHERE poNumber IS NOT NULL AND poNumber != \'\'');
    
    const allPos = [...rows.map(r => r.poNumber), ...wcRows.map(r => r.poNumber)].filter(Boolean);
    
    let maxNum = 11000;
    for (const po of allPos) {
      const match = String(po).match(/PO-?(\d+)/i) || String(po).match(/(\d+)/);
      if (match) {
        const n = parseInt(match[1], 10);
        if (n >= 11000 && n < 20000 && n > maxNum) {
          maxNum = n;
        }
      }
    }

    return `PO-${maxNum + 1}`;
  } catch (err) {
    console.error('Error generating next PO number:', err);
    return `PO-11001`;
  }
};

// ── Scanner Log entries ───────────────────────────────────────────────────────
export const createScanEntry = async (scan) => {
  // 1. Always insert into scans table
  await pool.execute(
    `INSERT INTO scans (lot_number, scan_type, person_name, material_name, quantity, supplier_name, rgp_payload)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      scan.lot_number || '',
      scan.scan_type || '',
      scan.person_name || '',
      scan.material_name || '',
      Number(scan.quantity) || 0,
      scan.supplier_name || '',
      scan.rgp_payload || null
    ]
  );

  // 2. Mirror scan data into doori + zip tables based on scan_type
  const lotNo = scan.lot_number || '';
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);

  if (scan.scan_type === 'gate_entry') {
    // Update doori table
    await pool.execute(
      `UPDATE doori SET
         Gate_Entry_Person = ?,
         Gate_Entry_Date   = ?,
         Supplier_Name     = ?,
         Material_Entry_Date = ?
       WHERE LOWER(Lot_Number) = LOWER(?)`,
      [scan.person_name, now, scan.supplier_name, now, lotNo]
    );
    // Update zip table — only update the latest row for this lot (highest id)
    await pool.execute(
      `UPDATE zip SET
         Gate_Entry_Person = ?,
         Gate_Entry_Date   = ?,
         Supplier_Name     = ?,
         Material_Entry_Date = ?
       WHERE id = (SELECT max_id FROM (SELECT MAX(id) as max_id FROM zip WHERE LOWER(Lot_Number) = LOWER(?)) AS sub)`,
      [scan.person_name, now, scan.supplier_name, now, lotNo]
    ).catch(() => { }); // zip may not have these columns yet — added below

  } else if (scan.scan_type === 'material_in') {
    await pool.execute(
      `UPDATE doori SET
         Material_Received_By   = ?,
         Material_Received_Date = ?
       WHERE LOWER(Lot_Number) = LOWER(?)`,
      [scan.person_name, now, lotNo]
    );
    // Update only the latest zip row for this lot
    await pool.execute(
      `UPDATE zip SET
         Material_Received_By   = ?,
         Material_Received_Date = ?
       WHERE id = (SELECT max_id FROM (SELECT MAX(id) as max_id FROM zip WHERE LOWER(Lot_Number) = LOWER(?)) AS sub)`,
      [scan.person_name, now, lotNo]
    ).catch(() => { });

  } else if (scan.scan_type === 'supplier_entry') {
    await pool.execute(
      `UPDATE doori SET
         Supplier_Name       = ?,
         Material_Entry_Date = ?
       WHERE LOWER(Lot_Number) = LOWER(?)`,
      [scan.supplier_name, now, lotNo]
    );
    // Update only the latest zip row for this lot
    await pool.execute(
      `UPDATE zip SET
         Supplier_Name       = ?,
         Material_Entry_Date = ?
       WHERE id = (SELECT max_id FROM (SELECT MAX(id) as max_id FROM zip WHERE LOWER(Lot_Number) = LOWER(?)) AS sub)`,
      [scan.supplier_name, now, lotNo]
    ).catch(() => { });
  }
};


export const getAllScans = async () => {
  const [rows] = await pool.execute('SELECT * FROM scans ORDER BY scanned_at DESC');
  return rows;
};

export const getAllCuttingHeaders = async () => {
  const [rows] = await pool.execute('SELECT * FROM cutting_header ORDER BY Saved_At DESC');
  return rows;
};

export const getAllDooriOrders = async () => {
  const [rows] = await pool.execute(`
    SELECT 
      d.id,
      d.Lot_Number,
      d.version,
      d.Garment_Type,
      d.Style,
      d.Fabric,
      d.Total_Pieces,
      d.Issue_Date,
      d.Timestamp,
      d.Supervisor,
      d.Dori_Selections,
      d.Selected_Placements,
      d.Placement_Quantities,
      d.Placement_Dori_Types,
      d.Total_Cost,
      d.po_number,
      d.Gate_Entry_Person,
      d.Gate_Entry_Date,
      d.Material_Received_By,
      d.Material_Received_Date,
      d.Supplier_Name,
      d.Material_Entry_Date,
      d.dori_payload
    FROM doori d
    ORDER BY d.Lot_Number ASC, d.version ASC
  `);
  return rows;
};



export const getAllZipOrders = async () => {
  const [rows] = await pool.execute(`
    SELECT
      z.id,
      z.Lot_Number,
      z.version,
      z.Garment_Type,
      z.Style,
      z.Fabric,
      z.Total_Pieces,
      z.Issue_Date,
      z.Supervisor,
      z.Priority,
      z.Selected_Placements,
      z.Placement_Quantities,
      z.Placement_Zip_Types,
      z.Zip_Selections,
      z.Zip_Quality_Data,
      z.Total_Cost,
      z.po_number,
      z.Gate_Entry_Person,
      z.Gate_Entry_Date,
      z.Material_Received_By,
      z.Material_Received_Date,
      z.Supplier_Name,
      z.Material_Entry_Date,
      z.Saved_At,
      z.zip_payload,
      COALESCE(ch.Garment_Type, z.Garment_Type, '') as ch_garment,
      COALESCE(ch.Style, z.Style, '') as ch_style,
      COALESCE(ch.Fabric, z.Fabric, '') as ch_fabric,
      COALESCE(ch.Party_Name, '') as Brand,
      COALESCE(ch.Cutting_Qty, ch.Stitching_Issue_Qty, z.Total_Pieces, 0) as Total_Pieces_CH
    FROM zip z
    LEFT JOIN cutting_header ch ON z.Lot_Number = ch.Lot_Number
    ORDER BY z.Lot_Number ASC, z.version ASC
  `);
  return rows;
};


export const updateCuttingHeaderPayload = async (lotNo, payload) => {
  // 1. Update the JSON payload column in cutting_header
  await pool.execute(
    'UPDATE cutting_header SET zip_payload = ? WHERE Lot_Number = ?',
    [payload, lotNo]
  );

  // 2. Also upsert structured data into the dedicated zip table
  try {
    const parsed = typeof payload === 'string' ? JSON.parse(payload) : payload;
    await upsertZipOrder(lotNo, parsed, payload);
  } catch (e) {
    console.warn('[DB] Could not upsert zip table:', e.message);
  }
};

export const upsertZipOrder = async (lotNo, data, rawPayload) => {
  // Resolve garment info from cutting_header
  const [cutting] = await pool.execute('SELECT * FROM cutting_header WHERE Lot_Number = ?', [lotNo]);
  const cutRow = cutting[0] || {};

  const selPlacements = JSON.stringify(data.selectedPlacements || []);
  const plQty = JSON.stringify(data.placementQuantities || {});
  const plZipTypes = JSON.stringify(data.placementZipTypes || {});
  const zipSel = JSON.stringify(data.zipSelections || {});
  const zipQuality = JSON.stringify(data.zipQualityData || []);
  const totalPieces = parseInt(cutRow.Cutting_Qty || cutRow.Stitching_Issue_Qty) || 0;
  const payloadStr = typeof rawPayload === 'string' ? rawPayload : JSON.stringify(rawPayload || data);

  // Count how many orders already exist for this lot to compute the next version number
  const [[{ existingCount }]] = await pool.execute(
    'SELECT COUNT(*) as existingCount FROM zip WHERE Lot_Number = ?',
    [lotNo]
  );
  const nextVersion = parseInt(existingCount) + 1;

  // ALWAYS INSERT a new row — same lot gets a new id and an incremented version number.
  // Version 1 = first order, Version 2 = second order for same lot, etc.
  await pool.execute(
    `INSERT INTO zip (
       Lot_Number, version, Garment_Type, Style, Fabric, Total_Pieces, Issue_Date, Supervisor, Priority,
       Selected_Placements, Placement_Quantities, Placement_Zip_Types, Zip_Selections, Zip_Quality_Data,
       Total_Cost, po_number, zip_payload
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      lotNo,
      nextVersion,
      cutRow.Garment_Type || '',
      cutRow.Style || '',
      cutRow.Fabric || '',
      totalPieces,
      data.issueDate || cutRow.Date_of_Issue || '',
      data.supervisor || cutRow.Supervisor || '',
      data.priority || 'Normal',
      selPlacements,
      plQty,
      plZipTypes,
      zipSel,
      zipQuality,
      parseFloat(data.totalCost || 0),
      data.poNumber || '',
      payloadStr
    ]
  );
};

export const updateDooriPayload = async (lotNo, data) => {
  const totalCost = parseFloat(data.Total_Cost || 0);
  const poNumber = data.po_number || '';

  // Get cutting_header for garment info and fallback supervisor/date
  const [cutting] = await pool.execute('SELECT * FROM cutting_header WHERE Lot_Number = ?', [lotNo]);
  const cutRow = cutting[0] || {};

  const supervisor = data.Supervisor || data.supervisor || cutRow.Supervisor || '';
  const issueDate = data.Issue_Date || data.issueDate || cutRow.Date_of_Issue || cutRow.JobOrder_Date || '';
  const garmentType = cutRow.Garment_Type || '';
  const style = cutRow.Style || '';
  const fabric = cutRow.Fabric || '';
  const totalPieces = parseInt(cutRow.Cutting_Qty || cutRow.Stitching_Issue_Qty) || 0;

  // Count how many doori orders already exist for this lot to compute next version
  const [[{ existingCount }]] = await pool.execute(
    'SELECT COUNT(*) as existingCount FROM doori WHERE Lot_Number = ?',
    [lotNo]
  );
  const nextVersion = parseInt(existingCount) + 1;

  // ALWAYS INSERT a new row — same lot gets a new id and incremented version.
  // Version 1 = first order, Version 2 = re-created order, etc. Old data is NEVER modified.
  await pool.execute(
    `INSERT INTO doori (
       Lot_Number, version, Garment_Type, Style, Fabric, Total_Pieces, Issue_Date, Supervisor,
       dori_payload, Dori_Selections, Selected_Placements, Placement_Quantities, Placement_Dori_Types,
       Total_Cost, po_number
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      lotNo,
      nextVersion,
      garmentType,
      style,
      fabric,
      totalPieces,
      issueDate,
      supervisor,
      data.dori_payload,
      data.Dori_Selections,
      data.Selected_Placements,
      data.Placement_Quantities,
      data.Placement_Dori_Types,
      totalCost,
      poNumber
    ]
  );
};



export const resetLotOperationalData = async (lotNo) => {
  const lotNoLower = lotNo.trim().toLowerCase();

  // 1. Delete scans
  await pool.execute('DELETE FROM scans WHERE LOWER(lot_number) = ?', [lotNoLower]);

  // 2. Delete doori payload/order
  await pool.execute('DELETE FROM doori WHERE LOWER(Lot_Number) = ?', [lotNoLower]);

  // 3. Delete cutting header (Zip PO) and matrix rows
  await pool.execute('DELETE FROM cuttings_matrix WHERE LOWER(Lot_No) = ?', [lotNoLower]);
  await pool.execute('DELETE FROM cutting_header WHERE LOWER(Lot_Number) = ?', [lotNoLower]);

  // 4. Delete issue logs
  await pool.execute('DELETE FROM issue_logs WHERE LOWER(lotId) = ?', [lotNoLower]);

  // 5. Delete approval requests
  await pool.execute('DELETE FROM approval_requests WHERE LOWER(lotId) = ?', [lotNoLower]);

  // 6. Delete design history log
  await pool.execute('DELETE FROM design_history WHERE LOWER(lot_number) = ?', [lotNoLower]);

  // 7. Delete purchase orders that contain this lot
  await pool.execute('DELETE FROM purchase_orders WHERE items LIKE ?', [`%"lotNumber":"${lotNo}"%`]);
  await pool.execute('DELETE FROM purchase_orders WHERE items LIKE ?', [`%"lotNumber":"${lotNoLower}"%`]);
};

export const duplicateCuttingHeader = async (oldLotNo, newLotNo) => {
  // Check if target already exists
  const [existing] = await pool.execute('SELECT 1 FROM cutting_header WHERE Lot_Number = ?', [newLotNo]);
  if (existing.length > 0) return;

  // Get old row
  const [rows] = await pool.execute('SELECT * FROM cutting_header WHERE Lot_Number = ?', [oldLotNo]);
  if (rows.length === 0) return;

  const oldRow = rows[0];

  // Insert new row cloning old values but with new lot number and empty zip_payload
  const {
    Fabric, Garment_Type, Style, Sizes, Shades, Saved_At, Date_of_Issue, Supervisor,
    Image_Url, Party_Name, Brand, Season, Direct_Stitching, Challan_History, Zip_Order_Date,
    Zip_Received_Date, WIP_Status, Completed_Status, MWK, JobOrder_Date, Manpower,
    Cutting_Qty, Stitching_Issue_Qty, Priority, Sticker
  } = oldRow;

  const [result] = await pool.execute(
    `INSERT INTO cutting_header (
      Lot_Number, Fabric, Garment_Type, Style, Sizes, Shades, Saved_At, Date_of_Issue, Supervisor,
      Image_Url, Party_Name, Brand, Season, Direct_Stitching, Challan_History, Zip_Order_Date,
      Zip_Received_Date, WIP_Status, Completed_Status, MWK, JobOrder_Date, Manpower,
      Cutting_Qty, Stitching_Issue_Qty, Priority, Sticker, zip_payload
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    [
      newLotNo, Fabric, Garment_Type, Style, Sizes, Shades, Saved_At, Date_of_Issue, Supervisor,
      Image_Url, Party_Name, Brand, Season, Direct_Stitching, Challan_History, Zip_Order_Date,
      Zip_Received_Date, WIP_Status, Completed_Status, MWK, JobOrder_Date, Manpower,
      Cutting_Qty, Stitching_Issue_Qty, Priority, Sticker
    ]
  );

  const newHeaderId = result.insertId;

  // Also duplicate cuttings_matrix rows!
  const [matrixRows] = await pool.execute('SELECT * FROM cuttings_matrix WHERE Lot_No = ?', [oldLotNo]);
  for (const mRow of matrixRows) {
    await pool.execute(
      `INSERT INTO cuttings_matrix (
        header_id, Lot_No, Color, Cutting_Table, M, L, XL, XXL, Total_Pcs
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        newHeaderId, newLotNo, mRow.Color, mRow.Cutting_Table, mRow.M, mRow.L, mRow.XL, mRow.XXL, mRow.Total_Pcs
      ]
    );
  }
};

export const recordMaterialTransfer = async (t) => {
  await pool.execute(
    `INSERT INTO material_transfers (materialCode, materialName, fromLocation, toLocation, quantity, transferType, operator)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [t.materialCode, t.materialName, t.fromLocation, t.toLocation, t.quantity || 1, t.transferType || 'packet', t.operator || 'Admin']
  );
};

export const getMaterialTransfers = async () => {
  const [rows] = await pool.execute('SELECT * FROM material_transfers ORDER BY transferredAt DESC');
  return rows;
};

export const createRgp = async (rgp) => {
  const entriesJson = rgp.entries ? JSON.stringify(rgp.entries) : '[]';
  await pool.execute(
    `INSERT INTO rgp 
      (rgpNo, date, vendor, rgpType, department, purpose, expectedReturnDate, vehicleNo, preparedBy, authorizedBy, remarks, entries)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
      date=VALUES(date), vendor=VALUES(vendor), rgpType=VALUES(rgpType), department=VALUES(department), 
      purpose=VALUES(purpose), expectedReturnDate=VALUES(expectedReturnDate), vehicleNo=VALUES(vehicleNo), 
      preparedBy=VALUES(preparedBy), authorizedBy=VALUES(authorizedBy), remarks=VALUES(remarks), entries=VALUES(entries)`,
    [
      rgp.rgpNo, rgp.date, rgp.vendor, rgp.rgpType, rgp.department || '', rgp.purpose || '',
      rgp.expectedReturnDate || '', rgp.vehicleNo || '', rgp.preparedBy || '', rgp.authorizedBy || '',
      rgp.remarks || '', entriesJson
    ]
  );
};

export const getRgpByNo = async (rgpNo) => {
  const [rows] = await pool.execute(
    'SELECT * FROM rgp WHERE rgpNo = ?',
    [rgpNo]
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  return { ...r, entries: r.entries ? JSON.parse(r.entries) : [] };
};

export const getAllRgps = async () => {
  const [rows] = await pool.execute('SELECT * FROM rgp ORDER BY id DESC');
  return rows.map(r => ({ ...r, entries: r.entries ? JSON.parse(r.entries) : [] }));
};

export const getUndesignedCuttingLots = async () => {
  const [rows] = await pool.execute(`
    SELECT ch.* 
    FROM cutting_header ch
    WHERE ch.Lot_Number IS NOT NULL 
      AND TRIM(ch.Lot_Number) != ''
      AND NOT EXISTS (
        SELECT 1 FROM designs d 
        WHERE LOWER(TRIM(d.id)) = LOWER(TRIM(ch.Lot_Number))
           OR LOWER(TRIM(COALESCE(d.lotNo2, ''))) = LOWER(TRIM(ch.Lot_Number))
           OR LOWER(TRIM(COALESCE(d.name, ''))) = LOWER(TRIM(ch.Lot_Number))
      )
    ORDER BY ch.Saved_At DESC, ch.Date_of_Issue DESC, ch.id DESC
  `);
  return rows;
};

// ── Material Inward Eligibility & Tolerance Checker ─────────────────────────

export const checkInwardEligibility = async ({ poNumber = '', materialName = '', supplier = '', invoiceNo = '', incomingQty = 0 }) => {
  let orderedQty = 0;
  let poFound = false;
  let poDetails = null;

  const cleanPo = (poNumber || '').trim();
  const cleanMat = (materialName || '').trim().toLowerCase();
  const cleanSup = (supplier || '').trim().toLowerCase();
  const cleanInv = (invoiceNo || '').trim().toLowerCase();

  // 1. Look up PO details if poNumber provided
  if (cleanPo) {
    const [poRows] = await pool.execute('SELECT * FROM purchase_orders WHERE LOWER(poNumber) = ?', [cleanPo.toLowerCase()]);
    if (poRows.length > 0) {
      poFound = true;
      poDetails = poRows[0];
      let items = [];
      if (Array.isArray(poDetails.items)) {
        items = poDetails.items;
      } else if (typeof poDetails.items === 'string') {
        try { items = JSON.parse(poDetails.items); } catch (_) { items = []; }
      }

      // Find matching item in PO
      for (const itm of items) {
        const itmName = (itm.name || itm.description || itm.item || '').toLowerCase().trim();
        const itmQty = parseFloat(itm.qty || itm.quantity || 0);
        if (!cleanMat || itmName.includes(cleanMat) || cleanMat.includes(itmName)) {
          orderedQty += itmQty;
        }
      }
      if (orderedQty === 0 && items.length > 0) {
        orderedQty = items.reduce((sum, itm) => sum + (parseFloat(itm.qty || itm.quantity || 0) || 0), 0);
      }
    }
  }

  // 2. Check already received quantity for this PO and material
  let receivedQty = 0;
  if (cleanPo) {
    const [recvRows] = await pool.execute(
      `SELECT SUM(pieces) as totalPieces FROM weight_capture WHERE LOWER(poNumber) = ?`,
      [cleanPo.toLowerCase()]
    );
    receivedQty = Number(recvRows[0]?.totalPieces) || 0;
  }

  const remainingQty = poFound ? Math.max(0, orderedQty - receivedQty) : null;

  // 3. Check for Duplicate Invoice / Bill No from same Supplier
  let isDuplicateInvoice = false;
  let duplicateRecords = [];
  if (cleanSup && cleanInv) {
    const [dupRows] = await pool.execute(
      `SELECT id, materialCode, materialName, poNumber, invoiceNo, supplier, pieces, capturedAt 
       FROM weight_capture 
       WHERE LOWER(supplier) = ? AND LOWER(invoiceNo) = ?`,
      [cleanSup, cleanInv]
    );
    if (dupRows.length > 0) {
      isDuplicateInvoice = true;
      duplicateRecords = dupRows;
    }
  }

  // 4. Check 3% Quantity Tolerance Rule
  let isExcess = false;
  let excessPercent = 0;
  const numIncoming = Number(incomingQty) || 0;

  if (poFound && orderedQty > 0 && remainingQty !== null) {
    // 3% excess rule: exceeds remaining required quantity by > 3%
    const toleranceLimit = remainingQty * 1.03;
    if (numIncoming > toleranceLimit) {
      isExcess = true;
      const diff = numIncoming - remainingQty;
      excessPercent = remainingQty > 0 ? parseFloat(((diff / remainingQty) * 100).toFixed(1)) : 100;
    }
  }

  const reasons = [];
  if (isDuplicateInvoice) {
    reasons.push(`Duplicate Bill No: Invoice "${invoiceNo}" from supplier "${supplier}" was already entered in database.`);
  }
  if (isExcess) {
    reasons.push(`Excess Quantity: Incoming ${numIncoming.toLocaleString()} pcs exceeds remaining needed ${remainingQty?.toLocaleString() || 0} pcs by ${excessPercent}% (> 3% tolerance).`);
  }

  const requiresApproval = isDuplicateInvoice || isExcess;

  return {
    poFound,
    orderedQty,
    receivedQty,
    remainingQty,
    isDuplicateInvoice,
    duplicateRecords,
    isExcess,
    requiresApproval,
    reasons
  };
};

export const getMaterialTraceability = async (query = '') => {
  const q = String(query || '').trim().toLowerCase();
  
  // 1. Fetch materials
  const [allMaterials] = await pool.execute('SELECT * FROM materials ORDER BY name ASC');
  
  // 2. Fetch weight_captures
  const [allCaptures] = await pool.execute('SELECT * FROM weight_capture ORDER BY id DESC');
  
  // 3. Fetch issue_logs / material_issues
  let issueLogs = [];
  try {
    const [iRows] = await pool.execute('SELECT * FROM material_issues ORDER BY id DESC');
    issueLogs = iRows;
  } catch (_) {
    try {
      const [iRows] = await pool.execute('SELECT * FROM issue_logs ORDER BY id DESC');
      issueLogs = iRows;
    } catch (_) {}
  }

  // 4. Fetch material_transfers
  let transfers = [];
  try {
    const [tRows] = await pool.execute('SELECT * FROM material_transfers ORDER BY id DESC');
    transfers = tRows;
  } catch (_) {}

  // 5. Fetch scanner_logs
  let scanLogs = [];
  try {
    const [sRows] = await pool.execute('SELECT * FROM scanner_logs ORDER BY id DESC');
    scanLogs = sRows;
  } catch (_) {}

  // 6. Fetch cutting_header for Lot metadata
  let cuttingLots = {};
  try {
    const [cRows] = await pool.execute('SELECT Lot_Number, Fabric, Garment_Type, Style, Party_Name, Supervisor FROM cutting_header');
    cRows.forEach(c => {
      cuttingLots[String(c.Lot_Number).trim()] = c;
    });
  } catch (_) {}

  // Filter materials matching query
  const matchedMaterials = allMaterials.filter(m => {
    if (!q) return true;
    const mId = String(m.id || '').toLowerCase();
    const mName = String(m.name || '').toLowerCase();
    const mCat = String(m.category || '').toLowerCase();
    const mCol = String(m.color || '').toLowerCase();
    const mLoc = String(m.location || '').toLowerCase();
    return mId.includes(q) || mName.includes(q) || mCat.includes(q) || mCol.includes(q) || mLoc.includes(q);
  });

  // Build complete trace for each matched material
  const traceabilityRecords = matchedMaterials.map(m => {
    const matId = String(m.id || '').trim();
    const matName = String(m.name || '').trim().toLowerCase();

    // Related captures (Inward entries)
    const relatedCaptures = allCaptures.filter(c => {
      const cCode = String(c.materialCode || '').trim().toLowerCase();
      const cName = String(c.materialName || '').trim().toLowerCase();
      const cBarcode = String(c.barcodeId || '').trim().toLowerCase();
      return (cCode && (cCode === matId.toLowerCase() || cCode.includes(matId.toLowerCase()))) ||
             (cName && (cName === matName || cName.includes(matName) || matName.includes(cName))) ||
             (cBarcode && cBarcode.includes(matId.toLowerCase()));
    });

    // Related issue logs (Consumption / Issue against Cutting Lots)
    const relatedIssues = [];
    issueLogs.forEach(log => {
      let matItems = [];
      try {
        matItems = typeof log.materials === 'string' ? JSON.parse(log.materials) : (log.materials || []);
      } catch (_) {
        matItems = [];
      }

      const matchingItem = matItems.find(it => {
        const iId = String(it.materialId || '').trim().toLowerCase();
        const iName = String(it.name || it.materialName || '').trim().toLowerCase();
        return (iId && iId === matId.toLowerCase()) ||
               (iName && (iName === matName || iName.includes(matName) || matName.includes(iName)));
      });

      if (matchingItem) {
        const lotInfo = cuttingLots[String(log.lotId).trim()] || {};
        relatedIssues.push({
          issueId: log.id,
          lotId: log.lotId,
          isReissue: Boolean(log.isReissue),
          isReturn: Boolean(log.isReturn),
          qtyIssued: Number(matchingItem.qty || matchingItem.totalRequired || 0) || 0,
          unit: matchingItem.unit || m.unit || 'pcs',
          bomItemName: matchingItem.bomItemName || 'Accessory',
          personName: log.personName || 'Store Incharge',
          date: log.date || 'N/A',
          fabric: lotInfo.Fabric || 'Standard',
          garmentType: lotInfo.Garment_Type || log.category || 'Garment',
          style: lotInfo.Style || 'Standard',
          supervisor: lotInfo.Supervisor || log.personName || 'Production Supervisor'
        });
      }
    });

    // Related transfers
    const relatedTransfers = transfers.filter(t => {
      const tCode = String(t.materialCode || t.materialId || '').trim().toLowerCase();
      const tName = String(t.materialName || '').trim().toLowerCase();
      return tCode === matId.toLowerCase() || tName.includes(matName) || matName.includes(tName);
    });

    // Related scanner logs
    const relatedScans = scanLogs.filter(s => {
      const sBar = String(s.barcode || '').trim().toLowerCase();
      return sBar.includes(matId.toLowerCase()) || relatedCaptures.some(c => String(c.barcodeId || '').toLowerCase() === sBar);
    });

    // Totals
    const totalInwardPieces = relatedCaptures
      .filter(c => c.approvalStatus === 'Approved' || !c.approvalStatus)
      .reduce((sum, c) => sum + (Number(c.pieces) || 0), 0);
    const totalInwardPackets = relatedCaptures
      .filter(c => c.approvalStatus === 'Approved' || !c.approvalStatus)
      .reduce((sum, c) => sum + (Number(c.packets) || 1), 0);
    const totalIssuedPieces = relatedIssues
      .filter(i => !i.isReturn)
      .reduce((sum, i) => sum + i.qtyIssued, 0);
    const totalReturnedPieces = relatedIssues
      .filter(i => i.isReturn)
      .reduce((sum, i) => sum + i.qtyIssued, 0);

    // Compute Packet-Level Breakdown with Barcodes
    const totalPackets = Math.max(1, Number(m.packets) || totalInwardPackets || 1);
    const primaryBarcodeBase = (relatedCaptures[0]?.barcodeId) || `${matId}-A${String(totalPackets).padStart(2, '0')}`;
    const packetList = [];
    const pcsPerPkt = totalPackets > 0 ? Math.round((Number(m.stock) || 0) / totalPackets) : (Number(m.stock) || 0);

    for (let pIdx = 1; pIdx <= totalPackets; pIdx++) {
      const packetBarcode = `${matId}-PKT${String(pIdx).padStart(3, '0')}`;
      packetList.push({
        packetNo: pIdx,
        totalPackets,
        barcode: packetBarcode,
        location: m.location || 'Main Store',
        pieces: pcsPerPkt,
        status: (Number(m.stock) || 0) > 0 ? 'In Stock' : 'Consumed'
      });
    }

    return {
      material: m,
      totalInwardPieces,
      totalInwardPackets,
      totalIssuedPieces,
      totalReturnedPieces,
      currentStock: Number(m.stock) || 0,
      packetsCount: totalPackets,
      primaryBarcode: primaryBarcodeBase,
      captures: relatedCaptures,
      issues: relatedIssues,
      transfers: relatedTransfers,
      scans: relatedScans,
      packets: packetList
    };
  });

  return traceabilityRecords;
};

// ── Export pool as default ────────────────────────────────────────────────────
export default pool;




