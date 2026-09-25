import express from 'express';
import cors from 'cors';
import compression from 'compression';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import nodemailer from 'nodemailer';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import os from 'os';
import {
  initDb,
  getUserByEmail,
  getUserById,
  createUser,
  verifyUserOtp,
  updateUserOtp,
  getAllDesigns,
  createDesign,
  updateDesignStatus,
  getAllMaterials,
  upsertMaterial,
  deleteMaterial,
  getAllApprovalRequests,
  createApprovalRequest,
  updateApprovalRequestStatus,
  getAllPOs,
  createPO,
  updatePOStatus,
  getPOByNumberOrId,
  getAllVendors,
  createVendor,
  deleteVendor,
  getSetting,
  setSetting,
  getAllIssueLogs,
  createIssueLog,
  getCuttingMatrixByLot,
  createHistoryEntry,
  getAllHistory,
  getDesignById,
  createScanEntry,
  getAllScans,
  getAllCuttingHeaders,
  getAllDooriOrders,
  updateCuttingHeaderPayload,
  updateDooriPayload,
  resetLotOperationalData,
  duplicateCuttingHeader,
  getNextPoNumber,
  getNextGeneralPoNumber,
  getAllZipOrders,
  createMaterialCapture,
  getAllMaterialCaptures,
  recordMaterialTransfer,
  getMaterialTransfers,
  createRgp,
  getRgpByNo,
  getAllRgps,
  getUndesignedCuttingLots,
  getAllWarehouseLocations,
  createWarehouseLocation,
  deleteWarehouseLocation,
  clearAllWarehouseLocations,
  bulkSaveWarehouseLocations,
  checkInwardEligibility,
  approveInwardCapture,
  rejectInwardCapture,
  getAcceptedOrders,
  getMaterialTraceability,
  createExtraMaterialIssue,
  getAllExtraMaterialIssues,
  deleteExtraMaterialIssue,
  createBoneIssue,
  getAllBoneIssues,
  deleteBoneIssue,
  createElasticIssue,
  getAllElasticIssues,
  deleteElasticIssue
} from './db.js';
import pool from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '.env') });
const CACHE_DIR = path.join(__dirname, 'cache');

if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

// Prevent backend crashes from unhandled async errors
process.on('unhandledRejection', (reason, promise) => {
  console.error('[Server] Unhandled Promise Rejection:', reason?.message || reason);
});
process.on('uncaughtException', (err) => {
  console.error('[Server] Uncaught Exception (server continues):', err.message);
});

// Automatic cache size management configurations
const MAX_CACHE_SIZE = 500 * 1024 * 1024; // 500 MB limit
const TARGET_CACHE_SIZE = 350 * 1024 * 1024; // Clean down to 350 MB

const autoCleanCache = () => {
  fs.readdir(CACHE_DIR, (err, files) => {
    if (err) return console.error('Cache directory read error:', err.message);

    const fileDetails = [];
    let totalSize = 0;

    files.forEach(file => {
      const filePath = path.join(CACHE_DIR, file);
      try {
        const stats = fs.statSync(filePath);
        fileDetails.push({ path: filePath, size: stats.size, mtime: stats.mtime });
        totalSize += stats.size;
      } catch (statErr) {
        console.error('Stat error for file:', filePath, statErr.message);
      }
    });

    if (totalSize <= MAX_CACHE_SIZE) return;

    console.log(`[Cache Monitor] Cache size (${(totalSize / 1024 / 1024).toFixed(2)} MB) exceeds 500MB limit. Starting cleanup...`);

    // Sort files by modification time (oldest first)
    fileDetails.sort((a, b) => a.mtime - b.mtime);

    let sizeFreed = 0;
    for (const file of fileDetails) {
      try {
        fs.unlinkSync(file.path);
        totalSize -= file.size;
        sizeFreed += file.size;
        if (totalSize <= TARGET_CACHE_SIZE) break;
      } catch (delErr) {
        console.error('Failed to delete cache file:', file.path, delErr.message);
      }
    }
    console.log(`[Cache Monitor] Cleanup completed. Freed ${(sizeFreed / 1024 / 1024).toFixed(2)} MB.`);
  });
};


const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_gpdms_key_for_jwt_session_validation_2026';

app.use(cors());
app.use(compression());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Initialize Database
try {
  await initDb();
  console.log('Database initialized successfully.');
} catch (err) {
  console.error('Database initialization failed:', err.message);
  process.exit(1);
}

// ── Health Check & System Status Endpoints ─────────────────────────────────────
app.get('/api/ping', (req, res) => res.status(200).send('pong'));

app.get('/api/health', async (req, res) => {
  let dbStatus = 'healthy';
  let dbLatencyMs = 0;
  try {
    const start = Date.now();
    await pool.query('SELECT 1');
    dbLatencyMs = Date.now() - start;
  } catch (e) {
    dbStatus = 'unreachable: ' + e.message;
  }

  const isHealthy = dbStatus === 'healthy';
  res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? 'UP' : 'DEGRADED',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    database: {
      status: dbStatus,
      latencyMs: dbLatencyMs
    },
    syncWorker: syncWorkerStats,
    cache: {
      dir: CACHE_DIR,
      lotsCached: fs.existsSync(LOTS_CSV_CACHE_PATH)
    },
    memory: {
      rssMb: (process.memoryUsage().rss / 1024 / 1024).toFixed(2),
      heapUsedMb: (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)
    }
  });
});

// Mail Transporter Configuration
const getTransporter = () => {
  // If SMTP_SERVICE is set to gmail or if user entered credentials without host, default to Gmail service config
  if (process.env.SMTP_SERVICE === 'gmail' || (process.env.SMTP_USER && process.env.SMTP_PASS && !process.env.SMTP_HOST)) {
    return nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });
  }

  // Custom SMTP configuration
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_PORT === '465',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });
  }
  return null;
};

// Send OTP function
const sendOtpEmail = async (email, name, otpCode) => {
  const transporter = getTransporter();

  if (transporter) {
    try {
      await transporter.sendMail({
        from: '"G-PDMS Secure" <noreply@gpdms.com>',
        to: email,
        subject: 'G-PDMS Account Verification Code',
        text: `Hello ${name},\n\nYour G-PDMS verification code is ${otpCode}. It will expire in 10 minutes.\n\nBest regards,\nG-PDMS Team`,
        html: `<div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px; max-width: 500px;">
          <h2 style="color: #4f46e5; margin-bottom: 20px;">G-PDMS Email Verification</h2>
          <p>Hello <strong>${name}</strong>,</p>
          <p>Your one-time verification code is:</p>
          <div style="font-size: 32px; font-weight: bold; text-align: center; letter-spacing: 5px; color: #4f46e5; background-color: #f1f5f9; padding: 12px; border-radius: 6px; margin: 24px 0;">
            ${otpCode}
          </div>
          <p>This code is valid for 10 minutes. If you did not request this verification, please ignore this email.</p>
          <hr style="border: 0; border-top: 1px solid #e2e8f0; margin-top: 24px;" />
          <p style="font-size: 12px; color: #64748b;">G-PDMS Secure Systems</p>
        </div>`
      });
      console.log(`Email successfully sent to ${email} with OTP ${otpCode}`);
      return true;
    } catch (mailErr) {
      console.error('SMTP Mail error occurred, falling back to console logging:', mailErr.message);
    }
  }

  // Fallback: Console logs
  console.log('\n========================================================================');
  console.log(`📧 SIMULATED EMAIL NOTIFICATION`);
  console.log(`TO: ${email}`);
  console.log(`SUBJECT: G-PDMS Account Verification OTP`);
  console.log(`CODE: ${otpCode}`);
  console.log('========================================================================\n');
  return false;
};

// JWT Authentication Middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ error: 'Access token required.' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Token is invalid or expired.' });
    }
    req.user = user;
    next();
  });
};

// Strict Role-Based Access Control (RBAC) Middleware
const requireRole = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required.' });
    }
    const userRole = (req.user.role || '').toLowerCase();
    // Admin always has full access
    const isAllowed = userRole === 'admin' || allowedRoles.some(r => r.toLowerCase() === userRole);
    if (!isAllowed) {
      return res.status(403).json({
        error: `Access denied. Insufficient permissions for role '${req.user.role || 'User'}'. Required: [${allowedRoles.join(', ')}]`
      });
    }
    next();
  };
};

const requireAdmin = requireRole('Admin');

// Optional Authentication Middleware (Injects req.user if token is present without blocking guest/scanners)
const optionalAuth = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return next();
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (!err && user) req.user = user;
    next();
  });
};

// Health Check Endpoint (For monitoring server uptime, memory, and database pool health)
app.get('/api/health', async (req, res) => {
  try {
    const startTime = Date.now();
    await pool.execute('SELECT 1');
    const dbLatencyMs = Date.now() - startTime;
    const mem = process.memoryUsage();
    res.status(200).json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      database: {
        status: 'connected',
        latencyMs: dbLatencyMs
      },
      system: {
        heapUsedMB: (mem.heapUsed / 1024 / 1024).toFixed(2),
        heapTotalMB: (mem.heapTotal / 1024 / 1024).toFixed(2),
        rssMB: (mem.rss / 1024 / 1024).toFixed(2)
      }
    });
  } catch (err) {
    res.status(503).json({
      status: 'unhealthy',
      database: 'disconnected',
      error: err.message
    });
  }
});

// --- AUTHENTICATION API ROUTES ---

// 1. User Registration Route
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password, role, securityCode, adminCode } = req.body;

    if (!name || !email || !password || !role || !securityCode) {
      return res.status(400).json({ error: 'All fields are required.' });
    }

    if (securityCode.trim() !== 'MHSTORE2026@') {
      return res.status(400).json({ error: 'Invalid Security Code. Use MHSTORE2026@ to register.' });
    }

    const emailRegex = /\S+@\S+\.\S+/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email address format.' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
    }

    // Admin role requires secret code validation
    if (role === 'Admin') {
      const expectedCode = process.env.ADMIN_SECRET_CODE;
      if (!adminCode || adminCode.trim() !== expectedCode) {
        return res.status(403).json({ error: 'Invalid Admin Secret Code. Contact your system administrator.' });
      }
    }

    // Check if user exists
    const userExists = await getUserByEmail(email);
    if (userExists) {
      return res.status(400).json({ error: 'User with this email already exists.' });
    }

    // Hash Password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Save in DB
    await createUser(name, email, hashedPassword, role, null, null);

    // Instantly verify the user so they can log in
    await verifyUserOtp(email);

    res.status(201).json({
      message: 'Registration successful! You can now log in.'
    });
  } catch (err) {
    console.error('Registration API Error:', err.message);
    res.status(500).json({ error: 'Server error during registration.' });
  }
});

