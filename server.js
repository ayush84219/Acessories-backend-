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
  getMaterialById,
  upsertMaterial,
  deleteMaterial,
  searchDirectSql,
  getSearchSuggestionsSql,
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
  getSearchableDesigns,
  getSearchableCuttingHeaders,
  getAllDooriOrders,
  getDooriByLotOrPo,
  getZipByLotOrPo,
  updateCuttingHeaderPayload,
  updateDooriPayload,
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
  updateWarehouseLocation,
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
import cloudinary from './config/cloudinary.js';

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

// Automatic cache size management configurations (tuned for 512MB RAM cloud environments)
const MAX_CACHE_SIZE = 50 * 1024 * 1024; // 50 MB limit
const TARGET_CACHE_SIZE = 25 * 1024 * 1024; // Clean down to 25 MB

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


// Process-level resilience: Prevent sudden crashes from unhandled asynchronous errors
process.on('uncaughtException', (err) => {
  console.error('[CRITICAL UNCAUGHT EXCEPTION]', err.stack || err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('[UNHANDLED PROMISE REJECTION]', reason);
});

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_gpdms_key_for_jwt_session_validation_2026';

// ── Production Security & Performance Headers Middleware ────────────────────
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  const startTime = performance.now();
  res.on('finish', () => {
    const duration = (performance.now() - startTime).toFixed(2);
    metricsTracker.recordRequest(req.method, req.path, res.statusCode, duration);
  });
  next();
});

// High-speed compression with optimal threshold
app.use(cors());
app.use(compression({
  threshold: 1024, // only compress responses > 1KB
  filter: (req, res) => {
    if (req.headers['x-no-compression']) return false;
    return compression.filter(req, res);
  }
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// ── In-Memory APM Metrics Tracker ───────────────────────────────────────────
const metricsTracker = {
  totalRequests: 0,
  statusCodes: {},
  slowRequests: 0,
  totalLatencyMs: 0,
  recordRequest(method, path, status, latencyMs) {
    this.totalRequests++;
    this.statusCodes[status] = (this.statusCodes[status] || 0) + 1;
    this.totalLatencyMs += Number(latencyMs);
    if (Number(latencyMs) > 500) this.slowRequests++;
  },
  getMetrics() {
    const memory = process.memoryUsage();
    return {
      uptimeSeconds: Math.floor(process.uptime()),
      totalRequests: this.totalRequests,
      statusCodes: this.statusCodes,
      slowRequests: this.slowRequests,
      averageLatencyMs: this.totalRequests ? (this.totalLatencyMs / this.totalRequests).toFixed(2) : '0.00',
      memoryUsage: {
        rssMb: (memory.rss / 1024 / 1024).toFixed(2),
        heapUsedMb: (memory.heapUsed / 1024 / 1024).toFixed(2),
        heapTotalMb: (memory.heapTotal / 1024 / 1024).toFixed(2)
      },
      cpuUsage: process.cpuUsage(),
      cacheStats: {
        size: memoryCache.size,
        hits: cacheHits,
        misses: cacheMisses,
        hitRatio: (cacheHits + cacheMisses) > 0 ? ((cacheHits / (cacheHits + cacheMisses)) * 100).toFixed(1) + '%' : '0%'
      }
    };
  }
};

// ── Sliding Window In-Memory Rate Limiter ────────────────────────────────────
const rateLimitMap = new Map();
export function createRateLimiter({ windowMs = 60000, max = 60, message = 'Too many requests. Please try again later.' } = {}) {
  return (req, res, next) => {
    const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    const key = `${ip}_${req.baseUrl || req.path}`;
    const now = Date.now();
    let record = rateLimitMap.get(key);

    if (!record || now > record.resetTime) {
      record = { count: 1, resetTime: now + windowMs };
      rateLimitMap.set(key, record);
    } else {
      record.count += 1;
    }

    if (record.count > max) {
      const retryAfter = Math.ceil((record.resetTime - now) / 1000);
      res.setHeader('Retry-After', retryAfter);
      return res.status(429).json({ error: message, retryAfterSeconds: retryAfter });
    }
    next();
  };
}

// Clean up expired rate limit windows every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of rateLimitMap.entries()) {
    if (now > record.resetTime) rateLimitMap.delete(key);
  }
}, 300000).unref();

// Initialize Database
try {
  await initDb();
  console.log('Database initialized successfully.');
} catch (err) {
  console.error('Database initialization failed:', err.message);
  process.exit(1);
}

// ── Lightweight Health & Deep Metrics Endpoints ──────────────────────────────
app.get('/api/ping', (req, res) => res.status(200).send('pong'));

app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.status(200).json({
      status: 'UP',
      uptimeSeconds: Math.floor(process.uptime()),
      db: 'connected'
    });
  } catch (err) {
    res.status(503).json({
      status: 'DOWN',
      error: err.message
    });
  }
});

// APM System Metrics
app.get('/api/metrics', (req, res) => {
  res.status(200).json(metricsTracker.getMetrics());
});

// ── In-Memory LRU Micro-Cache (Max 150 items, O(1) eviction for low-RAM containers) ───────────────
const MAX_CACHE_ENTRIES = 150;
const memoryCache = new Map();
let cacheHits = 0;
let cacheMisses = 0;

function getCached(key) {
  const item = memoryCache.get(key);
  if (!item) {
    cacheMisses++;
    return null;
  }
  if (Date.now() > item.expiresAt) {
    memoryCache.delete(key);
    cacheMisses++;
    return null;
  }
  cacheHits++;
  // Refresh position for LRU
  memoryCache.delete(key);
  memoryCache.set(key, item);
  return item.data;
}

function setCached(key, data, ttlMs = 30000) {
  if (memoryCache.size >= MAX_CACHE_ENTRIES) {
    // Evict oldest entry
    const oldestKey = memoryCache.keys().next().value;
    if (oldestKey) memoryCache.delete(oldestKey);
  }
  memoryCache.set(key, {
    data,
    expiresAt: Date.now() + ttlMs
  });
}

function invalidateCache(prefix) {
  if (!prefix) {
    memoryCache.clear();
    return;
  }
  for (const key of memoryCache.keys()) {
    if (key.startsWith(prefix)) {
      memoryCache.delete(key);
    }
  }
}

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

