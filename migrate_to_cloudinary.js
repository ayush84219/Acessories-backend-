import pool from './db.js';
import cloudinary from './config/cloudinary.js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '.env') });

console.log('====================================================');
console.log('🚀 G-PDMS DATABASE IMAGE MIGRATION TO CLOUDINARY');
console.log('====================================================');

// Helper to upload base64 or remote URL to Cloudinary
async function uploadToCloudinary(imageSource, folder = 'accessories_migrated') {
  try {
    let source = decodeURIComponent(imageSource || '');
    // Extract drive file id from proxy or view link if present
    const driveMatch = source.match(/(?:id=|file\/d\/|open\?id=)([a-zA-Z0-9_-]{25,})/);
    if (driveMatch) {
      const fileId = driveMatch[1];
      source = `https://lh3.googleusercontent.com/d/${fileId}`;
    }

    const res = await cloudinary.uploader.upload(source, {
      folder: folder,
      resource_type: 'image'
    });
    return res.secure_url;
  } catch (err) {
    console.error(`  ❌ Cloudinary upload error:`, err.message);
    return null;
  }
}

async function migrateTable(tableName, colName, idCol = 'id', folder = 'accessories') {
  console.log(`\n📦 Checking table [${tableName}] for images to migrate...`);
  
  try {
    const [rows] = await pool.query(
      `SELECT ${idCol}, ${colName} FROM ${tableName} WHERE ${colName} IS NOT NULL AND ${colName} != ''`
    );

    let total = rows.length;
    let migrated = 0;
    let skipped = 0;
    let failed = 0;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const id = row[idCol];
      const currentUrl = String(row[colName] || '').trim();

      // Skip already uploaded Cloudinary URLs
      if (currentUrl.includes('res.cloudinary.com')) {
        skipped++;
        continue;
      }

      // Check if it's base64 or another URL that needs migration
      const isBase64 = currentUrl.startsWith('data:image');
      const isRemote = currentUrl.startsWith('http://') || currentUrl.startsWith('https://');

      if (!isBase64 && !isRemote) {
        skipped++;
        continue;
      }

      console.log(`  [${i + 1}/${total}] Migrating ${tableName} (${idCol}=${id})...`);
      
      const newUrl = await uploadToCloudinary(currentUrl, folder);
      if (newUrl) {
        await pool.execute(
          `UPDATE ${tableName} SET ${colName} = ? WHERE ${idCol} = ?`,
          [newUrl, id]
        );
        migrated++;
        console.log(`    ✅ Updated to: ${newUrl}`);
      } else {
        failed++;
      }
    }

    console.log(`📊 [${tableName}] Summary: Total: ${total} | Migrated: ${migrated} | Skipped: ${skipped} | Failed: ${failed}`);
  } catch (err) {
    console.error(`❌ Error migrating table ${tableName}:`, err.message);
  }
}

async function runMigration() {
  const startTime = Date.now();

  try {
    // 1. Materials table
    await migrateTable('materials', 'imageUrl', 'id', 'accessories/materials');

    // 2. Weight capture entries
    await migrateTable('weight_capture', 'imageUrl', 'id', 'accessories/weight_capture');

    // 3. Designs BOM catalog
    await migrateTable('designs', 'imageUrl', 'id', 'accessories/designs');

    // 4. Cutting header lots
    await migrateTable('cutting_header', 'Image_Url', 'id', 'accessories/cuttings');

    const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log('\n====================================================');
    console.log(`✨ ALL MIGRATIONS COMPLETED in ${durationSec}s!`);
    console.log('====================================================');
  } catch (err) {
    console.error('Fatal Migration Error:', err);
  } finally {
    process.exit(0);
  }
}

runMigration();