// 2. Verify OTP Route
app.post('/api/auth/verify-otp', async (req, res) => {
  try {
    const { email, otpCode } = req.body;

    if (!email || !otpCode) {
      return res.status(400).json({ error: 'Email and OTP code are required.' });
    }

    const user = await getUserByEmail(email);
    if (!user) {
      return res.status(400).json({ error: 'User account not found.' });
    }

    if (user.verified === 1) {
      return res.status(400).json({ error: 'Account is already verified.' });
    }

    if (!user.otp_code || user.otp_code !== otpCode) {
      return res.status(400).json({ error: 'Invalid verification OTP code.' });
    }

    // Check expiry
    const now = new Date();
    const expiry = new Date(user.otp_expires);
    if (now > expiry) {
      return res.status(400).json({ error: 'Verification code has expired.' });
    }

    // Set verified
    await verifyUserOtp(email);

    res.status(200).json({ message: 'Email verified successfully! You can now log in.' });
  } catch (err) {
    console.error('Verify OTP API Error:', err.message);
    res.status(500).json({ error: 'Server error during OTP verification.' });
  }
});

// 3. Resend OTP Route
app.post('/api/auth/resend-otp', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required.' });
    }

    const user = await getUserByEmail(email);
    if (!user) {
      return res.status(400).json({ error: 'User account not found.' });
    }

    if (user.verified === 1) {
      return res.status(400).json({ error: 'Account is already verified.' });
    }

    // Generate new OTP
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    await updateUserOtp(email, otpCode, otpExpires);
    const isRealEmailSent = await sendOtpEmail(email, user.name, otpCode);

    res.status(200).json({
      message: 'New verification code sent successfully.',
      simulatedOtp: isRealEmailSent ? null : otpCode
    });
  } catch (err) {
    console.error('Resend OTP API Error:', err.message);
    res.status(500).json({ error: 'Server error while resending verification code.' });
  }
});

// 4. User Login Route
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const user = await getUserByEmail(email);
    if (!user) {
      return res.status(400).json({ error: 'Invalid email or password.' });
    }

    // Verify Password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ error: 'Invalid email or password.' });
    }

    // Sign JWT
    const token = jwt.sign(
      { id: user.id, name: user.name, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.status(200).json({
      message: 'Login successful!',
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });
  } catch (err) {
    console.error('Login API Error:', err.message);
    res.status(500).json({ error: 'Server error during login.' });
  }
});

// 5. Retrieve Current User Profile Route
app.get('/api/auth/me', authenticateToken, async (req, res) => {
  try {
    const user = await getUserById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User profile not found.' });
    }
    res.status(200).json({ user });
  } catch (err) {
    console.error('Get Profile API Error:', err.message);
    res.status(500).json({ error: 'Server error fetching user profile.' });
  }
});

