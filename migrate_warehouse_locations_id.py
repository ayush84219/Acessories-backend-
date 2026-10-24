import os
import re
import json
from urllib.parse import urlparse
import mysql.connector
from dotenv import load_dotenv

# Load backend/.env
env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env')
load_dotenv(env_path)

def get_connection():
    url = os.getenv('MYSQL_URL') or os.getenv('DATABASE_URL')
    if url:
        p = urlparse(url)
        return mysql.connector.connect(
            host=p.hostname,
            port=p.port or 3306,
            user=p.username,
            password=p.password,
            database=p.path.lstrip('/')
        )
    return mysql.connector.connect(
        host=os.getenv('MYSQL_HOST', 'localhost'),
        port=int(os.getenv('MYSQL_PORT', 3306)),
        user=os.getenv('MYSQL_USER', 'root'),
        password=os.getenv('MYSQL_PASSWORD', 'Ayush123'),
        database=os.getenv('MYSQL_DATABASE', 'accessories2')
    )

def canonicalize_code(raw_code, default_wh='Main Store'):
    if not raw_code:
        return None
    s = str(raw_code).strip()
    s = re.sub(r'\(\d+\s*pkts?\)', '', s, flags=re.I).strip()
    if not s or s.lower() in ('n/a', 'null', 'default', 'main store'):
        return None

    # Detect warehouse
    wh = 'Main Store'
    m_hall = re.search(r'\b(hall\s*\d+)\b', s, flags=re.I)
    if m_hall:
        wh = m_hall.group(1).title()
    elif default_wh and default_wh.lower() != 'main store':
        wh = default_wh

    # Strip repeated prefixes
    s_clean = re.sub(r'^(?:(?:main\s*store|warehouse\s*\d+|hall\s*\d+)\s*[-–—:]\s*)+', '', s, flags=re.I).strip()

    # Look for rack identifier
    m_rack = re.search(r'rack\s*([0-9a-zA-Z\-_/]+)', s_clean, flags=re.I)
    if m_rack:
        rack_val = m_rack.group(1).upper()
        return f"{wh} - RACK {rack_val}"

    if 'floor' in s_clean.lower():
        return f"{wh} - RACK FLOOR"

    m_num = re.search(r'(\d+[a-zA-Z]?)$', s_clean)
    if m_num:
        return f"{wh} - RACK {m_num.group(1).upper()}"

    return f"{wh} - {s_clean.upper()}"

def natural_sort_key(code):
    # Sort FLOOR first, then numeric RACK 1, 2, 3...
    if 'FLOOR' in code:
        return (0, 0, code)
    m = re.search(r'RACK\s*(\d+)', code)
    if m:
        return (1, int(m.group(1)), code)
    return (2, 0, code)

def run_migration():
    print("==========================================================")
    print(" [MIGRATION] Fixing warehouse_locations ID & Cleaning Data")
    print("==========================================================")
    conn = get_connection()
    cur = conn.cursor(dictionary=True)

    # 1. Fetch current rows
    cur.execute("SELECT * FROM warehouse_locations")
    existing_rows = cur.fetchall()
    print(f"[*] Found {len(existing_rows)} rows in warehouse_locations.")

    # 2. Also check settings for warehouse_racks
    cur.execute("SELECT setting_value FROM settings WHERE setting_key = 'warehouse_racks'")
    rack_setting_row = cur.fetchone()
    setting_racks = []
    if rack_setting_row and rack_setting_row['setting_value']:
        try:
            setting_racks = json.loads(rack_setting_row['setting_value'])
        except Exception:
            pass
    print(f"[*] Found {len(setting_racks)} entries in settings.warehouse_racks.")

    # 3. Canonicalize & Deduplicate
    unique_locations = {}

    for r in existing_rows:
        wh = r.get('warehouse') or 'Main Store'
        raw_code = r.get('code') or r.get('id')
        code = canonicalize_code(raw_code, wh)
        if not code:
            continue
        cap = int(r.get('capacity') or 20)
        if code not in unique_locations or cap > unique_locations[code]['capacity']:
            unique_locations[code] = {
                'code': code,
                'warehouse': wh,
                'capacity': cap
            }

    for r in setting_racks:
        wh = r.get('warehouse') or 'Main Store'
        raw_code = r.get('code') or r.get('name') or r.get('id')
        code = canonicalize_code(raw_code, wh)
        if not code:
            continue
        cap = int(r.get('capacity') or 20)
        if code not in unique_locations or cap > unique_locations[code]['capacity']:
            unique_locations[code] = {
                'code': code,
                'warehouse': wh,
                'capacity': cap
            }

    sorted_codes = sorted(unique_locations.keys(), key=natural_sort_key)
    print(f"[+] Total cleaned & deduplicated locations: {len(sorted_codes)}")

    # 4. Recreate table with INT AUTO_INCREMENT PRIMARY KEY
    print("[*] Recreating warehouse_locations table with INT AUTO_INCREMENT PRIMARY KEY...")
    cur.execute("DROP TABLE IF EXISTS warehouse_locations")
    cur.execute("""
        CREATE TABLE warehouse_locations (
            id INT AUTO_INCREMENT PRIMARY KEY,
            code VARCHAR(255) NOT NULL UNIQUE,
            warehouse VARCHAR(255) NOT NULL,
            capacity INT DEFAULT 20,
            INDEX idx_whloc_wh (warehouse),
            INDEX idx_whloc_code (code)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """)

    # 5. Insert rows in natural order (IDs will be 1, 2, 3...)
    insert_sql = "INSERT INTO warehouse_locations (code, warehouse, capacity) VALUES (%s, %s, %s)"
    insert_data = []
    cleaned_settings_racks = []
    
    current_id = 1
    for code in sorted_codes:
        loc = unique_locations[code]
        insert_data.append((loc['code'], loc['warehouse'], loc['capacity']))
        short_rack = loc['code'].split(' - ', 1)[1] if ' - ' in loc['code'] else loc['code']
        cleaned_settings_racks.append({
            'id': current_id,
            'code': loc['code'],
            'name': short_rack,
            'warehouse': loc['warehouse'],
            'capacity': loc['capacity']
        })
        current_id += 1

    cur.executemany(insert_sql, insert_data)
    conn.commit()
    print(f"[SUCCESS] Successfully inserted {len(insert_data)} sequential records with IDs 1 to {len(insert_data)}.")

    # 6. Update settings.warehouse_racks
    cur.execute(
        "REPLACE INTO settings (setting_key, setting_value) VALUES ('warehouse_racks', %s)",
        (json.dumps(cleaned_settings_racks),)
    )
    conn.commit()
    print("[SUCCESS] Updated settings.warehouse_racks with clean IDs.")

    # 7. Verification Query
    cur.execute("SELECT id, code, warehouse, capacity FROM warehouse_locations ORDER BY id ASC LIMIT 10")
    sample_rows = cur.fetchall()
    print("\n--- SAMPLE MIGRATED ROWS (First 10) ---")
    for row in sample_rows:
        print(f"  ID: {row['id']} | CODE: {row['code']} | WH: {row['warehouse']} | CAP: {row['capacity']}")

    cur.execute("SELECT COUNT(*) as total FROM warehouse_locations")
    total_count = cur.fetchone()['total']
    print(f"\n[OK] Migration Complete! Total locations in DB: {total_count}")

    cur.close()
    conn.close()

if __name__ == '__main__':
    run_migration()
