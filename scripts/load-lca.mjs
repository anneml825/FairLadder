#!/usr/bin/env node
/**
 * One-time script: download H-1B LCA disclosure data from DOL and load into Supabase.
 *
 * Requirements:
 *   - SUPABASE_URL and SUPABASE_SERVICE_KEY must be in .env.local
 *   - The lca_data table must exist (run the SQL in scripts/lca-schema.sql first)
 *   - node >= 18  (uses native fetch for redirect following)
 *
 * Usage:
 *   node scripts/load-lca.mjs
 *
 * Takes ~5-10 minutes depending on connection speed. Safe to re-run — uses INSERT
 * with ON CONFLICT DO NOTHING so duplicates are skipped automatically.
 */

import { createClient } from '@supabase/supabase-js';
import { read, utils } from 'xlsx';
import { readFileSync, existsSync, writeFileSync, unlinkSync } from 'fs';
import https from 'https';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

// ── Load env vars from .env.local ────────────────────────────────────────────
function loadEnv() {
  const envPath = path.join(ROOT, '.env.local');
  if (!existsSync(envPath)) {
    console.error('ERROR: .env.local not found at', envPath);
    console.error('Create it with SUPABASE_URL and SUPABASE_SERVICE_KEY set.');
    process.exit(1);
  }
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.+)$/);
    if (m) process.env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '');
  }
}
loadEnv();

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
  console.error('ERROR: SUPABASE_URL or SUPABASE_SERVICE_KEY missing in .env.local');
  process.exit(1);
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

// ── DOL LCA disclosure files — most recent 2 fiscal years ────────────────────
// Update these URLs each year when DOL publishes new data.
// All quarters: https://www.dol.gov/agencies/eta/foreign-labor/performance
const DATA_URLS = [
  'https://www.dol.gov/sites/dolgov/files/ETA/oflc/pdfs/LCA_Disclosure_Data_FY2024_Q4.xlsx',
  'https://www.dol.gov/sites/dolgov/files/ETA/oflc/pdfs/LCA_Disclosure_Data_FY2024_Q3.xlsx',
  'https://www.dol.gov/sites/dolgov/files/ETA/oflc/pdfs/LCA_Disclosure_Data_FY2024_Q2.xlsx',
  'https://www.dol.gov/sites/dolgov/files/ETA/oflc/pdfs/LCA_Disclosure_Data_FY2024_Q1.xlsx',
];

// ── Helpers ───────────────────────────────────────────────────────────────────
function normalizeWage(from, unit) {
  if (!from || !unit) return null;
  const mult = { Year: 1, Hour: 2080, Month: 12, Week: 52, 'Bi-Weekly': 26 }[unit] ?? 1;
  const annual = Math.round(parseFloat(from) * mult);
  return annual >= 20_000 && annual <= 1_000_000 ? annual : null;
}

async function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = (await import('fs')).createWriteStream(dest);
    const client = url.startsWith('https') ? https : http;
    function get(u) {
      client.get(u, res => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          return get(res.headers.location);
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode} for ${u}`));
        }
        let downloaded = 0;
        res.on('data', chunk => {
          downloaded += chunk.length;
          process.stdout.write(`\r  ${(downloaded / 1024 / 1024).toFixed(1)} MB downloaded`);
        });
        res.pipe(file);
        file.on('finish', () => { file.close(); console.log(''); resolve(); });
      }).on('error', reject);
    }
    get(url);
  });
}

// ── Process one DOL file ──────────────────────────────────────────────────────
async function processFile(url) {
  const fy = url.match(/FY(\d{4}_Q\d)/)?.[1] ?? 'unknown';
  const tmpPath = path.join(ROOT, `.tmp-lca-${fy}.xlsx`);

  console.log(`\n── FY${fy} ──`);
  console.log(`Downloading from DOL...`);
  try {
    await downloadFile(url, tmpPath);
  } catch (err) {
    console.error(`  Download failed: ${err.message} — skipping`);
    return 0;
  }

  console.log('Parsing Excel (this may take 30-60s for large files)...');
  let rows;
  try {
    const buf = readFileSync(tmpPath);
    const wb = read(buf, { type: 'buffer', cellDates: true, dense: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    rows = utils.sheet_to_json(ws);
  } finally {
    try { unlinkSync(tmpPath); } catch {}
  }

  console.log(`  Total rows: ${rows.length.toLocaleString()}`);

  const records = [];
  for (const row of rows) {
    if (row.CASE_STATUS !== 'Certified') continue;

    const wageFrom = normalizeWage(row.WAGE_RATE_OF_PAY_FROM, row.WAGE_UNIT_OF_PAY);
    if (!wageFrom) continue;

    const wageTo = normalizeWage(row.WAGE_RATE_OF_PAY_TO, row.WAGE_UNIT_OF_PAY);

    let decisionDate = null;
    if (row.DECISION_DATE) {
      try { decisionDate = new Date(row.DECISION_DATE).toISOString().split('T')[0]; } catch {}
    }

    records.push({
      employer_name: String(row.EMPLOYER_NAME ?? '').trim().slice(0, 200),
      job_title: String(row.JOB_TITLE ?? '').trim().slice(0, 200),
      soc_code: String(row.SOC_CODE ?? '').trim().slice(0, 10),
      soc_title: String(row.SOC_TITLE ?? '').trim().slice(0, 100),
      wage_from: parseFloat(row.WAGE_RATE_OF_PAY_FROM) || null,
      wage_to: parseFloat(row.WAGE_RATE_OF_PAY_TO) || null,
      wage_unit: String(row.WAGE_UNIT_OF_PAY ?? 'Year').trim().slice(0, 20),
      annual_wage_from: wageFrom,
      annual_wage_to: wageTo,
      city: String(row.WORKSITE_CITY ?? '').trim().slice(0, 100),
      state: String(row.WORKSITE_STATE ?? '').trim().slice(0, 2),
      decision_date: decisionDate,
      fiscal_year: fy,
    });
  }

  console.log(`  Certified records: ${records.length.toLocaleString()}`);
  if (!records.length) return 0;

  // Upsert in batches of 500
  const BATCH = 500;
  let loaded = 0;
  for (let i = 0; i < records.length; i += BATCH) {
    const batch = records.slice(i, i + BATCH);
    const { error } = await supabase.from('lca_data').upsert(batch, { onConflict: 'employer_name,job_title,decision_date,city,state' });
    if (error) {
      process.stdout.write(`\n  Batch error: ${error.message}\n`);
    } else {
      loaded += batch.length;
    }
    process.stdout.write(`\r  Loaded ${loaded.toLocaleString()} / ${records.length.toLocaleString()}`);
  }
  console.log('\n  Done.');
  return loaded;
}

// ── Main ──────────────────────────────────────────────────────────────────────
console.log('FairLadder — H-1B LCA Data Loader');
console.log('Supabase:', process.env.SUPABASE_URL);
console.log('');

let total = 0;
for (const url of DATA_URLS) {
  total += await processFile(url);
}

console.log(`\nAll done. Total records loaded: ${total.toLocaleString()}`);
console.log('The lca_data table is now populated and will be queried on each analysis.');