// Helper: Robust CSV Parser (handles newlines inside quotes and double quote escaping)
function parseCSV(text) {
  const rows = [];
  let currentRow = [];
  let currentVal = '';
  let inQuotes = false;

  const cleanText = text.replace(/\r\n/g, '\n');

  for (let i = 0; i < cleanText.length; i++) {
    const char = cleanText[i];

    if (char === '"') {
      if (inQuotes && cleanText[i + 1] === '"') {
        currentVal += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      currentRow.push(currentVal);
      currentVal = '';
    } else if (char === '\n' && !inQuotes) {
      currentRow.push(currentVal);
      rows.push(currentRow);
      currentRow = [];
      currentVal = '';
    } else {
      currentVal += char;
    }
  }

  if (currentVal || currentRow.length > 0) {
    currentRow.push(currentVal);
    rows.push(currentRow);
  }

  if (rows.length === 0) return [];

  const headers = rows[0].map(h => h.trim());
  const results = [];

  for (let i = 1; i < rows.length; i++) {
    const values = rows[i];
    if (values.length === 1 && values[0] === '') continue;
    const row = {};
    headers.forEach((header, index) => {
      row[header] = values[index] !== undefined ? values[index].trim() : '';
    });
    results.push(row);
  }

  return results;
}

// Helper: Extract image URL from any supported Google Sheet column variant
function extractRowImageUrl(r) {
  if (!r) return '';
  const val = (
    r['Image URL'] ||
    r['Image'] ||
    r['Image Link'] ||
    r['Photo'] ||
    r['Picture'] ||
    r['Drive Link'] ||
    r['ImageURL'] ||
    r['imageUrl'] ||
    r['Image_Url'] ||
    r['Image_URL'] ||
    r['Image link'] ||
    r['Image url'] ||
    ''
  );
  return String(val).trim();
}

// Helper: Get Lots CSV with local caching and offline fallback
const LOTS_CSV_CACHE_PATH = path.join(CACHE_DIR, 'lots.csv');
const LOTS_CACHE_TIME_PATH = path.join(CACHE_DIR, 'lots_cache_time.txt');
const SHEET_CONFIG_PATH = path.join(CACHE_DIR, 'sheet_config.json');
const DEFAULT_SHEET_URL = 'https://docs.google.com/spreadsheets/d/13ArpFOD7idmpv7QIRJQkD-tfswtkH6rNnEANtv2M7Ek/export?format=csv&gid=0';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes TTL

// Read persisted cache time from disk so restarts don't re-trigger fetch
let lastFetchTime = 0;

function parseGoogleSheetUrl(rawInput) {
  if (!rawInput) return DEFAULT_SHEET_URL;
  const str = String(rawInput).trim();
  if (str.startsWith('http://') || str.startsWith('https://')) {
    const dMatch = str.match(/\/d\/([a-zA-Z0-9_-]+)/);
    const gidMatch = str.match(/[?&#]gid=([0-9]+)/);
    if (dMatch && dMatch[1]) {
      const sheetId = dMatch[1];
      const gid = gidMatch ? gidMatch[1] : '0';
      return `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;
    }
    return str;
  }
  return `https://docs.google.com/spreadsheets/d/${str}/export?format=csv&gid=0`;
}

function getActiveSheetUrl() {
  if (process.env.GOOGLE_SHEET_ID && String(process.env.GOOGLE_SHEET_ID).trim()) {
    return parseGoogleSheetUrl(process.env.GOOGLE_SHEET_ID);
  }
  if (process.env.GOOGLE_SHEET_URL && String(process.env.GOOGLE_SHEET_URL).trim()) {
    return parseGoogleSheetUrl(process.env.GOOGLE_SHEET_URL);
  }
  try {
    if (fs.existsSync(SHEET_CONFIG_PATH)) {
      const data = JSON.parse(fs.readFileSync(SHEET_CONFIG_PATH, 'utf8'));
      if (data && data.url) return data.url;
    }
  } catch (e) { }
  return DEFAULT_SHEET_URL;
}

function setActiveSheetUrl(newUrl) {
  const normalizedUrl = parseGoogleSheetUrl(newUrl);
  try {
    fs.writeFileSync(SHEET_CONFIG_PATH, JSON.stringify({ url: normalizedUrl, updatedAt: new Date().toISOString() }, null, 2), 'utf8');
  } catch (e) { }
  return normalizedUrl;
}

async function getLotsCSV(force = false) {
  const url = getActiveSheetUrl();
  const now = Date.now();
  const cacheExists = fs.existsSync(LOTS_CSV_CACHE_PATH);

  // If cache is still fresh and force is false, serve it directly
  if (!force && cacheExists && (now - lastFetchTime < CACHE_TTL_MS)) {
    return fs.readFileSync(LOTS_CSV_CACHE_PATH, 'utf8');
  }

  try {
    // 10-second timeout to prevent indefinite hangs
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Google Sheets export failed with status ${response.status}: ${response.statusText}`);
    }
    const csvText = await response.text();

    // Save to disk cache and persist timestamp
    fs.writeFileSync(LOTS_CSV_CACHE_PATH, csvText, 'utf8');
    lastFetchTime = now;
    fs.writeFileSync(LOTS_CACHE_TIME_PATH, String(now), 'utf8');
    return csvText;
  } catch (err) {
    console.error('[Cache Loader] Google Sheet fetch error:', err.message);

    // Offline/timeout fallback: serve stale cache if available
    if (cacheExists) {
      console.warn('[Offline Fallback] Serving stale cached CSV.');
      lastFetchTime = now;
      fs.writeFileSync(LOTS_CACHE_TIME_PATH, String(now), 'utf8');
      return fs.readFileSync(LOTS_CSV_CACHE_PATH, 'utf8');
    }
    console.warn('[Fallback] No cache available — returning empty lots.');
    lastFetchTime = now;
    return '';
  }
}

// In-memory hash of the last successfully synced CSV to eliminate duplicate processing
let lastSyncedCsvHash = '';

// Background worker sync statistics
let syncWorkerStats = {
  lastSyncedAt: new Date().toISOString(),
  lastSyncDurationMs: 0,
  lastStatus: 'ready',
  totalProcessed: 0,
  inserted: 0,
  updated: 0,
  error: null
};

// Helper to batch ensure cuttings_matrix rows in MySQL database
async function batchEnsureCuttingsMatrix(items) {
  if (!items || items.length === 0) return;

  const standardSizes = ['M', 'L', 'XL', 'XXL'];
  const matrixValues = [];

  for (const item of items) {
    const { headerId, lotNo, shadesStr, sizesStr, totalQty } = item;
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

      matrixValues.push([
        headerId,
        lotNo || '',
        shade.color,
        1,
        sizeMap['M'] || 0,
        sizeMap['L'] || 0,
        sizeMap['XL'] || 0,
        sizeMap['XXL'] || 0,
        shadeTotal
      ]);
    }
  }

  if (matrixValues.length === 0) return;

  // Multi-row INSERT in chunks of 100 for high database throughput
  for (let i = 0; i < matrixValues.length; i += 100) {
    const chunk = matrixValues.slice(i, i + 100);
    const placeholders = chunk.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
    const flatParams = chunk.flat();
    await pool.execute(
      `INSERT INTO cuttings_matrix (header_id, Lot_No, Color, Cutting_Table, M, L, XL, XXL, Total_Pcs)
       VALUES ${placeholders}`,
      flatParams
    );
  }
}

// Reusable function to synchronize Google Sheets lots into MySQL database in batch (<300ms)
export async function syncGoogleSheetsToDb(force = false) {
  const syncStartTime = Date.now();
  try {
    const csvText = await getLotsCSV(force);
    if (!csvText) {
      console.warn('[Sync] No CSV text retrieved from Google Sheets.');
      return { success: false, error: 'Failed to download Google Sheet CSV.' };
    }

    const currentHash = crypto.createHash('md5').update(csvText).digest('hex');
    if (!force && lastSyncedCsvHash && currentHash === lastSyncedCsvHash) {
      return {
        success: true,
        message: 'Google Sheets data is already up to date in database.',
        inserted: 0,
        updated: 0,
        cached: true
      };
    }

    const rows = parseCSV(csvText);
    if (rows.length === 0) {
      lastSyncedCsvHash = currentHash;
      return { success: true, inserted: 0, updated: 0, totalProcessed: 0 };
    }

    // Filter valid rows & de-duplicate by lot number
    const validRowsMap = new Map();
    for (const r of rows) {
      const rawLot = r['Lot Number'] || r['Lot No'] || r['Job Order No'];
      if (!rawLot || !rawLot.trim()) continue;
      const trimmedLot = rawLot.trim().substring(0, 100);
      if (trimmedLot.length > 50 || trimmedLot.toLowerCase().includes('total') || trimmedLot.toLowerCase().includes('summary')) {
        continue;
      }
      const key = trimmedLot.toLowerCase();
      if (!validRowsMap.has(key)) {
        validRowsMap.set(key, { ...r, _cleanLot: trimmedLot });
      }
    }

    const uniqueRows = Array.from(validRowsMap.values());
    if (uniqueRows.length === 0) {
      lastSyncedCsvHash = currentHash;
      return { success: true, inserted: 0, updated: 0, totalProcessed: 0 };
    }

    // Step 1: Fetch all existing Lot Numbers from DB in a single fast query
    const [existingRows] = await pool.execute('SELECT id, LOWER(TRIM(Lot_Number)) AS lot_key FROM cutting_header WHERE Lot_Number IS NOT NULL');
    const existingMap = new Map();
    for (const row of existingRows) {
      if (row.lot_key) existingMap.set(row.lot_key, row.id);
    }

    const toInsert = [];
    const toUpdate = [];

    for (const r of uniqueRows) {
      const key = r._cleanLot.toLowerCase();
      if (existingMap.has(key)) {
        toUpdate.push({ id: existingMap.get(key), row: r });
      } else {
        toInsert.push(r);
      }
    }

    let inserted = 0;
    let updated = 0;

    // Step 2: Batch Insert new rows in chunks of 50
    if (toInsert.length > 0) {
      const chunkSize = 50;

      for (let i = 0; i < toInsert.length; i += chunkSize) {
        const chunk = toInsert.slice(i, i + chunkSize);
        const placeholders = chunk.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
        const flatParams = [];

        chunk.forEach(r => {
          const rowImg = extractRowImageUrl(r);
          flatParams.push(
            r._cleanLot,
            (r['Fabric'] || '').substring(0, 255),
            (r['Garment Type'] || '').substring(0, 255),
            (r['Style'] || '').substring(0, 255),
            (r['Size'] || '').substring(0, 255),
            r['Shade'] || '',
            new Date().toISOString(),
            (r['Date'] || '').substring(0, 100),
            (r['Submitted By'] || '').substring(0, 255),
            (r['Party Name'] || '').substring(0, 255),
            (r['Brand'] || '').substring(0, 255),
            (r['Season'] || '').substring(0, 100),
            (r['Direct Stitching'] || '').substring(0, 100),
            parseInt(r['Quantity']) || 0,
            (r['Priority'] || 'Normal').substring(0, 50),
            (r['Sticker'] || '').substring(0, 100),
            rowImg.substring(0, 1000),
            null
          );
        });

        await pool.execute(
          `INSERT INTO cutting_header (
            Lot_Number, Fabric, Garment_Type, Style, Sizes, Shades, Saved_At, Date_of_Issue, Supervisor,
            Party_Name, Brand, Season, Direct_Stitching, Cutting_Qty, Priority, Sticker, Image_Url, zip_payload
          ) VALUES ${placeholders}`,
          flatParams
        );
        inserted += chunk.length;
      }

      // Re-fetch inserted IDs for cuttings_matrix generation
      const insertedLots = toInsert.map(r => r._cleanLot);
      for (let i = 0; i < insertedLots.length; i += 100) {
        const lotChunk = insertedLots.slice(i, i + 100);
        const qPlaceholders = lotChunk.map(() => '?').join(', ');
        const [insertedHeaderRows] = await pool.execute(
          `SELECT id, Lot_Number FROM cutting_header WHERE Lot_Number IN (${qPlaceholders})`,
          lotChunk
        );

        const headerIdMap = new Map();
        insertedHeaderRows.forEach(h => headerIdMap.set(h.Lot_Number.toLowerCase(), h.id));

        const matrixChunkItems = [];
        lotChunk.forEach(lotStr => {
          const rowObj = validRowsMap.get(lotStr.toLowerCase());
          const headerId = headerIdMap.get(lotStr.toLowerCase());
          if (headerId && rowObj) {
            matrixChunkItems.push({
              headerId,
              lotNo: rowObj._cleanLot,
              shadesStr: rowObj['Shade'],
              sizesStr: rowObj['Size'],
              totalQty: rowObj['Quantity']
            });
          }
        });

        await batchEnsureCuttingsMatrix(matrixChunkItems).catch(e => console.warn('[Matrix Batch Warning]:', e.message));
      }
    }

    // Step 3: Batch Update existing rows in chunks of 20
    if (toUpdate.length > 0) {
      const updateConcurrency = 20;
      for (let i = 0; i < toUpdate.length; i += updateConcurrency) {
        const chunk = toUpdate.slice(i, i + updateConcurrency);
        await Promise.all(
          chunk.map(async ({ id, row: r }) => {
            const rowImg = extractRowImageUrl(r);
            await pool.execute(
              `UPDATE cutting_header SET
                Fabric = COALESCE(NULLIF(?, ''), Fabric),
                Garment_Type = COALESCE(NULLIF(?, ''), Garment_Type),
                Style = COALESCE(NULLIF(?, ''), Style),
                Brand = COALESCE(NULLIF(?, ''), Brand),
                Party_Name = COALESCE(NULLIF(?, ''), Party_Name),
                Cutting_Qty = COALESCE(NULLIF(?, 0), Cutting_Qty),
                Image_Url = COALESCE(NULLIF(?, ''), Image_Url)
               WHERE id = ?`,
              [
                (r['Fabric'] || '').substring(0, 255),
                (r['Garment Type'] || '').substring(0, 255),
                (r['Style'] || '').substring(0, 255),
                (r['Brand'] || '').substring(0, 255),
                (r['Party Name'] || '').substring(0, 255),
                parseInt(r['Quantity']) || 0,
                rowImg.substring(0, 1000),
                id
              ]
            );
          })
        );
        updated += chunk.length;
      }
    }

    lastSyncedCsvHash = currentHash;
    const duration = Date.now() - syncStartTime;
    syncWorkerStats = {
      lastSyncedAt: new Date().toISOString(),
      lastSyncDurationMs: duration,
      lastStatus: 'success',
      totalProcessed: uniqueRows.length,
      inserted,
      updated,
      error: null
    };

    console.log(`[Incremental Sync] Complete in ${duration}ms. Inserted: ${inserted}, Updated: ${updated}, Total: ${uniqueRows.length}`);
    return {
      success: true,
      message: 'Google Sheets synchronized successfully with database.',
      inserted,
      updated,
      durationMs: duration,
      totalProcessed: uniqueRows.length
    };
  } catch (err) {
    console.error('[Sync] Error syncing Google Sheets to DB:', err.message);
    syncWorkerStats = {
      ...syncWorkerStats,
      lastStatus: 'error',
      error: err.message
    };
    return { success: false, error: err.message };
  }
}

// 6. Retrieve Lot Data from Google Sheet with MySQL Database Fallback & Auto-Save
app.get('/api/lot/:lotNo', async (req, res) => {
  try {
    const lotNo = req.params.lotNo.trim();
    if (!lotNo) {
      return res.status(400).json({ error: 'Lot number parameter is required.' });
    }

    console.log(`[Lot Fetch] Searching for lot: ${lotNo}...`);
    let matchedRow = null;

    // Helper for robust case-insensitive and alias-aware row column retrieval
    const getCol = (row, ...keys) => {
      if (!row) return '';
      for (const k of keys) {
        if (row[k] !== undefined && row[k] !== null && String(row[k]).trim() !== '') {
          return String(row[k]).trim();
        }
      }
      const rowKeys = Object.keys(row);
      for (const k of keys) {
        const cleanK = k.toLowerCase().replace(/[^a-z0-9]/g, '');
        const found = rowKeys.find(rk => rk.toLowerCase().replace(/[^a-z0-9]/g, '') === cleanK);
        if (found && row[found] !== undefined && row[found] !== null && String(row[found]).trim() !== '') {
          return String(row[found]).trim();
        }
      }
      return '';
    };

    // Step 1: Try fetching from Google Sheet CSV (live sync)
    try {
      const csvText = await getLotsCSV(true);
      if (csvText) {
        const rows = parseCSV(csvText);
        matchedRow = rows.find(row => {
          const rowLotNo = getCol(row, 'Lot Number', 'Lot No', 'Job Order No', 'lot');
          return rowLotNo && String(rowLotNo).trim().toLowerCase() === lotNo.toLowerCase();
        });
      }
    } catch (csvErr) {
      console.warn(`[Lot Fetch] Google Sheet CSV error for ${lotNo}:`, csvErr.message);
    }

    if (matchedRow) {
      console.log(`[Lot Fetch] Successfully matched lot from Google Sheet: ${lotNo}`);
      const rowImg = extractRowImageUrl(matchedRow);

      // Auto-save/persist this lot into MySQL cutting_header immediately so database stays updated
      (async () => {
        try {
          const rawLot = getCol(matchedRow, 'Lot Number', 'Lot No', 'Job Order No', 'lot') || lotNo;
          const trimmedLot = String(rawLot).trim().substring(0, 100);
          let headerId = null;
          const [existing] = await pool.execute('SELECT id, Image_Url FROM cutting_header WHERE Lot_Number = ?', [trimmedLot]);
          if (existing.length === 0) {
            const [ins] = await pool.execute(
              `INSERT INTO cutting_header (
                Lot_Number, Fabric, Garment_Type, Style, Sizes, Shades, Saved_At, Date_of_Issue, Supervisor,
                Party_Name, Brand, Season, Direct_Stitching, Cutting_Qty, Priority, Sticker, Image_Url, zip_payload
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                trimmedLot,
                getCol(matchedRow, 'Fabric').substring(0, 255),
                getCol(matchedRow, 'Garment Type', 'Garment_Type').substring(0, 255),
                getCol(matchedRow, 'Style').substring(0, 255),
                getCol(matchedRow, 'Size', 'Sizes').substring(0, 255),
                getCol(matchedRow, 'Shade', 'Shades'),
                new Date().toISOString(),
                getCol(matchedRow, 'Date', 'Date of Issue').substring(0, 100),
                getCol(matchedRow, 'Submitted By', 'Supervisor').substring(0, 255),
                getCol(matchedRow, 'Party Name', 'Party_Name').substring(0, 255),
                getCol(matchedRow, 'Brand').substring(0, 255),
                getCol(matchedRow, 'Season').substring(0, 100),
                getCol(matchedRow, 'Direct Stitching').substring(0, 100),
                parseInt(getCol(matchedRow, 'Quantity', 'Cutting_Qty')) || 0,
                (getCol(matchedRow, 'Priority') || 'Normal').substring(0, 50),
                getCol(matchedRow, 'Sticker', 'STICKER').substring(0, 100),
                rowImg.substring(0, 1000),
                null
              ]
            );
            headerId = ins.insertId;
            console.log(`[Lot Fetch] Auto-saved new lot "${trimmedLot}" into MySQL cutting_header with image.`);
          } else {
            headerId = existing[0].id;
            if (rowImg && !existing[0].Image_Url) {
              await pool.execute('UPDATE cutting_header SET Image_Url = ? WHERE id = ?', [rowImg.substring(0, 1000), headerId]).catch(() => { });
            }
          }

          if (headerId) {
            await batchEnsureCuttingsMatrix([{
              headerId,
              lotNo: trimmedLot,
              shadesStr: getCol(matchedRow, 'Shade', 'Shades'),
              sizesStr: getCol(matchedRow, 'Size', 'Sizes'),
              totalQty: getCol(matchedRow, 'Quantity', 'Cutting_Qty')
            }]).catch(() => { });
          }
        } catch (dbSaveErr) {
          console.warn('[Lot Fetch] Auto-save to DB warning:', dbSaveErr.message);
        }
      })();

      return res.status(200).json({
        lotNo: getCol(matchedRow, 'Lot Number', 'Lot No', 'Job Order No', 'lot') || lotNo,
        fabric: getCol(matchedRow, 'Fabric'),
        brand: getCol(matchedRow, 'Brand'),
        garmentType: getCol(matchedRow, 'Garment Type', 'Garment_Type'),
        section: getCol(matchedRow, 'Section', 'MWK'),
        season: getCol(matchedRow, 'Season'),
        style: getCol(matchedRow, 'Style'),
        component: getCol(matchedRow, 'Component', 'Component '),
        tapeLace: getCol(matchedRow, 'Tape/Lace', 'Tape / Lace', 'Tape', 'Lace'),
        bottomType: getCol(matchedRow, 'Bottom Type', 'Bottom', 'Elastic', 'Rib'),
        zip: getCol(matchedRow, 'Zip', 'ZIP'),
        sticker: getCol(matchedRow, 'Sticker', 'STICKER', 'Label'),
        collar: getCol(matchedRow, 'Collar', 'COLLAR'),
        bone: getCol(matchedRow, 'Bone', 'BONE', 'Piping'),
        fullBaju: getCol(matchedRow, 'FULL BAJU', 'Full Baju', 'Full Sleeve', 'Baju'),
        button: getCol(matchedRow, 'Button', 'Buttons', 'BUTTON'),
        pocket: getCol(matchedRow, 'Pocket', 'Pockets', 'POCKET'),
        dori: getCol(matchedRow, 'Dori', 'DORI', 'Drawstring', 'Nara', 'DRAWSTRING', 'NARA'),
        drawstring: getCol(matchedRow, 'Drawstring', 'DRAWSTRING', 'Nara', 'NARA', 'Dori', 'DORI'),
        tag: getCol(matchedRow, 'Tag', 'TAG', 'Hang Tag', 'HangTag'),
        label: getCol(matchedRow, 'Label', 'LABEL', 'Sticker', 'STICKER'),
        thread: getCol(matchedRow, 'Thread', 'THREAD'),
        hook: getCol(matchedRow, 'Hook', 'Buckle', 'Velcro', 'Hook, buckle, velcro'),
        fusing: getCol(matchedRow, 'Interlining', 'Fusing', 'Interlining / fusing'),
        shade: getCol(matchedRow, 'Shade', 'Shades'),
        size: getCol(matchedRow, 'Size', 'Sizes'),
        quantity: getCol(matchedRow, 'Quantity', 'Cutting_Qty'),
        unit: getCol(matchedRow, 'Unit') || 'Pcs',
        partyName: getCol(matchedRow, 'Party Name', 'Party_Name'),
        emb: getCol(matchedRow, 'Emb'),
        embDetails: getCol(matchedRow, 'Emb Details'),
        printing: getCol(matchedRow, 'Printing'),
        printingDetails: getCol(matchedRow, 'Printing Details'),
        pattern: getCol(matchedRow, 'Pattern'),
        remarks: getCol(matchedRow, 'Remarks'),
        directStitching: getCol(matchedRow, 'Direct Stitching'),
        submittedBy: getCol(matchedRow, 'Submitted By'),
        imageUrl: rowImg,
        priority: getCol(matchedRow, 'Priority'),
        status: getCol(matchedRow, 'Status'),
        rawRow: matchedRow
      });
    }

    // Step 2: Fallback to MySQL cutting_header table
    console.log(`[Lot Fetch] Lot "${lotNo}" not in Google Sheet CSV. Checking MySQL cutting_header...`);
    const [dbRows] = await pool.execute(
      'SELECT * FROM cutting_header WHERE LOWER(Lot_Number) = LOWER(?) LIMIT 1',
      [lotNo]
    );

    if (dbRows && dbRows.length > 0) {
      const cut = dbRows[0];
      console.log(`[Lot Fetch] Successfully found lot "${lotNo}" in MySQL cutting_header!`);
      return res.status(200).json({
        lotNo: cut.Lot_Number || lotNo,
        fabric: cut.Fabric || '',
        brand: cut.Brand || cut.Party_Name || '',
        garmentType: cut.Garment_Type || '',
        section: cut.MWK || '',
        season: cut.Season || '',
        style: cut.Style || '',
        component: '',
        tapeLace: '',
        bottomType: '',
        zip: '',
        sticker: cut.Sticker || '',
        collar: '',
        bone: '',
        fullBaju: '',
        shade: cut.Shades || '',
        size: cut.Sizes || '',
        quantity: cut.Cutting_Qty || cut.Stitching_Issue_Qty || '',
        unit: 'Pcs',
        partyName: cut.Party_Name || '',
        emb: '',
        embDetails: '',
        printing: '',
        printingDetails: '',
        pattern: '',
        remarks: '',
        directStitching: cut.Direct_Stitching || '',
        submittedBy: cut.Supervisor || '',
        imageUrl: cut.Image_Url || '',
        priority: cut.Priority || 'Normal',
        status: cut.Completed_Status || cut.WIP_Status || ''
      });
    }

    // Step 3: Fallback to MySQL designs table
    const [designRows] = await pool.execute(
      'SELECT * FROM designs WHERE LOWER(id) = LOWER(?) OR LOWER(lotNo2) = LOWER(?) LIMIT 1',
      [lotNo, lotNo]
    );
    if (designRows && designRows.length > 0) {
      const des = designRows[0];
      console.log(`[Lot Fetch] Successfully found lot "${lotNo}" in MySQL designs table!`);
      return res.status(200).json({
        lotNo: des.id || lotNo,
        fabric: des.fabricType || '',
        brand: des.brand || '',
        garmentType: des.category || '',
        section: des.section || '',
        season: des.season || '',
        style: des.style || '',
        component: '',
        tapeLace: des.tapeLace || '',
        bottomType: des.bottomType || '',
        zip: des.zip || '',
        sticker: des.sticker || '',
        collar: des.collar || '',
        bone: des.bone || '',
        fullBaju: des.fullBaju || '',
        shade: des.colorCode || '',
        size: des.targetSizes || '',
        quantity: des.quantity || '',
        unit: 'Pcs',
        partyName: des.brand || '',
        emb: '',
        embDetails: '',
        printing: '',
        printingDetails: '',
        pattern: '',
        remarks: des.comments || '',
        directStitching: '',
        submittedBy: des.designer || '',
        imageUrl: des.imageUrl || '',
        priority: 'Normal',
        status: des.status || ''
      });
    }

    console.log(`[Lot Fetch] Lot "${lotNo}" not found in Google Sheet or Database.`);
    return res.status(404).json({ error: `Lot number "${lotNo}" not found in Google Sheet or database.` });
  } catch (err) {
    console.error('[Lot Fetch] Error:', err.message);
    res.status(500).json({ error: 'Server failed to retrieve lot data: ' + err.message });
  }
});