// JWT Authentication Middleware (12-hour session expiration)
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ error: 'Access token required.' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({
          error: 'Your 12-hour session has expired. Please log in again to secure your application.',
          code: 'TOKEN_EXPIRED',
          expired: true
        });
      }
      return res.status(403).json({ error: 'Token is invalid or unauthorized.' });
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

    // Sign JWT (Enforce 12-hour tokenization for application security)
    const token = jwt.sign(
      { id: user.id, name: user.name, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: '12h' }
    );

    const expiresInSeconds = 12 * 60 * 60; // 12 hours (43200 seconds)
    const expiresAt = Date.now() + expiresInSeconds * 1000;

    res.status(200).json({
      message: 'Login successful!',
      token,
      expiresIn: expiresInSeconds,
      expiresAt,
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
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes TTL

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

// Paths for dedicated caches
const MAIN_SHEET_CSV_CACHE_PATH = path.join(CACHE_DIR, 'main_sheet_lots_gid0.csv');
const CUTTING_SHEET_CSV_CACHE_PATH = path.join(CACHE_DIR, 'cutting_sheet_lots_gid1964871106.csv');
const CUTTING_MATRIX_CSV_CACHE_PATH = path.join(CACHE_DIR, 'cutting_matrix_gid0.csv');

let lastMainFetchTime = 0;
let lastCuttingFetchTime = 0;

export function getMainSheetUrl() {
  const mainId = process.env.GOOGLE_SHEET_ID || '1fKSwGBIpzWEFk566WRQ4bzQ0anJlmasoY8TwrTLQHXI';
  if (process.env.GOOGLE_SHEET_URL && String(process.env.GOOGLE_SHEET_URL).trim()) {
    return parseGoogleSheetUrl(process.env.GOOGLE_SHEET_URL);
  }
  return `https://docs.google.com/spreadsheets/d/${String(mainId).trim()}/export?format=csv&gid=0`;
}

export function getCuttingSheetUrl() {
  const cutId = process.env.CUTTING_GOOGLE_SHEET_ID || '1Hj3JeJEKB43aYYWv8gk2UhdU6BWuEQfCg5pBlTdBMNA';
  if (process.env.CUTTING_GOOGLE_SHEET_URL && String(process.env.CUTTING_GOOGLE_SHEET_URL).trim()) {
    return parseGoogleSheetUrl(process.env.CUTTING_GOOGLE_SHEET_URL);
  }
  return `https://docs.google.com/spreadsheets/d/${String(cutId).trim()}/export?format=csv&gid=1964871106`;
}

export function getCuttingSheetId() {
  const raw = process.env.CUTTING_GOOGLE_SHEET_ID || process.env.CUTTING_GOOGLE_SHEET_URL || '1Hj3JeJEKB43aYYWv8gk2UhdU6BWuEQfCg5pBlTdBMNA';
  const dMatch = String(raw).match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (dMatch && dMatch[1]) return dMatch[1];
  const clean = String(raw).trim();
  if (clean && !clean.includes('/')) return clean;
  return '1Hj3JeJEKB43aYYWv8gk2UhdU6BWuEQfCg5pBlTdBMNA';
}

// 1. Fetch Main Google Sheet (Used exclusively for Below of Material / Garment Design)
export async function getMainLotsCSV(force = false) {
  const url = getMainSheetUrl();
  const now = Date.now();
  const cacheExists = fs.existsSync(MAIN_SHEET_CSV_CACHE_PATH);

  if (!force && cacheExists && (now - lastMainFetchTime < CACHE_TTL_MS)) {
    return fs.readFileSync(MAIN_SHEET_CSV_CACHE_PATH, 'utf8');
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (response.ok) {
      const csvText = await response.text();
      fs.writeFileSync(MAIN_SHEET_CSV_CACHE_PATH, csvText, 'utf8');
      lastMainFetchTime = now;
      return csvText;
    }
  } catch (err) {
    console.warn('[Main Sheet Loader] Fetch error:', err.message);
  }

  if (cacheExists) {
    return fs.readFileSync(MAIN_SHEET_CSV_CACHE_PATH, 'utf8');
  }
  return '';
}

// 2. Fetch Cutting Google Sheet (Used exclusively for Only Cutting / Cutting Matrix)
export async function getCuttingLotsCSV(force = false) {
  const url = getCuttingSheetUrl();
  const now = Date.now();
  const cacheExists = fs.existsSync(CUTTING_SHEET_CSV_CACHE_PATH);

  if (!force && cacheExists && (now - lastCuttingFetchTime < CACHE_TTL_MS)) {
    return fs.readFileSync(CUTTING_SHEET_CSV_CACHE_PATH, 'utf8');
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (response.ok) {
      const csvText = await response.text();
      fs.writeFileSync(CUTTING_SHEET_CSV_CACHE_PATH, csvText, 'utf8');
      lastCuttingFetchTime = now;
      return csvText;
    }
  } catch (err) {
    console.warn('[Cutting Sheet Loader] Fetch error:', err.message);
  }

  if (cacheExists) {
    return fs.readFileSync(CUTTING_SHEET_CSV_CACHE_PATH, 'utf8');
  }
  return '';
}

// Backward compatibility alias for general lots fetch (defaults to Main Sheet)
export async function getLotsCSV(force = false) {
  return getMainLotsCSV(force);
}

// Helper to fetch the actual Cutting matrix sheet (gid=0)
async function getCuttingMatrixBlocksCSV(force = false) {
  const sheetId = getCuttingSheetId();
  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=0`;
  const now = Date.now();
  const cacheExists = fs.existsSync(CUTTING_MATRIX_CSV_CACHE_PATH);

  if (!force && cacheExists && (now - lastFetchTime < CACHE_TTL_MS)) {
    return fs.readFileSync(CUTTING_MATRIX_CSV_CACHE_PATH, 'utf8');
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (response.ok) {
      const csvText = await response.text();
      fs.writeFileSync(CUTTING_MATRIX_CSV_CACHE_PATH, csvText, 'utf8');
      return csvText;
    }
  } catch (err) {
    console.warn('[Matrix Loader] Warning fetching gid=0 matrix sheet:', err.message);
  }

  if (cacheExists) {
    return fs.readFileSync(CUTTING_MATRIX_CSV_CACHE_PATH, 'utf8');
  }
  return '';
}

// Direct parser for all Cutting Matrix blocks from gid=0
function parseCuttingMatrixBlocks(csvText) {
  if (!csvText) return new Map();
  const lines = csvText.split('\n');
  const lotMatrixMap = new Map();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes('Cutting Matrix')) {
      const lotMatch = line.match(/Cutting Matrix\s*[-—]\s*Lot\s*([A-Za-z0-9_-]+)/i);
      if (!lotMatch) continue;
      const lotNo = lotMatch[1].trim();
      let idx = i + 1;

      let style = '';
      let fabric = '';
      let garmentType = '';

      if (idx < lines.length && lines[idx].includes('Lot Number:')) {
        const parts = lines[idx].split(',');
        style = parts[3] ? parts[3].trim() : '';
        idx++;
      }
      if (idx < lines.length && lines[idx].includes('Fabric:')) {
        const parts = lines[idx].split(',');
        fabric = parts[1] ? parts[1].trim() : '';
        garmentType = parts[3] ? parts[3].trim() : '';
        idx++;
      }

      while (idx < lines.length && !lines[idx].toLowerCase().startsWith('color')) {
        idx++;
      }
      if (idx >= lines.length) continue;

      const colHeader = lines[idx].split(',').map(c => c.trim().toUpperCase());
      const colIdx = {
        color: colHeader.indexOf('COLOR'),
        table: colHeader.indexOf('CUTTING TABLE'),
        m: colHeader.indexOf('M'),
        l: colHeader.indexOf('L'),
        xl: colHeader.indexOf('XL'),
        xxl: colHeader.indexOf('XXL'),
        total: colHeader.indexOf('TOTAL PCS')
      };
      idx++;

      const matrixRows = [];
      while (idx < lines.length) {
        const rowLine = lines[idx].trim();
        if (!rowLine || rowLine.startsWith('Cutting Matrix')) break;
        const cols = lines[idx].split(',').map(c => c.trim());
        const colorVal = cols[colIdx.color >= 0 ? colIdx.color : 0] || '';
        if (colorVal.toLowerCase() === 'total' || !colorVal) {
          break;
        }
        const tableVal = parseInt(cols[colIdx.table >= 0 ? colIdx.table : 1], 10) || 1;
        const mVal = colIdx.m >= 0 ? parseInt(cols[colIdx.m], 10) || 0 : 0;
        const lVal = colIdx.l >= 0 ? parseInt(cols[colIdx.l], 10) || 0 : 0;
        const xlVal = colIdx.xl >= 0 ? parseInt(cols[colIdx.xl], 10) || 0 : 0;
        const xxlVal = colIdx.xxl >= 0 ? parseInt(cols[colIdx.xxl], 10) || 0 : 0;
        const totalVal = colIdx.total >= 0 ? parseInt(cols[colIdx.total], 10) || (mVal + lVal + xlVal + xxlVal) : (mVal + lVal + xlVal + xxlVal);

        matrixRows.push({
          color: colorVal,
          cuttingTable: tableVal,
          sizes: { M: mVal, L: lVal, XL: xlVal, XXL: xxlVal },
          totalPcs: totalVal
        });
        idx++;
      }

      if (matrixRows.length > 0) {
        lotMatrixMap.set(lotNo.toLowerCase(), {
          lotNo,
          style,
          fabric,
          garmentType,
          matrix: matrixRows
        });
      }
    }
  }
  return lotMatrixMap;
}

// Upload image route (Cloudinary)
app.post('/api/upload-cloudinary-image', async (req, res) => {
  try {
    const { base64, folder } = req.body;
    if (!base64) return res.status(400).json({ error: 'No image data provided' });

    const uploadResponse = await cloudinary.uploader.upload(base64, {
      folder: folder || 'accessories_uploads',
      resource_type: 'image'
    });

    res.json({
      success: true,
      url: uploadResponse.secure_url,
      public_id: uploadResponse.public_id
    });
  } catch (err) {
    console.error('[Cloudinary Upload Error]:', err.message);
    res.status(500).json({ error: err.message || 'Failed to upload to Cloudinary' });
  }
});

// Upload image route (Google Drive fallback)
app.post('/api/upload-drive-image', async (req, res) => {
  try {
    const { base64, fileName, mimeType } = req.body;
    if (!base64) return res.status(400).json({ error: 'No image data provided' });

    const scriptUrl = process.env.GOOGLE_DRIVE_SCRIPT_URL;
    const response = await fetch(scriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ base64, fileName, mimeType })
    });

    const result = await response.json();
    if (result.success) {
      // Save result.url to MySQL database instead of the large base64 string
      res.json({ success: true, url: result.url });
    } else {
      res.status(500).json({ error: result.error });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


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
async function batchEnsureCuttingsMatrix(items, lotMatrixMap = null) {
  if (!items || items.length === 0) return;

  const standardSizes = ['M', 'L', 'XL', 'XXL'];
  const matrixValues = [];
  const headerIdsToClear = [];

  for (const item of items) {
    const { headerId, lotNo, shadesStr, sizesStr, totalQty, challanHistory, cuttingTable } = item;
    if (!headerId) continue;
    headerIdsToClear.push(headerId);

    const lotKey = (lotNo || '').toLowerCase().trim();
    if (lotMatrixMap && lotMatrixMap.has(lotKey)) {
      const directBlock = lotMatrixMap.get(lotKey);
      for (const mRow of directBlock.matrix) {
        matrixValues.push([
          headerId,
          lotNo || '',
          mRow.color,
          mRow.cuttingTable || 6,
          mRow.sizes?.M || 0,
          mRow.sizes?.L || 0,
          mRow.sizes?.XL || 0,
          mRow.sizes?.XXL || 0,
          mRow.totalPcs || 0
        ]);
      }
      continue;
    }

    const tableNo = parseInt(cuttingTable, 10) || 6;

    // 1. Try to extract item breakdowns from challanHistory JSON
    let breakdownItems = [];
    if (challanHistory) {
      try {
        const parsedHistory = typeof challanHistory === 'string' ? JSON.parse(challanHistory) : challanHistory;
        if (Array.isArray(parsedHistory)) {
          for (const entry of parsedHistory) {
            if (entry && Array.isArray(entry.items) && entry.items.length > 0) {
              breakdownItems = entry.items.map(it => ({
                color: it.shade || it.color || '',
                qty: parseInt(it.qty || it.quantity || 0, 10)
              })).filter(it => it.color && it.qty > 0);
              if (breakdownItems.length > 0) break;
            }
          }
        }
      } catch (e) { }
    }

    // 2. If no items from challanHistory, parse from shadesStr
    if (breakdownItems.length === 0) {
      const rawShades = (shadesStr || 'Standard')
        .split(/[,/;\r\n]+/)
        .map(s => s.trim())
        .filter(s => s.length > 0 && !s.toLowerCase().includes('total'));

      const parsedShades = rawShades.map(s => {
        const qtyMatch = s.match(/\[(\d+)\]|\((\d+)\)/);
        const count = qtyMatch ? parseInt(qtyMatch[1] || qtyMatch[2], 10) : 1;
        return { color: s, count };
      });

      const uniqueShades = parsedShades.filter(s => s.color.length > 0);
      if (uniqueShades.length === 0) uniqueShades.push({ color: 'Standard', count: 1 });

      const total = parseInt(totalQty, 10) || uniqueShades.length;
      const totalRatio = uniqueShades.reduce((sum, s) => sum + s.count, 0) || uniqueShades.length;

      breakdownItems = uniqueShades.map(s => ({
        color: s.color,
        qty: Math.max(1, Math.round(total * (s.count / totalRatio)))
      }));
    }

    // 3. Parse active sizes
    const rawSizes = (sizesStr || 'M, L, XL, XXL')
      .split(/[,/;\r\n]+/)
      .map(s => s.trim().toUpperCase())
      .filter(s => s.length > 0);

    const activeSizes = rawSizes.length > 0 ? rawSizes : standardSizes;

    let sizeWeights = {};
    const sizeKeys = activeSizes.join(',');
    if (sizeKeys === 'M,L,XL') {
      sizeWeights = { 'M': 2, 'L': 2, 'XL': 1 };
    } else if (sizeKeys === 'S,M,L,XL') {
      sizeWeights = { 'S': 1, 'M': 2, 'L': 2, 'XL': 1 };
    } else {
      activeSizes.forEach(sz => { sizeWeights[sz] = 1; });
    }
    const totalWeight = activeSizes.reduce((sum, sz) => sum + (sizeWeights[sz] || 1), 0);

    for (const bItem of breakdownItems) {
      const sizeMap = {};
      const itemQty = bItem.qty;

      if (activeSizes.length === 1) {
        sizeMap[activeSizes[0]] = itemQty;
      } else {
        let distributedSum = 0;
        activeSizes.forEach((sz, sIdx) => {
          if (sIdx === activeSizes.length - 1) {
            sizeMap[sz] = Math.max(0, itemQty - distributedSum);
          } else {
            const w = sizeWeights[sz] || 1;
            const szQty = Math.round(itemQty * (w / totalWeight));
            sizeMap[sz] = szQty;
            distributedSum += szQty;
          }
        });
      }

      standardSizes.forEach(sz => {
        if (sizeMap[sz] === undefined) sizeMap[sz] = 0;
      });

      matrixValues.push([
        headerId,
        lotNo || '',
        bItem.color,
        tableNo,
        sizeMap['M'] || 0,
        sizeMap['L'] || 0,
        sizeMap['XL'] || 0,
        sizeMap['XXL'] || 0,
        itemQty
      ]);
    }
  }

  if (matrixValues.length === 0) return;

  // Clear existing matrix rows for these headers to prevent duplicate data
  if (headerIdsToClear.length > 0) {
    for (let i = 0; i < headerIdsToClear.length; i += 100) {
      const idChunk = headerIdsToClear.slice(i, i + 100);
      const placeholders = idChunk.map(() => '?').join(', ');
      await pool.execute(`DELETE FROM cuttings_matrix WHERE header_id IN (${placeholders})`, idChunk).catch(() => { });
    }
  }

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

// Helper to ensure cutting tables exist in MySQL
export async function ensureCuttingTablesExist() {
  try {
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
  } catch (err) {
    console.warn('[DB] Warning ensuring cutting tables:', err.message);
  }
}

// Reusable function to synchronize Google Sheets lots into MySQL database in batch (<300ms)
export async function syncGoogleSheetsToDb(force = false) {
  const syncStartTime = Date.now();
  try {
    await ensureCuttingTablesExist();
    const [csvText, matrixCsvText] = await Promise.all([
      getCuttingLotsCSV(force),
      getCuttingMatrixBlocksCSV(force).catch(() => '')
    ]);

    if (!csvText) {
      console.warn('[Sync] No CSV text retrieved from Google Sheets.');
      return { success: false, error: 'Failed to download Google Sheet CSV.' };
    }

    const lotMatrixMap = parseCuttingMatrixBlocks(matrixCsvText);

    const currentHash = crypto.createHash('md5').update(csvText + matrixCsvText).digest('hex');
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

    // Cutoff date for cutting reports: Only ingest/process data on or after 1 June 2026
    const CUTTING_DATA_CUTOFF_DATE = new Date('2026-06-01T00:00:00.000Z');

    function isCuttingLotOnOrAfterJune1(row) {
      if (!row) return false;
      const dateCandidates = [
        row['Saved At'],
        row['Saved_At'],
        row['SavedAt'],
        row['Date of Issue'],
        row['Date_of_Issue'],
        row['JobOrder Date'],
        row['JobOrder_Date'],
        row['ZIP ORDER DATE'],
        row['Zip_Order_Date']
      ];

      for (const raw of dateCandidates) {
        if (!raw || typeof raw !== 'string') continue;
        const str = raw.trim();
        if (!str) continue;

        const d = new Date(str);
        if (!isNaN(d.getTime()) && d.getFullYear() > 2000) {
          return d >= CUTTING_DATA_CUTOFF_DATE;
        }

        const dmyMatch = str.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
        if (dmyMatch) {
          const day = parseInt(dmyMatch[1], 10);
          const month = parseInt(dmyMatch[2], 10) - 1;
          const year = parseInt(dmyMatch[3], 10);
          const parsed = new Date(year, month, day);
          if (!isNaN(parsed.getTime())) {
            return parsed >= CUTTING_DATA_CUTOFF_DATE;
          }
        }
      }
      return true;
    }

    // Filter valid rows & de-duplicate by lot number (skipping records prior to 1 June 2026)
    const validRowsMap = new Map();
    for (const r of rows) {
      const rawLot = r['Lot Number'] || r['Lot No'] || r['Job Order No'];
      if (!rawLot || !rawLot.trim()) continue;
      const trimmedLot = rawLot.trim().substring(0, 100);
      if (trimmedLot.length > 50 || trimmedLot.toLowerCase().includes('total') || trimmedLot.toLowerCase().includes('summary')) {
        continue;
      }
      // Performance optimization: skip old cutting lots prior to 1 June 2026
      if (!isCuttingLotOnOrAfterJune1(r)) {
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

    // Step 1.5: Auto-Prune obsolete or non-cutting lots (e.g. from previous Main Sheet sync)
    const validLotSet = new Set(uniqueRows.map(r => r._cleanLot.toLowerCase()));
    const obsoleteLots = [];
    for (const row of existingRows) {
      if (row.lot_key && !validLotSet.has(row.lot_key)) {
        obsoleteLots.push(row.lot_key);
      }
    }
    if (obsoleteLots.length > 0) {
      for (let i = 0; i < obsoleteLots.length; i += 100) {
        const chunk = obsoleteLots.slice(i, i + 100);
        const placeholders = chunk.map(() => '?').join(', ');
        await pool.execute(`DELETE FROM cuttings_matrix WHERE LOWER(TRIM(Lot_No)) IN (${placeholders})`, chunk).catch(() => null);
        await pool.execute(`DELETE FROM cutting_header WHERE LOWER(TRIM(Lot_Number)) IN (${placeholders})`, chunk).catch(() => null);
      }
      console.log(`[Sync] Automatically pruned ${obsoleteLots.length} obsolete / non-cutting lots from DB.`);
    }

    const toInsert = [];
    const toUpdate = [];

    for (const r of uniqueRows) {
      const key = r._cleanLot.toLowerCase();
      if (existingMap.has(key) && !obsoleteLots.includes(key)) {
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
        const placeholders = chunk.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
        const flatParams = [];

        chunk.forEach(r => {
          const rowImg = extractRowImageUrl(r);
          flatParams.push(
            r._cleanLot,
            parseInt(r['StartRow'], 10) || 0,
            parseInt(r['NumRows'], 10) || 0,
            parseInt(r['HeaderCols'], 10) || 6,
            (r['Fabric'] || '').substring(0, 255),
            (r['Garment Type'] || r['Garment_Type'] || '').substring(0, 255),
            (r['Style'] || '').substring(0, 255),
            (r['Sizes'] || r['Size'] || '').substring(0, 255),
            r['Shades'] || r['Shade'] || '',
            (r['Saved At'] || r['Saved_At'] || new Date().toISOString()).substring(0, 255),
            (r['Date of Issue'] || r['Date_of_Issue'] || r['JobOrder Date'] || r['Date'] || '').substring(0, 100),
            (r['Supervisor'] || r['Submitted By'] || '').substring(0, 255),
            (r['PARTY NAME'] || r['Party Name'] || r['Party_Name'] || '').substring(0, 255),
            (r['BRAND'] || r['Brand'] || '').substring(0, 255),
            (r['SEASON'] || r['Season'] || '').substring(0, 100),
            (r['DIRECT STITCHING'] || r['Direct Stitching'] || '').substring(0, 100),
            r['CHALLAN HISTORY'] || r['Challan History'] || '',
            (r['ZIP ORDER DATE'] || r['Zip Order Date'] || '').substring(0, 100),
            (r['ZIP RECEIVED DATE'] || r['Zip Received Date'] || '').substring(0, 100),
            r['WIP Status'] || '',
            r['Completed Status'] || '',
            (r['M/W/K'] || r['MWK'] || '').substring(0, 255),
            (r['JobOrder Date'] || r['JobOrder_Date'] || '').substring(0, 100),
            parseInt(r['Manpower'], 10) || 0,
            parseInt(r['Cutting Qty'] || r['Cutting_Qty'] || r['Quantity'] || 0, 10),
            parseInt(r['Stitching Issue Qty'] || 0, 10),
            (r['Prioirty'] || r['Priority'] || 'Normal').substring(0, 50),
            (r['Sticker'] || '').substring(0, 100),
            rowImg.substring(0, 1000),
            null
          );
        });

        await pool.execute(
          `INSERT INTO cutting_header (
            Lot_Number, StartRow, NumRows, HeaderCols, Fabric, Garment_Type, Style, Sizes, Shades, Saved_At,
            Date_of_Issue, Supervisor, Party_Name, Brand, Season, Direct_Stitching, Challan_History,
            Zip_Order_Date, Zip_Received_Date, WIP_Status, Completed_Status, MWK, JobOrder_Date,
            Manpower, Cutting_Qty, Stitching_Issue_Qty, Priority, Sticker, Image_Url, zip_payload
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
              shadesStr: rowObj['Shades'] || rowObj['Shade'] || '',
              sizesStr: rowObj['Sizes'] || rowObj['Size'] || '',
              totalQty: parseInt(rowObj['Cutting Qty'] || rowObj['Cutting_Qty'] || rowObj['Quantity'] || 0, 10),
              challanHistory: rowObj['CHALLAN HISTORY'] || rowObj['Challan History'] || '',
              cuttingTable: parseInt(rowObj['HeaderCols'] || 6, 10)
            });
          }
        });

        await batchEnsureCuttingsMatrix(matrixChunkItems, lotMatrixMap).catch(e => console.warn('[Matrix Batch Warning]:', e.message));
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
                StartRow = COALESCE(NULLIF(?, 0), StartRow),
                NumRows = COALESCE(NULLIF(?, 0), NumRows),
                HeaderCols = COALESCE(NULLIF(?, 0), HeaderCols),
                Fabric = COALESCE(NULLIF(?, ''), Fabric),
                Garment_Type = COALESCE(NULLIF(?, ''), Garment_Type),
                Style = COALESCE(NULLIF(?, ''), Style),
                Sizes = COALESCE(NULLIF(?, ''), Sizes),
                Shades = COALESCE(NULLIF(?, ''), Shades),
                Party_Name = COALESCE(NULLIF(?, ''), Party_Name),
                Brand = COALESCE(NULLIF(?, ''), Brand),
                Season = COALESCE(NULLIF(?, ''), Season),
                Direct_Stitching = COALESCE(NULLIF(?, ''), Direct_Stitching),
                Challan_History = COALESCE(NULLIF(?, ''), Challan_History),
                Date_of_Issue = COALESCE(NULLIF(?, ''), Date_of_Issue),
                Supervisor = COALESCE(NULLIF(?, ''), Supervisor),
                Cutting_Qty = COALESCE(NULLIF(?, 0), Cutting_Qty),
                Priority = COALESCE(NULLIF(?, ''), Priority),
                Image_Url = COALESCE(NULLIF(?, ''), Image_Url)
               WHERE id = ?`,
              [
                parseInt(r['StartRow'], 10) || 0,
                parseInt(r['NumRows'], 10) || 0,
                parseInt(r['HeaderCols'], 10) || 6,
                (r['Fabric'] || '').substring(0, 255),
                (r['Garment Type'] || r['Garment_Type'] || '').substring(0, 255),
                (r['Style'] || '').substring(0, 255),
                (r['Sizes'] || r['Size'] || '').substring(0, 255),
                r['Shades'] || r['Shade'] || '',
                (r['PARTY NAME'] || r['Party Name'] || r['Party_Name'] || '').substring(0, 255),
                (r['BRAND'] || r['Brand'] || '').substring(0, 255),
                (r['SEASON'] || r['Season'] || '').substring(0, 100),
                (r['DIRECT STITCHING'] || r['Direct Stitching'] || '').substring(0, 100),
                r['CHALLAN HISTORY'] || r['Challan History'] || '',
                (r['Date of Issue'] || r['Date_of_Issue'] || r['JobOrder Date'] || r['Date'] || '').substring(0, 100),
                (r['Supervisor'] || r['Submitted By'] || '').substring(0, 255),
                parseInt(r['Cutting Qty'] || r['Cutting_Qty'] || r['Quantity'] || 0, 10),
                (r['Prioirty'] || r['Priority'] || 'Normal').substring(0, 50),
                rowImg.substring(0, 1000),
                id
              ]
            );
          })
        );

        // Update matrix rows for updated chunk
        const updateMatrixItems = chunk.map(({ id, row: r }) => ({
          headerId: id,
          lotNo: r._cleanLot,
          shadesStr: r['Shades'] || r['Shade'] || '',
          sizesStr: r['Sizes'] || r['Size'] || '',
          totalQty: parseInt(r['Cutting Qty'] || r['Cutting_Qty'] || r['Quantity'] || 0, 10),
          challanHistory: r['CHALLAN HISTORY'] || r['Challan History'] || '',
          cuttingTable: parseInt(r['HeaderCols'] || 6, 10)
        }));
        await batchEnsureCuttingsMatrix(updateMatrixItems, lotMatrixMap).catch(e => console.warn('[Matrix Update Warning]:', e.message));

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

    // Step 1: Fetch from MAIN Google Sheet CSV (Primary source for Below of Material / Garment Design)
    try {
      const csvText = await getMainLotsCSV(true);
      if (csvText) {
        const rows = parseCSV(csvText);
        const target = lotNo.toLowerCase().trim();

        // Exact match on Lot Number or Job Order No
        matchedRow = rows.find(row => {
          const rowLot = getCol(row, 'Lot Number', 'Lot No', 'lot').toLowerCase().trim();
          const rowJob = getCol(row, 'Job Order No', 'Order No.', 'JobOrder No', 'Job Order').toLowerCase().trim();
          return (rowLot && rowLot === target) || (rowJob && rowJob === target);
        });
      }
    } catch (csvErr) {
      console.warn(`[Lot Fetch] Main Google Sheet CSV error for ${lotNo}:`, csvErr.message);
    }

    // Step 1.5: If not found in Main Sheet, check Dedicated Cutting Google Sheet as secondary live fallback
    if (!matchedRow) {
      try {
        const cuttingCsvText = await getCuttingLotsCSV(true);
        if (cuttingCsvText) {
          const cuttingRows = parseCSV(cuttingCsvText);
          const target = lotNo.toLowerCase().trim();
          matchedRow = cuttingRows.find(row => {
            const rowLot = getCol(row, 'Lot Number', 'Lot No', 'lot').toLowerCase().trim();
            const rowJob = getCol(row, 'Job Order No', 'Order No.', 'JobOrder No', 'Job Order').toLowerCase().trim();
            return (rowLot && rowLot === target) || (rowJob && rowJob === target);
          });
          if (matchedRow) {
            console.log(`[Lot Fetch] Found lot "${lotNo}" in Cutting Google Sheet.`);
          }
        }
      } catch (cutCsvErr) {
        console.warn(`[Lot Fetch] Cutting Sheet fallback warning:`, cutCsvErr.message);
      }
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
                getCol(matchedRow, 'Garment Type', 'Garment_Type', 'Component').substring(0, 255),
                getCol(matchedRow, 'Style').substring(0, 255),
                getCol(matchedRow, 'Size', 'Sizes').substring(0, 255),
                getCol(matchedRow, 'Shade', 'Shades'),
                new Date().toISOString(),
                getCol(matchedRow, 'Date', 'Date of Issue').substring(0, 100),
                getCol(matchedRow, 'Submitted By', 'Supervisor', 'FABRIC_SUPERVISOR').substring(0, 255),
                getCol(matchedRow, 'Party Name', 'Party_Name').substring(0, 255),
                getCol(matchedRow, 'Brand').substring(0, 255),
                getCol(matchedRow, 'Season').substring(0, 100),
                getCol(matchedRow, 'Direct Stitching').substring(0, 100),
                parseInt(getCol(matchedRow, 'Challan Total Qty', 'Quantity', 'Cutting_Qty')) || 0,
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
              totalQty: getCol(matchedRow, 'Challan Total Qty', 'Quantity', 'Cutting_Qty')
            }]).catch(() => { });
          }
        } catch (dbSaveErr) {
          console.warn('[Lot Fetch] Auto-save to DB warning:', dbSaveErr.message);
        }
      })();

      const primaryLot = getCol(matchedRow, 'Lot Number', 'Lot No', 'Job Order No', 'lot') || lotNo;
      const jobOrderNo = getCol(matchedRow, 'Job Order No', 'Order No.');

      return res.status(200).json({
        lotNo: primaryLot,
        lotNo2: jobOrderNo || primaryLot,
        fabric: getCol(matchedRow, 'Fabric'),
        brand: getCol(matchedRow, 'Brand'),
        garmentType: getCol(matchedRow, 'Garment Type', 'Garment_Type', 'Component'),
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
        quantity: parseInt(getCol(matchedRow, 'Challan Total Qty', 'Quantity', 'Cutting_Qty')) || 100,
        unit: getCol(matchedRow, 'Unit') || 'Pcs',
        partyName: getCol(matchedRow, 'Party Name', 'Party_Name'),
        emb: getCol(matchedRow, 'Emb'),
        embDetails: getCol(matchedRow, 'Emb Details'),
        printing: getCol(matchedRow, 'Printing'),
        printingDetails: getCol(matchedRow, 'Printing Details'),
        pattern: getCol(matchedRow, 'Pattern'),
        remarks: getCol(matchedRow, 'Remarks'),
        directStitching: getCol(matchedRow, 'Direct Stitching'),
        submittedBy: getCol(matchedRow, 'Submitted By', 'Supervisor', 'FABRIC_SUPERVISOR'),
        imageUrl: rowImg,
        priority: getCol(matchedRow, 'Priority') || 'Normal',
        status: getCol(matchedRow, 'Status'),
        source: 'google_sheet',
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
    const force = req.body?.force === true;
    const result = await syncGoogleSheetsToDb(force);
    if (!result.success) {
      return res.status(500).json({ error: result.error || 'Failed to sync Google Sheets' });
    }
    res.status(200).json(result);
  } catch (err) {
    console.error('[Sync] Error syncing Google Sheets to DB:', err.message);
    res.status(500).json({ error: 'Sync failed: ' + err.message });
  }
});

// GET /api/sheet-config: Returns current active Google Sheet URL
app.get('/api/sheet-config', (req, res) => {
  try {
    const url = getActiveSheetUrl();
    let updatedAt = null;
    if (fs.existsSync(SHEET_CONFIG_PATH)) {
      try {
        const data = JSON.parse(fs.readFileSync(SHEET_CONFIG_PATH, 'utf8'));
        updatedAt = data.updatedAt;
      } catch (_) { }
    }
    res.json({ success: true, url, updatedAt });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/sheet-config: Update Google Sheet source and optionally sync immediately
app.post('/api/sheet-config', async (req, res) => {
  try {
    const rawInput = req.body.url || req.body.sheetId || req.body.input;
    if (!rawInput || !String(rawInput).trim()) {
      return res.status(400).json({ success: false, error: 'Please provide a valid Google Sheet URL or Sheet ID' });
    }
    const newUrl = setActiveSheetUrl(rawInput);
    const syncNow = req.body.syncNow !== false;
    let syncResult = null;
    if (syncNow) {
      syncResult = await syncGoogleSheetsToDb(true);
    }
    res.json({
      success: true,
      url: newUrl,
      syncResult,
      message: `Google Sheet updated and synced successfully!`
    });
  } catch (err) {
    console.error('Error updating sheet config:', err);
    res.status(500).json({ success: false, error: err.message });
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

// 7.2.1 Consolidated Lot-Wise Operations & Process Summary Report
app.get('/api/reports/lot-wise-summary', async (req, res) => {
  try {
    const [
      cuttingRows,
      designRows,
      rgpRows,
      dooriRows,
      zipRows,
      poRows,
      extraRows,
      issueRows,
      scanRows,
      weightRows
    ] = await Promise.all([
      pool.execute('SELECT * FROM cutting_header').then(r => r[0]).catch(() => []),
      pool.execute('SELECT * FROM designs').then(r => r[0]).catch(() => []),
      pool.execute('SELECT * FROM rgp ORDER BY id DESC').then(r => r[0]).catch(() => []),
      pool.execute('SELECT * FROM doori ORDER BY id DESC').then(r => r[0]).catch(() => []),
      pool.execute('SELECT * FROM zip ORDER BY id DESC').then(r => r[0]).catch(() => []),
      pool.execute('SELECT * FROM purchase_orders ORDER BY id DESC').then(r => r[0]).catch(() => []),
      pool.execute('SELECT * FROM extra_material_issues ORDER BY id DESC').then(r => r[0]).catch(() => []),
      pool.execute('SELECT * FROM issue_logs ORDER BY id DESC').then(r => r[0]).catch(() => []),
      pool.execute('SELECT * FROM scans ORDER BY id DESC').then(r => r[0]).catch(() => []),
      pool.execute('SELECT * FROM weight_capture ORDER BY id DESC').then(r => r[0]).catch(() => [])
    ]);

    // Parse RGP entries safely
    const parsedRgps = rgpRows.map(r => {
      let entries = [];
      try {
        if (Array.isArray(r.entries)) entries = r.entries;
        else if (typeof r.entries === 'string') entries = JSON.parse(r.entries || '[]');
      } catch (_) { entries = []; }
      return { ...r, parsedEntries: entries };
    });

    // Collect all unique lot numbers across all modules
    const lotMap = new Map();

    const getOrCreateLot = (rawLot) => {
      if (!rawLot) return null;
      const cleanLot = String(rawLot).trim();
      if (!cleanLot || cleanLot.toLowerCase() === 'manual' || cleanLot.toLowerCase() === 'general') return null;
      const key = cleanLot.toLowerCase();
      if (!lotMap.has(key)) {
        lotMap.set(key, {
          lotNo: cleanLot,
          style: '',
          brand: '',
          fabricType: '',
          targetPieces: 0,
          isRecreated: cleanLot.includes('-V'),
          rgps: [],
          dooriOrders: [],
          zipOrders: [],
          pos: [],
          extraIssues: [],
          issueLogs: [],
          scans: [],
          weightCaptures: [],
          vendors: new Set(),
          materials: []
        });
      }
      return lotMap.get(key);
    };

    // 1. Process Cutting Lots & Designs
    cuttingRows.forEach(c => {
      const lot = getOrCreateLot(c.Lot_No);
      if (lot) {
        lot.style = lot.style || c.Style || '';
        lot.brand = lot.brand || c.Brand || '';
        lot.fabricType = lot.fabricType || c.Fabric_Type || '';
        lot.targetPieces = lot.targetPieces || parseInt(c.Total_Pcs) || 0;
      }
    });

    designRows.forEach(d => {
      const lot = getOrCreateLot(d.id);
      if (lot) {
        lot.style = lot.style || d.style || '';
        lot.brand = lot.brand || d.brand || '';
        lot.fabricType = lot.fabricType || d.fabricType || '';
        lot.targetPieces = lot.targetPieces || parseInt(d.quantity) || 0;
      }
    });

    // 2. Process RGPs (entries contain lot numbers, and rgpNo itself could be a lot reference)
    parsedRgps.forEach(r => {
      const seenLotsForRgp = new Set();
      if (Array.isArray(r.parsedEntries) && r.parsedEntries.length > 0) {
        r.parsedEntries.forEach(entry => {
          const entryLot = entry.lotNo || entry.lot_no || r.rgpNo;
          const lot = getOrCreateLot(entryLot);
          if (lot && !seenLotsForRgp.has(lot.lotNo.toLowerCase())) {
            seenLotsForRgp.add(lot.lotNo.toLowerCase());
            lot.rgps.push(r);
            if (r.vendor) lot.vendors.add(r.vendor);
          }
        });
      } else {
        const lot = getOrCreateLot(r.rgpNo);
        if (lot) {
          lot.rgps.push(r);
          if (r.vendor) lot.vendors.add(r.vendor);
        }
      }
    });

    // 3. Process Dori Orders
    dooriRows.forEach(d => {
      const lot = getOrCreateLot(d.Lot_Number);
      if (lot) {
        lot.dooriOrders.push(d);
        if (d.Supplier_Name || d.Supplier) lot.vendors.add(d.Supplier_Name || d.Supplier);
        lot.style = lot.style || d.Style || '';
      }
    });

    // 4. Process Zip Orders
    zipRows.forEach(z => {
      const lot = getOrCreateLot(z.Lot_Number);
      if (lot) {
        lot.zipOrders.push(z);
        if (z.Supplier_Name || z.Supplier) lot.vendors.add(z.Supplier_Name || z.Supplier);
        lot.style = lot.style || z.Style || z.ch_style || '';
      }
    });

    // 5. Process Purchase Orders
    poRows.forEach(p => {
      const lot = getOrCreateLot(p.designName || p.lotId);
      if (lot) {
        lot.pos.push(p);
        if (p.vendorName) lot.vendors.add(p.vendorName);
      }
    });

    // 6. Process Extra Material Issues
    extraRows.forEach(ex => {
      const lot = getOrCreateLot(ex.lot_no || ex.lot_id || ex.lotId);
      if (lot) {
        lot.extraIssues.push(ex);
        lot.style = lot.style || ex.style || '';
        lot.brand = lot.brand || ex.brand || '';
      }
    });

    // 7. Process Issue Logs
    issueRows.forEach(il => {
      const lot = getOrCreateLot(il.lotId || il.lot_no);
      if (lot) {
        lot.issueLogs.push(il);
      }
    });

    // 8. Process Scans
    scanRows.forEach(s => {
      const lot = getOrCreateLot(s.lot_number);
      if (lot) {
        lot.scans.push(s);
        if (s.supplier_name) lot.vendors.add(s.supplier_name);
      }
    });

    // Also match scans against RGP numbers for lots that have those RGPs
    lotMap.forEach(lot => {
      const rgpNos = new Set(lot.rgps.map(r => String(r.rgpNo).toLowerCase()));
      scanRows.forEach(s => {
        const scanLot = String(s.lot_number || '').trim().toLowerCase();
        if (rgpNos.has(scanLot) && !lot.scans.some(existing => existing.id === s.id)) {
          lot.scans.push(s);
        }
      });
    });

    // 9. Process Weight Captures
    weightRows.forEach(w => {
      const lot = getOrCreateLot(w.lotNo || w.lot_no);
      if (lot) {
        lot.weightCaptures.push(w);
      }
    });

    // Build finalized summaries and completeness calculations
    const summaryList = [];

    for (const lot of lotMap.values()) {
      // Calculate totals
      let totalRgpPcs = 0;
      let totalRgpReturnedPcs = 0;
      let allRgpsReturned = true;

      lot.rgps.forEach(r => {
        const entries = r.parsedEntries || [];
        const qty1 = entries.reduce((sum, e) => {
          if (!e.lotNo || String(e.lotNo).toLowerCase() === lot.lotNo.toLowerCase()) {
            return sum + (parseFloat(e.qty1) || 0);
          }
          return sum;
        }, 0) || (parseFloat(r.qty) || 0);

        totalRgpPcs += qty1;

        // Check return scan
        const isReturned = (r.status || '').toLowerCase() === 'returned' || lot.scans.some(s => 
          (s.scan_type === 'rgp_return') && 
          (String(s.lot_number).toLowerCase() === String(r.rgpNo).toLowerCase() || String(s.lot_number).toLowerCase() === lot.lotNo.toLowerCase())
        );

        if (isReturned) {
          totalRgpReturnedPcs += qty1;
        } else {
          allRgpsReturned = false;
        }
      });

      const totalDoriPcs = lot.dooriOrders.reduce((sum, d) => sum + (parseInt(d.Total_Pieces) || 0), 0);
      const totalZipPcs = lot.zipOrders.reduce((sum, z) => sum + (parseInt(z.Total_Pieces_CH || z.Total_Pieces) || 0), 0);
      const totalPoPcs = lot.pos.reduce((sum, p) => {
        let itms = [];
        try { itms = typeof p.items === 'string' ? JSON.parse(p.items) : (p.items || []); } catch (_) {}
        return sum + itms.reduce((s, it) => s + (parseFloat(it.qty) || 0), 0);
      }, 0);

      const totalExtraPcs = lot.extraIssues.reduce((sum, ex) => {
        let itms = [];
        try { itms = Array.isArray(ex.items) ? ex.items : (typeof ex.items === 'string' ? JSON.parse(ex.items) : []); } catch (_) {}
        return sum + (itms.reduce((s, it) => s + (parseFloat(it.totalRequired || it.qty || it.extraQty) || 0), 0) || parseFloat(ex.pieces) || 0);
      }, 0);

      // Scanners analysis
      const gateEntryScans = lot.scans.filter(s => s.scan_type === 'gate_entry' || s.scan_type === 'supplier_entry');
      const materialInScans = lot.scans.filter(s => s.scan_type === 'material_in');
      const rgpOutScans = lot.scans.filter(s => s.scan_type === 'rgp_entry');
      const rgpInScans = lot.scans.filter(s => s.scan_type === 'rgp_return');
      const printingScans = lot.scans.filter(s => s.scan_type === 'printing_gate_out');

      const totalReceivedPcs = materialInScans.reduce((sum, s) => sum + (parseFloat(s.quantity) || 0), 0);
      const totalGateScannedPcs = gateEntryScans.reduce((sum, s) => sum + (parseFloat(s.quantity) || 0), 0);

      // Material items compilation
      const materialItemsMap = new Map();
      const addMatItem = (name, color, qty, uom, source, meta) => {
        if (!name) return;
        const key = `${name}_${color || ''}_${source}`.toLowerCase();
        if (!materialItemsMap.has(key)) {
          materialItemsMap.set(key, { name, color: color || '—', qty: 0, uom: uom || 'PCS', source, meta: meta || '' });
        }
        materialItemsMap.get(key).qty += parseFloat(qty) || 0;
      };

      lot.rgps.forEach(r => {
        (r.parsedEntries || []).forEach(e => {
          if (!e.lotNo || String(e.lotNo).toLowerCase() === lot.lotNo.toLowerCase()) {
            addMatItem(e.itemDesc || 'Fabric/Trims', '', e.qty1, e.uom || 'PCS', `RGP #${r.rgpNo}`, e.purpose || r.purpose);
          }
        });
      });

      lot.dooriOrders.forEach(d => {
        addMatItem('Dori / Drawstring', '', d.Total_Pieces, 'PCS', `Dori PO #${d.po_number || d.Lot_Number}`, d.Style);
      });

      lot.zipOrders.forEach(z => {
        addMatItem('Zipper Trims', z.Teeth_Color || '', z.Total_Pieces_CH || z.Total_Pieces, 'PCS', `Zip PO #${z.po_number || z.Lot_Number}`, z.Garment_Type);
      });

      lot.pos.forEach(p => {
        let itms = [];
        try { itms = typeof p.items === 'string' ? JSON.parse(p.items) : (p.items || []); } catch (_) {}
        itms.forEach(it => {
          addMatItem(it.name || it.description || 'Trims', it.color || '', it.qty, it.uom || 'PCS', `PO #${p.poNumber}`, p.vendorName);
        });
      });

      lot.extraIssues.forEach(ex => {
        let itms = [];
        try { itms = Array.isArray(ex.items) ? ex.items : (typeof ex.items === 'string' ? JSON.parse(ex.items) : []); } catch (_) {}
        itms.forEach(it => {
          addMatItem(it.bomItemName || it.materialName || 'Extra Material', '', it.totalRequired || it.qty || it.extraQty, it.unit || 'PCS', `Extra #${ex.voucher_id || ex.voucherId || ex.id}`, ex.reason);
        });
      });

      const compiledMaterials = Array.from(materialItemsMap.values());

      // Check process completeness
      const hasRgps = lot.rgps.length > 0;
      const hasOrders = (lot.dooriOrders.length + lot.zipOrders.length + lot.pos.length) > 0;
      const hasGateScans = gateEntryScans.length > 0;
      const hasMaterialReceived = materialInScans.length > 0;
      const rgpsComplete = !hasRgps || allRgpsReturned;

      // Status determination
      let processStatus = 'In Progress';
      let isCompleted = false;

      if (hasRgps && !allRgpsReturned) {
        const isOverdue = lot.rgps.some(r => r.expectedReturnDate && new Date(r.expectedReturnDate) < new Date());
        processStatus = isOverdue ? 'Overdue (Pending RGP Return)' : 'In Progress (Pending RGP Return)';
      } else if (hasOrders && !hasGateScans && !hasMaterialReceived) {
        processStatus = 'In Progress (Pending Gate In)';
      } else if (hasOrders && hasGateScans && !hasMaterialReceived) {
        processStatus = 'In Progress (Pending Store Inward)';
      } else if ((hasOrders || hasRgps) && rgpsComplete) {
        processStatus = 'Complete';
        isCompleted = true;
      } else if (lot.targetPieces > 0 && !hasOrders && !hasRgps) {
        processStatus = 'BOM Registered';
      }

      // Classify RGP items by category (Tag, Dori, Zip, Fabric/Other)
      const rgpTagList = [];
      const rgpDoriList = [];
      const rgpZipList = [];
      const rgpFabricList = [];

      lot.rgps.forEach(r => {
        const entries = r.parsedEntries || [];
        const isRet = (r.status || '').toLowerCase() === 'returned' || lot.scans.some(s => 
          (s.scan_type === 'rgp_return') && 
          (String(s.lot_number).toLowerCase() === String(r.rgpNo).toLowerCase() || String(s.lot_number).toLowerCase() === lot.lotNo.toLowerCase())
        );
        const rStatus = isRet ? 'Returned' : (r.status || 'Dispatched');

        if (entries.length === 0) {
          const typeStr = String(r.rgpType || r.purpose || '').toLowerCase();
          const itemObj = {
            rgpNo: r.rgpNo,
            itemDesc: r.rgpType || 'RGP Pass',
            qty: parseFloat(r.qty) || 0,
            uom: 'PCS',
            vendor: r.vendor || '—',
            purpose: r.purpose || 'Processing',
            status: rStatus,
            date: r.date
          };
          if (typeStr.includes('tag') || typeStr.includes('label')) rgpTagList.push(itemObj);
          else if (typeStr.includes('dori') || typeStr.includes('thread') || typeStr.includes('drawstring')) rgpDoriList.push(itemObj);
          else if (typeStr.includes('zip') || typeStr.includes('fastener')) rgpZipList.push(itemObj);
          else rgpFabricList.push(itemObj);
        } else {
          entries.forEach(e => {
            const descStr = `${e.itemDesc || ''} ${r.rgpType || ''} ${e.purpose || ''} ${r.purpose || ''}`.toLowerCase();
            const itemObj = {
              rgpNo: r.rgpNo,
              itemDesc: e.itemDesc || `${r.rgpType} - Lot ${e.lotNo || lot.lotNo}`,
              qty: parseFloat(e.qty1 || e.qty) || 0,
              uom: e.uom || 'PCS',
              vendor: r.vendor || '—',
              purpose: e.purpose || r.purpose || 'Processing',
              status: rStatus,
              date: r.date
            };
            if (descStr.includes('tag') || descStr.includes('label')) rgpTagList.push(itemObj);
            else if (descStr.includes('dori') || descStr.includes('drawstring')) rgpDoriList.push(itemObj);
            else if (descStr.includes('zip') || descStr.includes('chain')) rgpZipList.push(itemObj);
            else rgpFabricList.push(itemObj);
          });
        }
      });

      const vendorsArray = Array.from(lot.vendors);

      summaryList.push({
        lotNo: lot.lotNo,
        style: lot.style || '—',
        brand: lot.brand || '—',
        fabricType: lot.fabricType || '—',
        targetPieces: lot.targetPieces,
        isRecreated: lot.isRecreated,
        totalRgpPcs,
        totalRgpReturnedPcs,
        totalDoriPcs,
        totalZipPcs,
        totalPoPcs,
        totalExtraPcs,
        totalReceivedPcs,
        totalGateScannedPcs,
        counts: {
          rgp: lot.rgps.length,
          rgpTags: rgpTagList.length,
          rgpDori: rgpDoriList.length,
          rgpZip: rgpZipList.length,
          rgpFabric: rgpFabricList.length,
          doori: lot.dooriOrders.length,
          zip: lot.zipOrders.length,
          po: lot.pos.length,
          extra: lot.extraIssues.length,
          scans: lot.scans.length,
          gateScans: gateEntryScans.length,
          materialInScans: materialInScans.length,
          rgpOutScans: rgpOutScans.length,
          rgpInScans: rgpInScans.length,
          printingScans: printingScans.length,
          weightCaptures: lot.weightCaptures.length
        },
        vendors: vendorsArray,
        materials: compiledMaterials,
        rgps: lot.rgps.map(r => ({
          rgpNo: r.rgpNo,
          vendor: r.vendor,
          date: r.date,
          expectedReturnDate: r.expectedReturnDate,
          purpose: r.purpose,
          status: r.status,
          entries: r.parsedEntries
        })),
        rgpTagList,
        rgpDoriList,
        rgpZipList,
        rgpFabricList,
        dooriOrders: lot.dooriOrders,
        zipOrders: lot.zipOrders,
        pos: lot.pos,
        extraIssues: lot.extraIssues,
        scans: lot.scans,
        gateInScans: gateEntryScans,
        materialInScans,
        materialOutScans: [...rgpOutScans, ...printingScans],
        rgpReturnScans: rgpInScans,
        processStatus,
        isCompleted
      });
    }

    // Sort summaryList by lotNo desc or numerical order
    summaryList.sort((a, b) => {
      const numA = parseInt(String(a.lotNo).replace(/\D/g, ''), 10) || 0;
      const numB = parseInt(String(b.lotNo).replace(/\D/g, ''), 10) || 0;
      return numB - numA;
    });

    res.status(200).json({
      success: true,
      totalLots: summaryList.length,
      completedLots: summaryList.filter(s => s.isCompleted).length,
      inProgressLots: summaryList.filter(s => !s.isCompleted).length,
      data: summaryList
    });
  } catch (err) {
    console.error('API GET /api/reports/lot-wise-summary error:', err);
    res.status(500).json({ error: 'Failed to generate lot-wise summary report: ' + err.message });
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
      invalidateCache('approval_requests');
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

// ── Direct Database Search Routes (Zero In-Memory Overhead) ───────────────────
app.get('/api/search/dsa', async (req, res) => {
  try {
    const t0 = performance.now();
    const results = await searchDirectSql(req.query);
    const elapsed = (performance.now() - t0).toFixed(2);
    res.setHeader('X-Search-Execution-Time', `${elapsed}ms`);
    res.status(200).json({
      ...results,
      searchTimeMs: Number(elapsed),
      dsaMetrics: {
        algorithm: 'Direct Database SQL Index Query',
        spaceComplexity: '0 MB (Direct SQL)',
        executionTime: `${elapsed}ms`
      }
    });
  } catch (err) {
    console.error('API GET /api/search/dsa error:', err.message);
    res.status(500).json({ error: 'Search failed.' });
  }
});

// GET Direct SQL Auto-Suggestions
app.get('/api/search/suggest', async (req, res) => {
  try {
    const { q, max } = req.query;
    const t0 = performance.now();
    const suggestions = await getSearchSuggestionsSql(q || '', parseInt(max, 10) || 8);
    const elapsed = (performance.now() - t0).toFixed(2);
    res.status(200).json({
      prefix: q || '',
      suggestions,
      executionTime: `${elapsed}ms`
    });
  } catch (err) {
    console.error('API GET /api/search/suggest error:', err.message);
    res.status(500).json({ error: 'Auto-suggest failed.' });
  }
});

// GET Search Stats
app.get('/api/search/stats', (req, res) => {
  res.status(200).json({
    engine: 'Direct SQL Database Query',
    memoryFootprint: '0 MB',
    status: 'OPTIMIZED'
  });
});

// POST Trigger Re-Index (No-op in SQL mode)
app.post('/api/search/reindex', (req, res) => {
  res.status(200).json({ message: 'Direct SQL mode is active; no in-memory re-index needed.' });
});

// ── Materials Routes ─────────────────────────────────────────────────────────

// GET all materials (micro-cached 15s)
app.get('/api/materials', async (req, res) => {
  try {
    const onlyPresent = req.query.present === 'true';
    const cacheKey = `materials_${onlyPresent}`;
    const cached = getCached(cacheKey);
    if (cached) {
      res.setHeader('X-Cache', 'HIT');
      return res.status(200).json(cached);
    }
    const materials = await getAllMaterials(onlyPresent);
    setCached(cacheKey, materials, 15000);
    res.setHeader('X-Cache', 'MISS');
    res.status(200).json(materials);
  } catch (err) {
    console.error('API GET /api/materials error:', err.message);
    res.status(500).json({ error: 'Failed to retrieve materials.' });
  }
});

// GET single material by ID
app.get('/api/materials/:id', async (req, res) => {
  try {
    const material = await getMaterialById(req.params.id);
    if (!material) {
      return res.status(404).json({ error: `Material with ID "${req.params.id}" not found.` });
    }
    res.status(200).json(material);
  } catch (err) {
    console.error('API GET /api/materials/:id error:', err.message);
    res.status(500).json({ error: 'Failed to fetch material details.' });
  }
});

// POST add new material
app.post('/api/materials', async (req, res) => {
  try {
    const m = req.body;
    await upsertMaterial(m);
    invalidateCache('materials_');
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
    invalidateCache('materials_');
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
    invalidateCache('materials_');
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
    invalidateCache('materials_');
    res.status(201).json({ message: 'Transfer logged successfully.' });
  } catch (err) {
    console.error('API POST /api/transfers error:', err.message);
    res.status(500).json({ error: 'Failed to log transfer.' });
  }
});

// ── Approval Request Routes ───────────────────────────────────────────────────

// GET all approval requests (micro-cached 10s)
app.get('/api/approval-requests', async (req, res) => {
  try {
    const cacheKey = 'approval_requests_all';
    const cached = getCached(cacheKey);
    if (cached) {
      res.setHeader('X-Cache', 'HIT');
      return res.status(200).json(cached);
    }
    const requests = await getAllApprovalRequests();
    setCached(cacheKey, requests, 10000);
    res.setHeader('X-Cache', 'MISS');
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
    invalidateCache('approval_requests');
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
    invalidateCache('approval_requests');
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

// GET all vendors (micro-cached 30s)
app.get('/api/vendors', async (req, res) => {
  try {
    const cacheKey = 'vendors_all';
    const cached = getCached(cacheKey);
    if (cached) {
      res.setHeader('X-Cache', 'HIT');
      return res.status(200).json(cached);
    }
    const vendors = await getAllVendors();
    setCached(cacheKey, vendors, 30000);
    res.setHeader('X-Cache', 'MISS');
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
    invalidateCache('vendors');
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
    invalidateCache('vendors');
    res.status(200).json({ message: 'Vendor deleted.' });
  } catch (err) {
    console.error('API DELETE /api/vendors/:id error:', err.message);
    res.status(500).json({ error: 'Failed to delete vendor.' });
  }
});

// ── Settings Routes (accessories & designers lists) ─────────────────────────

// GET all settings (micro-cached 60s)
app.get('/api/settings', async (req, res) => {
  try {
    const cacheKey = 'settings_all';
    const cached = getCached(cacheKey);
    if (cached) {
      res.setHeader('X-Cache', 'HIT');
      return res.status(200).json(cached);
    }
    const accessoriesList = await getSetting('accessories_list');
    const designersList = await getSetting('designers_list');
    const warehouseHalls = await getSetting('warehouse_halls');
    const warehouseRacks = await getSetting('warehouse_racks');
    const allowMaterialPhotoEdit = await getSetting('allow_material_photo_edit');
    const allowWarehouseAddRack = await getSetting('allow_warehouse_add_rack');
    const payload = {
      accessoriesList: accessoriesList || [],
      designersList: designersList || [],
      warehouseHalls: warehouseHalls || [],
      warehouseRacks: warehouseRacks || [],
      allowMaterialPhotoEdit: (allowMaterialPhotoEdit !== null && allowMaterialPhotoEdit !== undefined) ? Boolean(allowMaterialPhotoEdit) : true,
      allowWarehouseAddRack: (allowWarehouseAddRack !== null && allowWarehouseAddRack !== undefined) ? Boolean(allowWarehouseAddRack) : false
    };
    setCached(cacheKey, payload, 60000);
    res.setHeader('X-Cache', 'MISS');
    res.status(200).json(payload);
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
    invalidateCache('settings');
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

// ── Elastic Conversion & Consumption Calculation Endpoint ──────────────────
// Automatically calculates Per Pc Meter (Inches: E1 * 0.0254, CMs: E2 / 100), Total Requirement & Recommended Rolls
app.post('/api/elastic/calculate', async (req, res) => {
  try {
    const {
      lotNo = '',
      pcs: rawPcs,
      sizeInput: rawSize = 0,
      unit = 'inch',
      elasticUnit: rawElasticUnit,
      tapeSizeInput: rawTape = 0,
      tapeUnit: rawTapeUnit = 'cm',
      rollLengthMtr = 25
    } = req.body;

    let pcs = parseInt(rawPcs, 10);
    let itemName = '';
    let supervisorName = '';
    let brand = '';
    let garmentType = '';
    let fabric = '';

    // If lotNo is given, fetch details from cutting_header if pcs or item is missing
    if (lotNo) {
      try {
        const [rows] = await pool.execute(
          'SELECT Lot_Number, Garment_Type, Style, Cutting_Qty, Supervisor, Brand, Fabric FROM cutting_header WHERE LOWER(Lot_Number) = LOWER(?)',
          [String(lotNo).trim()]
        );
        if (rows.length > 0) {
          const row = rows[0];
          if (isNaN(pcs) || pcs <= 0) pcs = parseInt(row.Cutting_Qty, 10) || 0;
          itemName = row.Garment_Type || row.Style || 'LOWER';
          supervisorName = row.Supervisor || '';
          brand = row.Brand || '';
          garmentType = row.Garment_Type || '';
          fabric = row.Fabric || '';
        }
      } catch (_) { }
    }

    if (isNaN(pcs) || pcs <= 0) {
      pcs = 600; // Default pcs fallback
    }

    const size = Math.max(0, parseFloat(rawSize) || 0);
    const tapeSize = Math.max(0, parseFloat(rawTape) || 0);

    // Support separate units for Elastic and Tape
    const elasticUnit = String(rawElasticUnit || unit || 'inch').toLowerCase().includes('cm') ? 'cm' : 'inch';
    const tapeUnit = String(rawTapeUnit || 'cm').toLowerCase().includes('cm') ? 'cm' : 'inch';

    // Formulas:
    // Inches: size * 0.0254
    // CMs: size / 100
    const elasticPerPcMtr = size > 0
      ? (elasticUnit === 'cm' ? parseFloat((size / 100).toFixed(4)) : parseFloat((size * 0.0254).toFixed(4)))
      : 0;

    const tapePerPcMtr = tapeSize > 0
      ? (tapeUnit === 'cm' ? parseFloat((tapeSize / 100).toFixed(4)) : parseFloat((tapeSize * 0.0254).toFixed(4)))
      : 0;

    // Total = Per Pc (In Mtr) * Pcs
    const totalElasticMtr = parseFloat((pcs * elasticPerPcMtr).toFixed(4));
    const totalTapeMtr = parseFloat((pcs * tapePerPcMtr).toFixed(4));
    const rLength = parseFloat(rollLengthMtr) || 25;
    const recommendedRolls = totalElasticMtr > 0 ? Math.ceil(totalElasticMtr / rLength) : 1;

    const elasticFormula = elasticUnit === 'cm'
      ? `${size} CM / 100 = ${elasticPerPcMtr} m`
      : `${size} Inch × 0.0254 = ${elasticPerPcMtr} m`;

    const tapeFormula = tapeUnit === 'cm'
      ? `${tapeSize} CM / 100 = ${tapePerPcMtr} m`
      : `${tapeSize} Inch × 0.0254 = ${tapePerPcMtr} m`;

    res.status(200).json({
      success: true,
      lotNo,
      itemName: itemName || 'LOWER',
      pcs,
      supervisorName,
      brand,
      garmentType,
      fabric,
      elasticUnit,
      tapeUnit,
      unit: elasticUnit,
      elasticSizeInput: size,
      tapeSizeInput: tapeSize,
      elasticPerPcMtr,
      tapePerPcMtr,
      totalElasticMtr,
      totalTapeMtr,
      rollLengthMtr: rLength,
      recommendedRolls,
      elasticFormula,
      tapeFormula,
      formulaExplanation: `${elasticFormula} | ${tapeFormula}`
    });
  } catch (err) {
    console.error('API POST /api/elastic/calculate error:', err.message);
    res.status(500).json({ error: 'Calculation failed: ' + err.message });
  }
});

app.get('/api/elastic/calculate', async (req, res) => {
  try {
    const {
      lotNo = '',
      pcs: rawPcs,
      sizeInput: rawSize = 0,
      unit = 'inch',
      tapeSizeInput: rawTape = 0,
      rollLengthMtr = 25
    } = req.query;

    let pcs = parseInt(rawPcs, 10) || 0;
    let itemName = '';
    let supervisorName = '';

    if (lotNo) {
      try {
        const [rows] = await pool.execute(
          'SELECT Lot_Number, Garment_Type, Style, Cutting_Qty, Supervisor FROM cutting_header WHERE LOWER(Lot_Number) = LOWER(?)',
          [String(lotNo).trim()]
        );
        if (rows.length > 0) {
          const row = rows[0];
          if (!pcs) pcs = parseInt(row.Cutting_Qty, 10) || 0;
          itemName = row.Garment_Type || row.Style || 'LOWER';
          supervisorName = row.Supervisor || '';
        }
      } catch (_) { }
    }

    const size = Math.max(0, parseFloat(rawSize) || 0);
    const isCm = String(unit).toLowerCase().includes('cm');
    const elasticPerPcMtr = size > 0
      ? (isCm ? parseFloat((size / 100).toFixed(4)) : parseFloat((size * 0.0254).toFixed(4)))
      : 0;

    const totalElasticMtr = parseFloat((pcs * elasticPerPcMtr).toFixed(4));
    const rLength = parseFloat(rollLengthMtr) || 25;
    const recommendedRolls = totalElasticMtr > 0 ? Math.ceil(totalElasticMtr / rLength) : 1;

    res.status(200).json({
      success: true,
      lotNo,
      itemName: itemName || 'LOWER',
      pcs,
      supervisorName,
      unit: isCm ? 'cm' : 'inch',
      elasticSizeInput: size,
      elasticPerPcMtr,
      totalElasticMtr,
      recommendedRolls
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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

// GET design/PO/RGP/Dori/Zip by ID publicly (for barcode scanner form prefilling)
app.get('/api/public/lot/:lotNo', async (req, res) => {
  try {
    const rawLotNo = req.params.lotNo;
    const lotNo = String(rawLotNo || '').trim();
    if (!lotNo) {
      return res.status(400).json({ error: 'Lot/PO number is required.' });
    }

    // 1. Check Standard Design by Lot ID
    const design = await getDesignById(lotNo);
    if (design) {
      return res.status(200).json({
        id: design.id,
        name: design.name,
        bom: typeof design.bom === 'string' ? JSON.parse(design.bom) : (design.bom || []),
        brand: design.brand,
        category: design.category,
        style: design.style,
        quantity: design.quantity,
        date: design.date,
        status: design.status,
        type: 'design'
      });
    }

    // 2. Check Purchase Order (PO)
    const po = await getPOByNumberOrId(lotNo);
    if (po) {
      const totalQty = (po.items || []).reduce((sum, item) => sum + (Number(item.qty) || 0), 0);
      return res.status(200).json({
        id: po.poNumber,
        name: po.designName || 'Purchase Order',
        bom: (po.items || []).map(item => ({
          name: item.name,
          description: item.name,
          status: 'Yes',
          detail: String(item.qty || 0)
        })),
        brand: po.vendorName,
        category: po.designCategory || 'Purchase Order',
        style: po.poNumber,
        quantity: totalQty,
        date: po.date,
        type: 'po'
      });
    }

    // 3. Check Returnable Gate Pass (RGP)
    const rgp = await getRgpByNo(lotNo);
    if (rgp) {
      let parsedEntries = [];
      try {
        if (Array.isArray(rgp.entries)) parsedEntries = rgp.entries;
        else if (typeof rgp.entries === 'string') parsedEntries = JSON.parse(rgp.entries);
      } catch (_) { parsedEntries = []; }
      const totalQty = parsedEntries.reduce((sum, e) => sum + (parseFloat(e.qty1) || 0), 0);
      return res.status(200).json({
        id: rgp.rgpNo,
        name: `RGP: ${rgp.rgpType || 'Gate Pass'}`,
        bom: parsedEntries.map(e => ({
          name: e.itemDesc || `${rgp.rgpType} - Lot ${e.lotNo || ''}`,
          description: e.itemDesc || `${rgp.rgpType} (${e.lotNo || ''})`,
          status: 'Yes',
          detail: String(e.qty1 || 0)
        })),
        brand: rgp.vendor,
        category: rgp.department || 'Gate Pass',
        style: rgp.rgpNo,
        quantity: totalQty > 0 ? totalQty : 1,
        date: rgp.date,
        status: rgp.status || 'Dispatched',
        type: 'rgp'
      });
    }

    // 4. Check Dori Order (Doori)
    const dori = await getDooriByLotOrPo(lotNo);
    if (dori) {
      let doriMaterials = [];
      try {
        if (dori.Dori_Selections) {
          const parsed = typeof dori.Dori_Selections === 'string' ? JSON.parse(dori.Dori_Selections) : dori.Dori_Selections;
          if (Array.isArray(parsed)) {
            doriMaterials = parsed.map(d => ({
              name: `Dori: ${d.shade || d.color || d.type || 'Custom'} (${d.size || ''})`,
              description: `Dori ${d.shade || d.color || ''}`,
              status: 'Yes',
              detail: String(d.qty || d.quantity || dori.Total_Pieces || 0)
            }));
          }
        }
      } catch (_) {}
      if (doriMaterials.length === 0) {
        doriMaterials = [{
          name: `Dori (${dori.Garment_Type || 'Garment'} - ${dori.Style || ''})`,
          description: `Dori Material`,
          status: 'Yes',
          detail: String(dori.Total_Pieces || 0)
        }];
      }
      return res.status(200).json({
        id: dori.po_number || dori.Lot_Number,
        name: `Dori PO - ${dori.Style || dori.Garment_Type || 'Dori'}`,
        bom: doriMaterials,
        brand: dori.Supplier_Name || 'Dori Supplier',
        category: 'Dori / Drawstring',
        style: dori.Style || '',
        quantity: dori.Total_Pieces || 0,
        date: dori.Issue_Date || dori.Timestamp,
        type: 'dori'
      });
    }

    // 5. Check Zip Order / Cutting Header
    const zip = await getZipByLotOrPo(lotNo);
    if (zip) {
      let zipMaterials = [];
      try {
        if (zip.Zip_Selections) {
          const parsed = typeof zip.Zip_Selections === 'string' ? JSON.parse(zip.Zip_Selections) : zip.Zip_Selections;
          if (Array.isArray(parsed)) {
            zipMaterials = parsed.map(z => ({
              name: `Zip: ${z.color || z.shade || z.type || 'Standard'} (${z.size || z.inch || ''}")`,
              description: `Zip ${z.color || ''}`,
              status: 'Yes',
              detail: String(z.qty || z.quantity || zip.Total_Pieces || zip.Cutting_Qty || 0)
            }));
          }
        }
      } catch (_) {}
      if (zipMaterials.length === 0) {
        zipMaterials = [{
          name: `Zip (${zip.Garment_Type || 'Garment'} - ${zip.Style || ''})`,
          description: `Zip Material`,
          status: 'Yes',
          detail: String(zip.Total_Pieces || zip.Cutting_Qty || 0)
        }];
      }
      return res.status(200).json({
        id: zip.po_number || zip.Lot_Number,
        name: `Zip PO - ${zip.Style || zip.Garment_Type || 'Zip'}`,
        bom: zipMaterials,
        brand: zip.Supplier_Name || zip.Brand || 'Zip Supplier',
        category: 'Zip / Fasteners',
        style: zip.Style || '',
        quantity: zip.Total_Pieces || zip.Cutting_Qty || 0,
        date: zip.Issue_Date || zip.JobOrder_Date || zip.Saved_At,
        type: 'zip'
      });
    }

    return res.status(404).json({ error: `Record with Lot/PO/RGP number "${lotNo}" not found in database.` });
  } catch (err) {
    console.error('API GET /api/public/lot/:lotNo error:', err.stack);
    res.status(500).json({ error: 'Failed to retrieve public design/PO/RGP info.' });
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
    invalidateCache('materials_');
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

app.put('/api/warehouse-locations/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updated = await updateWarehouseLocation(id, req.body);
    res.json({ success: true, data: updated, message: 'Warehouse location updated successfully.' });
  } catch (err) {
    console.error('[API] warehouse-locations PUT error:', err.message);
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
    return res.status(200).send('G-PDMS Production API Server is running.');
  });
}

// Start Server bound to 0.0.0.0 for Docker / Render / Railway container compatibility
const HOST = '0.0.0.0';
const server = app.listen(PORT, HOST, () => {
  console.log(`G-PDMS Production Server running on http://${HOST}:${PORT}`);

  // ── Auto Keep-Alive Heartbeat (Every 5 Minutes / 300 Seconds) ─────────────
  // Pings internal loopback /api/ping to keep event loop and process active with zero external socket overhead
  const KEEP_ALIVE_INTERVAL_MS = 300 * 1000;

  const runKeepAliveHealthCheck = async () => {
    const timestamp = new Date().toLocaleTimeString('en-GB');
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/api/ping`);
      if (res.ok) {
        console.log(`[Keep-Alive Heartbeat] 💚 ${timestamp} - Ping OK | Uptime: ${Math.floor(process.uptime())}s`);
      }
    } catch (fetchErr) {
      console.log(`[Keep-Alive Heartbeat] 💚 ${timestamp} - Ping notice: ${fetchErr.message}`);
    }
  };

  // Initial keep-alive check after 30 seconds
  setTimeout(runKeepAliveHealthCheck, 30000);
  setInterval(runKeepAliveHealthCheck, KEEP_ALIVE_INTERVAL_MS);

  // Background Auto-Sync Google Sheets to Database with 10s warmup delay
  setTimeout(() => {
    console.log('[Incremental Sync Worker] Initiating startup Google Sheets synchronization to MySQL database...');
    syncGoogleSheetsToDb(false).catch(err => console.warn('[Incremental Sync Worker] Startup sync warning:', err.message));
  }, 10000);

  // Dedicated Incremental Sync Background Worker every 30 minutes (1800 seconds)
  setInterval(() => {
    syncGoogleSheetsToDb(false).catch(err => console.warn('[Incremental Sync Worker] Sync warning:', err.message));
  }, 30 * 60 * 1000);
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

// ── Graceful Shutdown Handler (Zero-Downtime Clean Exit) ─────────────────────
const handleGracefulShutdown = (signal) => {
  console.log(`\n[Graceful Shutdown] Received ${signal}. Draining active HTTP connections...`);
  server.close(async () => {
    console.log('[Graceful Shutdown] HTTP server closed. Closing MySQL connection pool...');
    try {
      await pool.end();
      console.log('[Graceful Shutdown] MySQL pool successfully terminated. Process exiting cleanly.');
      process.exit(0);
    } catch (e) {
      console.error('[Graceful Shutdown Error]', e.message);
      process.exit(1);
    }
  });

  // Force close after 10 seconds if any connection hangs
  setTimeout(() => {
    console.error('[Graceful Shutdown] Forcing shutdown after 10s timeout.');
    process.exit(1);
  }, 10000).unref();
};

process.on('SIGTERM', () => handleGracefulShutdown('SIGTERM'));
process.on('SIGINT', () => handleGracefulShutdown('SIGINT'));