app.get('/api/lots', async (req, res) => {
  try {
    const { getAllCuttingHeaders } = await import('./db.js');
    const headers = await getAllCuttingHeaders();
    const lots = headers
      .filter(h => h.Lot_Number)
      .map(h => ({
        lotNo: String(h.Lot_Number).trim(),
        fabric: h.Fabric || '',
        brand: h.Brand || h.Party_Name || '',
        garmentType: h.Garment_Type || '',
        style: h.Style || '',
        season: h.Season || '',
        section: h.MWK || '',
        imageUrl: h.Image_Url || '',
        quantity: h.Cutting_Qty || 0,
        shades: h.Shades || '',
        sizes: h.Sizes || '',
        itemName: h.Garment_Type || h.Style || 'Unknown Item'
      }));
    res.status(200).json(lots);
  } catch (err) {
    console.error('API GET /api/lots error:', err.message);
    res.status(500).json({ error: 'Failed to retrieve lots from database.' });
  }
});

// 7.1 Safe Sync Endpoint: Import Google Sheets lots into MySQL without dropping tables
app.get('/api/sheet-config', (req, res) => {
  try {
    const currentUrl = getActiveSheetUrl();
    const dMatch = currentUrl.match(/\/d\/([a-zA-Z0-9_-]+)/);
    const gidMatch = currentUrl.match(/[?&#]gid=([0-9]+)/);
    res.json({
      url: currentUrl,
      sheetId: dMatch ? dMatch[1] : '',
      gid: gidMatch ? gidMatch[1] : '0'
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to read sheet config: ' + err.message });
  }
});

app.post('/api/sheet-config', async (req, res) => {
  try {
    const { url, sheetId, gid } = req.body || {};
    let target = url;
    if (!target && sheetId) {
      target = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid || 0}`;
    }
    if (!target || !String(target).trim()) {
      return res.status(400).json({ error: 'Please provide a valid Google Sheet URL or Sheet ID' });
    }
    const savedUrl = setActiveSheetUrl(target);
    // Clear cache immediately
    if (fs.existsSync(LOTS_CSV_CACHE_PATH)) {
      try { fs.unlinkSync(LOTS_CSV_CACHE_PATH); } catch (e) { }
    }
    lastFetchTime = 0;

    // Automatically trigger 1-click sync
    const syncResult = await syncGoogleSheetsToDb(true);
    res.json({
      success: true,
      url: savedUrl,
      syncResult
    });
  } catch (err) {
    console.error('Error updating sheet config:', err.message);
    res.status(500).json({ error: 'Failed to update Google Sheet: ' + err.message });
  }
});

app.post('/api/sync-google-sheets', async (req, res) => {
  try {
    const result = await syncGoogleSheetsToDb(true);
    if (!result.success) {
      return res.status(500).json({ error: result.error || 'Failed to sync Google Sheets' });
    }
    res.status(200).json(result);
  } catch (err) {
    console.error('[Sync] Error syncing Google Sheets to DB:', err.message);
    res.status(500).json({ error: 'Sync failed: ' + err.message });
  }
});

// GET /api/sync/status: Check background worker status, last sync timestamp, and MySQL record counts
app.get('/api/sync/status', async (req, res) => {
  try {
    const [countRows] = await pool.execute('SELECT COUNT(*) AS total FROM cutting_header');
    res.status(200).json({
      success: true,
      workerStats: syncWorkerStats,
      totalLotsInDb: countRows[0]?.total || 0,
      activeSheetUrl: getActiveSheetUrl()
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 7.2 Cutting lot reports which are not designed yet (supports live Google Sheets sync)
app.get('/api/reports/undesigned-cutting-lots', async (req, res) => {
  try {
    const isLive = req.query.live === 'true' || req.query.fresh === 'true';
    if (isLive) {
      await syncGoogleSheetsToDb(true).catch(e => console.warn('[Live Sync Warning]:', e.message));
    }
    const lots = await getUndesignedCuttingLots();
    res.status(200).json(lots);
  } catch (err) {
    console.error('API GET /api/reports/undesigned-cutting-lots error:', err.message);
    res.status(500).json({ error: 'Failed to retrieve undesigned cutting lots.' });
  }
});

// 7.3 Next PO Number Endpoint
app.get('/api/next-po-number', async (req, res) => {
  try {
    const type = (req.query.type || 'general').toLowerCase();
    let nextPo;
    if (type === 'zip') {
      nextPo = await getNextPoNumber('zip');
    } else if (type === 'doori' || type === 'dori') {
      nextPo = await getNextPoNumber('doori');
    } else {
      nextPo = await getNextGeneralPoNumber();
    }
    res.status(200).json({ nextPoNumber: nextPo, poNumber: nextPo });
  } catch (err) {
    console.error('API GET /api/next-po-number error:', err.message);
    res.status(500).json({ error: 'Failed to generate next PO number: ' + err.message });
  }
});


// 7.4 Approvals List Endpoint Alias
app.get('/api/approvals', async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM approval_requests ORDER BY id DESC');
    res.status(200).json(rows);
  } catch (err) {
    console.error('API GET /api/approvals error:', err.message);
    res.status(500).json({ error: 'Failed to fetch approval requests.' });
  }
});




// 8. Image Proxy to cache Google Drive images and avoid 429 Rate Limit errors
app.get('/api/image-proxy', async (req, res) => {
  try {
    const imageUrl = req.query.url;
    if (!imageUrl) {
      return res.status(400).json({ error: 'Image URL query parameter is required.' });
    }

    // Extract Google Drive File ID
    let fileId = '';
    const fileDMatch = imageUrl.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
    const driveDMatch = imageUrl.match(/\/d\/([a-zA-Z0-9_-]+)/);
    const idParamMatch = imageUrl.match(/[?&]id=([a-zA-Z0-9_-]+)/);

    if (fileDMatch && fileDMatch[1]) {
      fileId = fileDMatch[1];
    } else if (driveDMatch && driveDMatch[1]) {
      fileId = driveDMatch[1];
    } else if (idParamMatch && idParamMatch[1]) {
      fileId = idParamMatch[1];
    }

    if (!fileId) {
      // If it's not a Google Drive link, redirect directly to it
      return res.redirect(imageUrl);
    }

    const cachePath = path.join(CACHE_DIR, `${fileId}`);

    // Check if the image is cached locally
    if (fs.existsSync(cachePath)) {
      const stats = fs.statSync(cachePath);
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Content-Length', stats.size);
      res.setHeader('Cache-Control', 'public, max-age=31536000'); // Cache for 1 year
      return fs.createReadStream(cachePath).pipe(res);
    }

    // Fetch from Google Drive with fallbacks
    const candidateUrls = [
      `https://lh3.googleusercontent.com/d/${fileId}`,
      `https://drive.google.com/thumbnail?id=${fileId}&sz=w1200`,
      `https://drive.google.com/uc?export=download&id=${fileId}`
    ];

    let imageBuffer = null;
    let contentType = 'image/jpeg';

    for (const dUrl of candidateUrls) {
      try {
        const response = await fetch(dUrl);
        if (response.ok) {
          const cType = response.headers.get('content-type') || '';
          if (cType.includes('image') || cType.includes('octet-stream')) {
            imageBuffer = Buffer.from(await response.arrayBuffer());
            contentType = cType.includes('image') ? cType : 'image/jpeg';
            break;
          }
        }
      } catch (fErr) {
        console.warn(`[Image Proxy] Fetch attempt failed for ${dUrl}:`, fErr.message);
      }
    }

    if (!imageBuffer) {
      return res.redirect(`https://drive.google.com/uc?export=download&id=${fileId}`);
    }

    // Save in cache folder asynchronously
    fs.writeFile(cachePath, imageBuffer, (err) => {
      if (!err) {
        autoCleanCache();
      }
    });

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', imageBuffer.length);
    res.setHeader('Cache-Control', 'public, max-age=31536000');
    res.end(imageBuffer);

  } catch (err) {
    console.error('Image Proxy Error:', err.message);
    res.redirect(req.query.url);
  }
});

// GET all designs from SQLite/MySQL
app.get('/api/designs', async (req, res) => {
  try {
    const designs = await getAllDesigns();
    const parsed = designs.map(d => ({
      ...d,
      bom: typeof d.bom === 'string' ? JSON.parse(d.bom) : d.bom
    }));
    res.status(200).json(parsed);
  } catch (err) {
    console.error('API GET /api/designs error:', err.message);
    res.status(500).json({ error: 'Failed to retrieve designs.' });
  }
});

// POST save/insert design to SQLite/MySQL
app.post('/api/designs', async (req, res) => {
  try {
    const design = { ...req.body };
    const actorName = design.actorName || 'Designer';
    delete design.actorName;

    const isEdit = !!design.isEdit;
    delete design.isEdit;


    const serialized = {
      ...design,
      bom: typeof design.bom === 'object' ? JSON.stringify(design.bom) : design.bom
    };
    await createDesign(serialized);
    await createHistoryEntry(design.id, 'created', actorName, `Lot created with category ${design.category || 'N/A'}, style ${design.style || 'N/A'}`);

    // Automatically create a pending design_verification approval request
    if (design.status === 'In Verification') {
      const formattedTime = new Date().toLocaleDateString('en-GB') + ' ' + new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      await createApprovalRequest({
        id: `AR${Date.now()}`,
        type: 'design_verification',
        status: 'pending',
        requesterName: actorName,
        requesterRole: 'Designer',
        date: formattedTime,
        lotId: design.id,
        pieces: design.quantity || 100,
        reason: `Design Submission: Style ${design.style || 'N/A'} - Category ${design.category || 'N/A'}`
      });
    }

    res.status(201).json({ message: 'Design saved successfully.', design });
  } catch (err) {
    console.error('API POST /api/designs error:', err.message);
    res.status(500).json({ error: 'Failed to save design.' });
  }
});

// PUT update design verification status in SQLite/MySQL
app.put('/api/designs/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status, comments, actorName } = req.body;
    await updateDesignStatus(id, status, comments || '');

    const action = status === 'Approved' ? 'approved' : 'rejected';
    await createHistoryEntry(id, action, actorName || 'Admin', comments || '');

    res.status(200).json({ message: 'Design status updated successfully.' });
  } catch (err) {
    console.error('API PUT /api/designs/:id/status error:', err.message);
    res.status(500).json({ error: 'Failed to update status.' });
  }
});

// GET all design history logs
app.get('/api/design-history', async (req, res) => {
  try {
    const history = await getAllHistory();
    res.status(200).json(history);
  } catch (err) {
    console.error('API GET /api/design-history error:', err.message);
    res.status(500).json({ error: 'Failed to retrieve history logs.' });
  }
});

// ── Materials Routes ─────────────────────────────────────────────────────────

// GET all materials
app.get('/api/materials', async (req, res) => {
  try {
    const materials = await getAllMaterials();
    res.status(200).json(materials);
  } catch (err) {
    console.error('API GET /api/materials error:', err.message);
    res.status(500).json({ error: 'Failed to retrieve materials.' });
  }
});

// POST add new material
app.post('/api/materials', async (req, res) => {
  try {
    const m = req.body;
    await upsertMaterial(m);
    res.status(201).json({ message: 'Material saved successfully.', material: m });
  } catch (err) {
    console.error('API POST /api/materials error:', err.message);
    res.status(500).json({ error: 'Failed to save material.' });
  }
});

// PUT update a material (stock, cost, etc.)
app.put('/api/materials/:id', async (req, res) => {
  try {
    const m = { ...req.body, id: req.params.id };
    await upsertMaterial(m);
    res.status(200).json({ message: 'Material updated successfully.' });
  } catch (err) {
    console.error('API PUT /api/materials/:id error:', err.message);
    res.status(500).json({ error: 'Failed to update material.' });
  }
});

// DELETE a material
app.delete('/api/materials/:id', async (req, res) => {
  try {
    await deleteMaterial(req.params.id);
    res.status(200).json({ message: 'Material deleted successfully.' });
  } catch (err) {
    console.error('API DELETE /api/materials/:id error:', err.message);
    res.status(500).json({ error: 'Failed to delete material.' });
  }
});

// GET all transfers log
app.get('/api/transfers', async (req, res) => {
  try {
    const transfers = await getMaterialTransfers();
    res.status(200).json(transfers);
  } catch (err) {
    console.error('API GET /api/transfers error:', err.message);
    res.status(500).json({ error: 'Failed to retrieve transfers log.' });
  }
});

// POST record new transfer log
app.post('/api/transfers', async (req, res) => {
  try {
    const t = req.body;
    await recordMaterialTransfer(t);
    res.status(201).json({ message: 'Transfer logged successfully.' });
  } catch (err) {
    console.error('API POST /api/transfers error:', err.message);
    res.status(500).json({ error: 'Failed to log transfer.' });
  }
});

// ── Approval Request Routes ───────────────────────────────────────────────────

// GET all approval requests
app.get('/api/approval-requests', async (req, res) => {
  try {
    const requests = await getAllApprovalRequests();
    res.status(200).json(requests);
  } catch (err) {
    console.error('API GET /api/approval-requests error:', err.message);
    res.status(500).json({ error: 'Failed to retrieve approval requests.' });
  }
});

// POST create new approval request
app.post('/api/approval-requests', async (req, res) => {
  try {
    const req_data = req.body;
    await createApprovalRequest(req_data);
    res.status(201).json({ message: 'Approval request submitted.', request: req_data });
  } catch (err) {
    console.error('API POST /api/approval-requests error:', err.message);
    res.status(500).json({ error: 'Failed to submit approval request.' });
  }
});

// PUT approve or reject an approval request
app.put('/api/approval-requests/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status, rejectionReason, resolvedDate: bodyResolvedDate } = req.body;
    const resolvedDate = bodyResolvedDate || new Date().toLocaleDateString('en-GB');
    await updateApprovalRequestStatus(id, status, { rejectionReason: rejectionReason || '', resolvedDate });
    res.status(200).json({ message: 'Approval request status updated.' });
  } catch (err) {
    console.error('API PUT /api/approval-requests/:id/status error:', err.message);
    res.status(500).json({ error: 'Failed to update approval request.' });
  }
});

// ── Purchase Order Routes ───────────────────────────────────────────────────

// GET all purchase orders with optional filtering (?material=..., ?status=..., ?search=...)
app.get('/api/pos', async (req, res) => {
  try {
    const { material, search, status, vendor } = req.query;
    let pos = await getAllPOs();

    if (material && material !== 'all') {
      const matLower = String(material).toLowerCase().trim();
      pos = pos.filter(po => {
        if (!po.items || !Array.isArray(po.items)) return false;
        return po.items.some(item => {
          const name = String(item.name || item.description || item.item || '').toLowerCase().trim();
          const dept = String(item.department || item.dept || item.category || '').toLowerCase().trim();
          return name.includes(matLower) || dept.includes(matLower);
        });
      });
    }

    if (status && status !== 'all') {
      const sLower = String(status).toLowerCase().trim();
      pos = pos.filter(po => {
        const s = String(po.status || '').toLowerCase();
        return s.includes(sLower);
      });
    }

    if (vendor && vendor !== 'all') {
      const vLower = String(vendor).toLowerCase().trim();
      pos = pos.filter(po => {
        const v = String(po.vendorName || '').toLowerCase();
        return v.includes(vLower);
      });
    }

    if (search) {
      const q = String(search).toLowerCase().trim();
      const cleanQ = q.replace(/^po-?/i, '').trim();
      pos = pos.filter(po => {
        const poNum = String(po.poNumber || '').toLowerCase();
        const vName = String(po.vendorName || '').toLowerCase();
        const dName = String(po.designName || '').toLowerCase();
        const dCat = String(po.designCategory || '').toLowerCase();
        const itemsStr = Array.isArray(po.items) ? po.items.map(i => (i.name || i.description || i.item || '')).join(' ').toLowerCase() : '';

        return (
          poNum.includes(q) ||
          (cleanQ && poNum.replace(/^po-?/i, '').includes(cleanQ)) ||
          vName.includes(q) ||
          dName.includes(q) ||
          dCat.includes(q) ||
          itemsStr.includes(q)
        );
      });
    }

    res.status(200).json(pos);
  } catch (err) {
    console.error('API GET /api/pos error:', err.message);
    res.status(500).json({ error: 'Failed to retrieve purchase orders.' });
  }
});

// GET dedicated accepted orders and their approved inward records
app.get('/api/accepted-orders', async (req, res) => {
  try {
    const accepted = await getAcceptedOrders();
    res.status(200).json({ success: true, count: accepted.length, data: accepted });
  } catch (err) {
    console.error('API GET /api/accepted-orders error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to retrieve accepted orders.' });
  }
});

// GET unique material list from all POs
app.get('/api/pos/materials', async (req, res) => {
  try {
    const pos = await getAllPOs();
    const matSet = new Set();
    pos.forEach(po => {
      if (Array.isArray(po.items)) {
        po.items.forEach(itm => {
          const n = String(itm.name || itm.description || itm.item || '').trim();
          if (n) matSet.add(n);
        });
      }
    });
    res.status(200).json({ success: true, materials: Array.from(matSet).sort() });
  } catch (err) {
    console.error('API GET /api/pos/materials error:', err.message);
    res.status(500).json({ error: 'Failed to retrieve PO materials.' });
  }
});

// GET Material Traceability & Full Lifecycle History
app.get('/api/materials/traceability', async (req, res) => {
  try {
    const { query } = req.query;
    const records = await getMaterialTraceability(query || '');
    res.status(200).json({ success: true, count: records.length, data: records });
  } catch (err) {
    console.error('API GET /api/materials/traceability error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to retrieve material traceability data.' });
  }
});

// GET next unique sequential PO number
app.get('/api/pos/next-number', async (req, res) => {
  try {
    const nextPoNumber = await getNextGeneralPoNumber();
    res.status(200).json({ success: true, nextPoNumber });
  } catch (err) {
    console.error('API GET /api/pos/next-number error:', err.message);
    res.status(500).json({ error: 'Failed to generate next PO number.' });
  }
});

// GET purchase order by PO number
app.get('/api/pos/:poNumber', async (req, res) => {
  try {
    const { poNumber } = req.params;
    const po = await getPOByNumberOrId(poNumber);
    if (!po) {
      return res.status(404).json({ error: 'Purchase order not found.' });
    }
    res.status(200).json(po);
  } catch (err) {
    console.error('API GET /api/pos/:poNumber error:', err.message);
    res.status(500).json({ error: 'Failed to retrieve purchase order.' });
  }
});

// POST create new purchase order
app.post('/api/pos', async (req, res) => {
  try {
    const po = req.body;
    const savedPo = await createPO(po);
    res.status(201).json({ message: 'Purchase order saved.', po: savedPo });
  } catch (err) {
    console.error('API POST /api/pos error:', err.message);
    res.status(500).json({ error: 'Failed to save purchase order.' });
  }
});

// PUT update PO status
app.put('/api/pos/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    await updatePOStatus(req.params.id, status);
    res.status(200).json({ message: 'PO status updated.' });
  } catch (err) {
    console.error('API PUT /api/pos/:id/status error:', err.message);
    res.status(500).json({ error: 'Failed to update PO status.' });
  }
});

// PUT save Zip PO payload in cutting_header
app.put('/api/cutting-headers/:lotNo/payload', async (req, res) => {
  try {
    const { lotNo } = req.params;
    const { zip_payload, po_number } = req.body;
    // Inject po_number into parsed payload so upsertZipOrder saves it
    let payloadToSave = zip_payload;
    if (po_number && zip_payload) {
      try {
        const parsed = JSON.parse(zip_payload);
        parsed.poNumber = po_number;
        payloadToSave = JSON.stringify(parsed);
      } catch (_) { }
    }
    await updateCuttingHeaderPayload(lotNo, payloadToSave);
    res.status(200).json({ message: 'Zip PO payload updated.' });
  } catch (err) {
    console.error('API PUT /api/cutting-headers/:lotNo/payload error:', err.message);
    res.status(500).json({ error: 'Failed to update Zip PO payload.' });
  }
});

// PUT save Doori PO payload in doori
app.put('/api/doori-orders/:lotNo/payload', async (req, res) => {
  try {
    const { lotNo } = req.params;
    await updateDooriPayload(lotNo, req.body);
    res.status(200).json({ message: 'Doori PO payload updated.' });
  } catch (err) {
    console.error('API PUT /api/doori-orders/:lotNo/payload error:', err.message);
    res.status(500).json({ error: 'Failed to update Doori PO payload.' });
  }
});

// GET next unique PO number (auto-increment per type)
app.get('/api/po-number/next/:type', async (req, res) => {
  try {
    const type = req.params.type; // 'zip', 'doori', 'bone', 'bone_issue', 'elastic', or 'elastic_issue'
    if (!['zip', 'doori', 'bone', 'bone_issue', 'elastic', 'elastic_issue'].includes(type)) {
      return res.status(400).json({ error: 'Type must be zip, doori, bone, bone_issue, elastic, or elastic_issue.' });
    }
    const poNumber = await getNextPoNumber(type);
    res.status(200).json({ poNumber });
  } catch (err) {
    console.error('API GET /api/po-number/next error:', err.message);
    res.status(500).json({ error: 'Failed to generate PO number.' });
  }
});

// ── Vendor Routes ───────────────────────────────────────────────────────────

// GET all vendors
app.get('/api/vendors', async (req, res) => {
  try {
    const vendors = await getAllVendors();
    res.status(200).json(vendors);
  } catch (err) {
    console.error('API GET /api/vendors error:', err.message);
    res.status(500).json({ error: 'Failed to retrieve vendors.' });
  }
});

// POST add a vendor
app.post('/api/vendors', async (req, res) => {
  try {
    await createVendor(req.body);
    res.status(201).json({ message: 'Vendor saved.', vendor: req.body });
  } catch (err) {
    console.error('API POST /api/vendors error:', err.message);
    res.status(500).json({ error: 'Failed to save vendor.' });
  }
});

// DELETE a vendor
app.delete('/api/vendors/:id', async (req, res) => {
  try {
    await deleteVendor(req.params.id);
    res.status(200).json({ message: 'Vendor deleted.' });
  } catch (err) {
    console.error('API DELETE /api/vendors/:id error:', err.message);
    res.status(500).json({ error: 'Failed to delete vendor.' });
  }
});

// ── Settings Routes (accessories & designers lists) ─────────────────────────

// GET all settings (accessories_list, designers_list, warehouse_halls, warehouse_racks, allow_material_photo_edit)
app.get('/api/settings', async (req, res) => {
  try {
    const accessoriesList = await getSetting('accessories_list');
    const designersList = await getSetting('designers_list');
    const warehouseHalls = await getSetting('warehouse_halls');
    const warehouseRacks = await getSetting('warehouse_racks');
    const allowMaterialPhotoEdit = await getSetting('allow_material_photo_edit');
    const allowWarehouseAddRack = await getSetting('allow_warehouse_add_rack');
    res.status(200).json({
      accessoriesList: accessoriesList || [],
      designersList: designersList || [],
      warehouseHalls: warehouseHalls || [],
      warehouseRacks: warehouseRacks || [],
      allowMaterialPhotoEdit: (allowMaterialPhotoEdit !== null && allowMaterialPhotoEdit !== undefined) ? Boolean(allowMaterialPhotoEdit) : true,
      allowWarehouseAddRack: (allowWarehouseAddRack !== null && allowWarehouseAddRack !== undefined) ? Boolean(allowWarehouseAddRack) : false
    });
  } catch (err) {
    console.error('API GET /api/settings error:', err.message);
    res.status(500).json({ error: 'Failed to retrieve settings.' });
  }
});

// PUT update a setting by key
app.put('/api/settings/:key', async (req, res) => {
  try {
    const { key } = req.params;
    const { value } = req.body;
    await setSetting(key, value);
    res.status(200).json({ message: `Setting "${key}" updated.` });
  } catch (err) {
    console.error('API PUT /api/settings/:key error:', err.message);
    res.status(500).json({ error: 'Failed to update setting.' });
  }
});

// ── Issue Log Routes ────────────────────────────────────────────────────────

// GET all material issue/return logs
app.get('/api/issue-logs', async (req, res) => {
  try {
    const logs = await getAllIssueLogs();
    res.status(200).json(logs);
  } catch (err) {
    console.error('API GET /api/issue-logs error:', err.message);
    res.status(500).json({ error: 'Failed to retrieve issue logs.' });
  }
});

// POST save a new issue/return log entry
app.post('/api/issue-logs', async (req, res) => {
  try {
    await createIssueLog(req.body);
    res.status(201).json({ message: 'Issue log saved.' });
  } catch (err) {
    console.error('API POST /api/issue-logs error:', err.message);
    res.status(500).json({ error: 'Failed to save issue log.' });
  }
});

// ── Extra Material Issues Dedicated Table Routes ───────────────────────────

// GET all extra material issue records (with optional ?lotId=)
app.get('/api/extra-material-issues', async (req, res) => {
  try {
    const lotId = req.query.lotId || null;
    const records = await getAllExtraMaterialIssues(lotId);
    res.status(200).json(records);
  } catch (err) {
    console.error('API GET /api/extra-material-issues error:', err.message);
    res.status(500).json({ error: 'Failed to retrieve extra material issue records.' });
  }
});

// POST save new extra material issue record(s)
app.post('/api/extra-material-issues', async (req, res) => {
  try {
    const result = await createExtraMaterialIssue(req.body);
    res.status(201).json({ message: 'Extra material issue record(s) saved to database table.', ...result });
  } catch (err) {
    console.error('API POST /api/extra-material-issues error:', err.message);
    res.status(500).json({ error: 'Failed to save extra material issue record.' });
  }
});

// DELETE extra material issue record by ID
app.delete('/api/extra-material-issues/:id', async (req, res) => {
  try {
    await deleteExtraMaterialIssue(req.params.id);
    res.status(200).json({ message: 'Extra material issue record deleted.' });
  } catch (err) {
    console.error('API DELETE /api/extra-material-issues/:id error:', err.message);
    res.status(500).json({ error: 'Failed to delete extra material issue record.' });
  }
});

// ── Dedicated Bone Issue Table Routes ──────────────────────────────────────────

// GET all bone issues from dedicated table (optional ?lotNo=)
app.get('/api/bone-issues', async (req, res) => {
  try {
    const lotNo = req.query.lotNo || req.query.lotId || null;
    const records = await getAllBoneIssues(lotNo);
    res.status(200).json(records);
  } catch (err) {
    console.error('API GET /api/bone-issues error:', err.message);
    res.status(500).json({ error: 'Failed to retrieve bone issue records.' });
  }
});

// POST save a new bone issue record into dedicated table
app.post('/api/bone-issues', async (req, res) => {
  try {
    const record = await createBoneIssue(req.body);
    res.status(201).json({ message: 'Bone issue saved successfully to database table.', data: record });
  } catch (err) {
    console.error('API POST /api/bone-issues error:', err.message);
    res.status(500).json({ error: err.message || 'Failed to save bone issue record.' });
  }
});

// DELETE bone issue record by ID or slipNo
app.delete('/api/bone-issues/:id', async (req, res) => {
  try {
    await deleteBoneIssue(req.params.id);
    res.status(200).json({ message: 'Bone issue deleted from database table.' });
  } catch (err) {
    console.error('API DELETE /api/bone-issues error:', err.message);
    res.status(500).json({ error: 'Failed to delete bone issue record.' });
  }
});

// ── Dedicated Elastic Issue Table Routes ───────────────────────────────────────

// GET all elastic issues from dedicated table (optional ?lotNo=)
app.get('/api/elastic-issues', async (req, res) => {
  try {
    const lotNo = req.query.lotNo || req.query.lotId || null;
    const records = await getAllElasticIssues(lotNo);
    res.status(200).json(records);
  } catch (err) {
    console.error('API GET /api/elastic-issues error:', err.message);
    res.status(500).json({ error: 'Failed to retrieve elastic issue records.' });
  }
});

// POST save a new elastic issue record into dedicated table
app.post('/api/elastic-issues', async (req, res) => {
  try {
    const record = await createElasticIssue(req.body);
    res.status(201).json({ message: 'Elastic issue saved successfully to database table.', data: record });
  } catch (err) {
    console.error('API POST /api/elastic-issues error:', err.message);
    res.status(500).json({ error: err.message || 'Failed to save elastic issue record.' });
  }
});

// DELETE elastic issue record by ID or slipNo
app.delete('/api/elastic-issues/:id', async (req, res) => {
  try {
    await deleteElasticIssue(req.params.id);
    res.status(200).json({ message: 'Elastic issue deleted from database table.' });
  } catch (err) {
    console.error('API DELETE /api/elastic-issues error:', err.message);
    res.status(500).json({ error: 'Failed to delete elastic issue record.' });
  }
});

// GET cutting matrix and header data by lot number
app.get('/api/cutting/:lotNo', async (req, res) => {
  try {
    const lotNo = req.params.lotNo.trim();
    let result = await getCuttingMatrixByLot(lotNo);

    // If not found, and lotNo is versioned (e.g. 11028-V2), check if we can duplicate from base lot
    if (!result && lotNo.includes('-V')) {
      const baseLot = lotNo.split('-V')[0];
      const baseResult = await getCuttingMatrixByLot(baseLot);
      if (baseResult) {
        await duplicateCuttingHeader(baseLot, lotNo);
        result = await getCuttingMatrixByLot(lotNo);
      }
    }

    if (!result) {
      return res.status(200).json({ header: null, rows: [] });
    }
    res.status(200).json(result);
  } catch (err) {
    console.error('API GET /api/cutting/:lotNo error:', err.message);
    res.status(500).json({ error: 'Failed to retrieve cutting matrix.' });
  }
});

// ── Scanner API Endpoints ───────────────────────────────────────────────────

// POST a new scanned entry (unauthenticated, so mobile scans work directly)
app.post('/api/scans', async (req, res) => {
  try {
    const { lot_number, scan_type, person_name, material_name, quantity, supplier_name, rgp_payload } = req.body;
    if (!person_name || !material_name || !supplier_name || (scan_type !== 'gate_entry' && !quantity)) {
      return res.status(400).json({ error: 'Person, material, quantity, and supplier are required.' });
    }
    await createScanEntry({
      lot_number,
      scan_type,
      person_name,
      material_name,
      quantity,
      supplier_name,
      rgp_payload
    });
    res.status(201).json({ message: 'Scan entry saved successfully!' });
  } catch (err) {
    console.error('API POST /api/scans error:', err.message);
    res.status(500).json({ error: 'Failed to save scanned entry.' });
  }
});

// GET all scans (for logs dashboard)
app.get('/api/scans', async (req, res) => {
  try {
    const scans = await getAllScans();
    res.status(200).json(scans);
  } catch (err) {
    console.error('API GET /api/scans error:', err.message);
    res.status(500).json({ error: 'Failed to retrieve scanned logs.' });
  }
});

// ── RGP API Endpoints ────────────────────────────────────────────────────────

// POST a new RGP entry
app.post('/api/rgp', async (req, res) => {
  try {
    const rgpData = req.body;
    if (!rgpData.rgpNo || !rgpData.vendor || !rgpData.date) {
      return res.status(400).json({ error: 'RGP Number, Vendor, and Date are required.' });
    }
    await createRgp(rgpData);
    res.status(201).json({ message: 'RGP saved successfully to database!' });
  } catch (err) {
    console.error('API POST /api/rgp error:', err.message);
    res.status(500).json({ error: 'Failed to save RGP.' });
  }
});

// GET all RGP entries
app.get('/api/rgp', async (req, res) => {
  try {
    const rgps = await getAllRgps();
    res.status(200).json(rgps);
  } catch (err) {
    console.error('API GET /api/rgp error:', err.message);
    res.status(500).json({ error: 'Failed to retrieve RGPs.' });
  }
});

// GET RGP by RGP Number
app.get('/api/rgp/:rgpNo', async (req, res) => {
  try {
    const rgpNo = req.params.rgpNo;
    const rgp = await getRgpByNo(rgpNo);
    if (!rgp) {
      return res.status(404).json({ error: 'RGP not found.' });
    }
    res.status(200).json(rgp);
  } catch (err) {
    console.error('API GET /api/rgp/:rgpNo error:', err.message);
    res.status(500).json({ error: 'Failed to retrieve RGP.' });
  }
});

// GET design by ID publicly (for barcode scanner form prefilling)
app.get('/api/public/lot/:lotNo', async (req, res) => {
  try {
    const lotNo = req.params.lotNo;
    const design = await getDesignById(lotNo);
    if (!design) {
      // Check if it is a Purchase Order
      const po = await getPOByNumberOrId(lotNo);
      if (po) {
        const totalQty = po.items.reduce((sum, item) => sum + (Number(item.qty) || 0), 0);
        return res.status(200).json({
          id: po.poNumber,
          name: po.designName || 'Purchase Order',
          bom: po.items.map(item => ({
            name: item.name,
            description: item.name,
            status: 'Yes',
            detail: String(item.qty)
          })),
          brand: po.vendorName,
          category: po.designCategory || 'N/A',
          style: po.poNumber,
          quantity: totalQty,
          date: po.date
        });
      }
      return res.status(404).json({ error: `Design Lot or PO ${lotNo} not found in database.` });
    }
    res.status(200).json({
      id: design.id,
      name: design.name,
      bom: typeof design.bom === 'string' ? JSON.parse(design.bom) : design.bom,
      brand: design.brand,
      category: design.category,
      style: design.style,
      quantity: design.quantity,
      date: design.date,
      status: design.status
    });
  } catch (err) {
    console.error('API GET /api/public/lot/:lotNo error:', err.stack);
    res.status(500).json({ error: 'Failed to retrieve public design/PO info.' });
  }
});

// GET local network IP of the server publicly (so frontend can build accessible QR code URLs)
app.get('/api/public/server-ip', (req, res) => {
  try {
    const interfaces = os.networkInterfaces();
    let localIp = 'localhost';
    for (const interfaceName in interfaces) {
      const addresses = interfaces[interfaceName];
      for (const address of addresses) {
        // Exclude loopback/internal addresses and filter for IPv4
        if (address.family === 'IPv4' && !address.internal) {
          localIp = address.address;
          break;
        }
      }
      if (localIp !== 'localhost') break;
    }
    res.status(200).json({ ip: localIp });
  } catch (err) {
    console.error('API GET /api/public/server-ip error:', err.message);
    res.status(500).json({ error: 'Failed to retrieve server local IP.' });
  }
});

// GET all cutting headers (Zip POs) from database
app.get('/api/cutting-headers', async (req, res) => {
  try {
    const headers = await getAllCuttingHeaders();
    res.status(200).json(headers);
  } catch (err) {
    console.error('API GET /api/cutting-headers error:', err.message);
    res.status(500).json({ error: 'Failed to retrieve cutting headers.' });
  }
});

// GET all doori orders (Dori POs) from database
app.get('/api/doori-orders', async (req, res) => {
  try {
    const orders = await getAllDooriOrders();
    res.status(200).json(orders);
  } catch (err) {
    console.error('API GET /api/doori-orders error:', err.message);
    res.status(500).json({ error: 'Failed to retrieve doori orders.' });
  }
});

// GET all zip orders (Zip POs) from database
app.get('/api/zip-orders', async (req, res) => {
  try {
    const orders = await getAllZipOrders();
    res.status(200).json(orders);
  } catch (err) {
    console.error('API GET /api/zip-orders error:', err.message);
    res.status(500).json({ error: 'Failed to retrieve zip orders.' });
  }
});


// ── Weight Capture (Weighbridge) API ────────────────────────────────────────
app.post('/api/weight-capture', async (req, res) => {
  try {
    const insertId = await createMaterialCapture(req.body);
    res.json({ success: true, id: insertId, message: 'Weight capture saved.' });
  } catch (err) {
    console.error('[API] weight-capture POST error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/weight-capture', async (req, res) => {
  try {
    const isSummary = req.query.summary === 'true' || req.query.summary === '1';
    const rows = await getAllMaterialCaptures(isSummary);
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('[API] weight-capture GET error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Inward Material PO Requirement, Duplicate Bill & 3% Tolerance Checker ──
app.post('/api/inward/check-eligibility', async (req, res) => {
  try {
    const result = await checkInwardEligibility(req.body);
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[API] inward check-eligibility error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Inward Excess Approval / Rejection Endpoints ────────────────────────────
app.post('/api/inward/approve', async (req, res) => {
  try {
    const { id, approvedBy, note } = req.body;
    if (!id) return res.status(400).json({ success: false, error: 'Capture ID is required.' });
    await approveInwardCapture(id, approvedBy || 'Admin', note);
    res.json({ success: true, message: `Inward capture #${id} approved and finalized into inventory.` });
  } catch (err) {
    console.error('[API] inward approve error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/inward/reject', async (req, res) => {
  try {
    const { id, rejectedBy, reason } = req.body;
    if (!id) return res.status(400).json({ success: false, error: 'Capture ID is required.' });
    await rejectInwardCapture(id, rejectedBy || 'Admin', reason);
    res.json({ success: true, message: `Inward capture #${id} rejected and excluded from inventory.` });
  } catch (err) {
    console.error('[API] inward reject error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Warehouse Locations API ──────────────────────────────────────────────────
app.get('/api/warehouse-locations', async (req, res) => {
  try {
    const rows = await getAllWarehouseLocations();
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('[API] warehouse-locations GET error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/warehouse-locations', async (req, res) => {
  try {
    const loc = await createWarehouseLocation(req.body);
    res.json({ success: true, data: loc, message: 'Warehouse location saved successfully.' });
  } catch (err) {
    console.error('[API] warehouse-locations POST error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/warehouse-locations/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await deleteWarehouseLocation(id);
    res.json({ success: true, message: `Warehouse location #${id} deleted successfully.` });
  } catch (err) {
    console.error('[API] warehouse-locations DELETE error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/warehouse-locations', async (req, res) => {
  try {
    await clearAllWarehouseLocations();
    res.json({ success: true, message: 'All warehouse locations cleared successfully.' });
  } catch (err) {
    console.error('[API] warehouse-locations clear error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/warehouse-locations/bulk', async (req, res) => {
  try {
    const locations = Array.isArray(req.body) ? req.body : (req.body.locations || []);
    const count = await bulkSaveWarehouseLocations(locations);
    res.json({ success: true, count, message: `Successfully saved ${count} warehouse locations.` });
  } catch (err) {
    console.error('[API] warehouse-locations bulk POST error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Global error handling middleware for express
app.use((err, req, res, next) => {
  console.error('[API Global Error Handler]:', err.message || err);
  if (res.headersSent) {
    return next(err);
  }
  res.status(err.status || 500).json({
    success: false,
    error: err.message || 'Internal Server Error'
  });
});

// Serve static assets in production (if built) or redirect to Vite dev server in dev
const distPath = path.join(__dirname, '../frontend/dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) {
      return res.status(404).json({ error: 'API route not found' });
    }
    res.sendFile(path.join(distPath, 'index.html'));
  });
} else {
  // In development mode, auto-redirect browser page requests to Vite dev server (port 5173)
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) {
      return res.status(404).json({ error: 'API route not found' });
    }
    const host = req.hostname || 'localhost';
    return res.redirect(`http://${host}:5173${req.originalUrl}`);
  });
}


// Start Server
const server = app.listen(PORT, () => {
  console.log(`G-PDMS Auth Server running on http://localhost:${PORT}`);

  // ── Auto Keep-Alive Heartbeat (Every 1 Minute) ─────────────────────────────
  // Pings /api/health and refreshes DB pool to prevent cloud server sleep mode
  const KEEP_ALIVE_INTERVAL_MS = 60 * 1000; // Exactly every 1 minute

  const runKeepAliveHealthCheck = async () => {
    const timestamp = new Date().toLocaleTimeString('en-GB');
    let dbLatency = 0;
    try {
      const dbStart = Date.now();
      await pool.query('SELECT 1');
      dbLatency = Date.now() - dbStart;
    } catch (dbErr) {
      console.warn(`[Keep-Alive Heartbeat] ⚠️ DB ping warning: ${dbErr.message}`);
    }

    // Ping localhost and external URLs if defined
    const endpointsToPing = [`http://127.0.0.1:${PORT}/api/health`];
    const externalUrl = process.env.RENDER_EXTERNAL_URL || process.env.BACKEND_URL || process.env.SERVER_URL || process.env.PUBLIC_BACKEND_URL;
    if (externalUrl) {
      const cleanUrl = externalUrl.replace(/\/+$/, '');
      if (!cleanUrl.includes('127.0.0.1') && !cleanUrl.includes('localhost')) {
        endpointsToPing.push(`${cleanUrl}/api/health`);
      }
    }

    for (const url of endpointsToPing) {
      try {
        const res = await fetch(url, {
          method: 'GET',
          headers: { 'User-Agent': 'G-PDMS-KeepAlive-Worker/1.0' }
        });
        if (res.ok) {
          console.log(`[Keep-Alive Heartbeat] 💚 ${timestamp} - Health OK (${url}) | DB Latency: ${dbLatency}ms | Uptime: ${Math.floor(process.uptime())}s`);
        } else {
          console.warn(`[Keep-Alive Heartbeat] ⚠️ ${timestamp} - Response status ${res.status} from ${url}`);
        }
      } catch (fetchErr) {
        // Log brief notice without crashing
        console.log(`[Keep-Alive Heartbeat] 💚 ${timestamp} - Local DB Pool Active | Latency: ${dbLatency}ms | Ping note: ${fetchErr.message}`);
      }
    }
  };

  // Initial keep-alive check after 5 seconds
  setTimeout(runKeepAliveHealthCheck, 5000);

  // Recurring keep-alive every 1 minute (60 seconds)
  setInterval(runKeepAliveHealthCheck, KEEP_ALIVE_INTERVAL_MS);

  // Background Auto-Sync Google Sheets to Database on startup
  setTimeout(() => {
    console.log('[Incremental Sync Worker] Initiating startup Google Sheets synchronization to MySQL database...');
    syncGoogleSheetsToDb(false).catch(err => console.warn('[Incremental Sync Worker] Startup sync warning:', err.message));
  }, 2000);

  // Dedicated Incremental Sync Background Worker every 30 seconds
  setInterval(() => {
    syncGoogleSheetsToDb(false).catch(err => console.warn('[Incremental Sync Worker] Sync warning:', err.message));
  }, 30 * 1000);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n[ERROR] Port ${PORT} is already in use.`);
    console.error(`To kill the old process, run in PowerShell:\n`);
    console.error(`    Stop-Process -Id (Get-NetTCPConnection -LocalPort ${PORT}).OwningProcess -Force\n`);
  } else {
    console.error('[Server Error]', err.message);
  }
});


