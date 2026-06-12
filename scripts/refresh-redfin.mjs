#!/usr/bin/env node
/**
 * Downloads the Redfin Data Center ZIP-code market tracker and regenerates
 * the REDFIN_ZIPS block in src/adapters/redfin-zips.ts.
 *
 * Run manually:  node scripts/refresh-redfin.mjs
 * Also run by:   .github/workflows/refresh-redfin.yml  (scheduled monthly)
 *
 * Source: https://www.redfin.com/news/data-center/
 * File:   zip_code_market_tracker.tsv000.gz
 * License: free for non-commercial use with attribution.
 */

import { createGunzip } from 'node:zlib';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Writable } from 'node:stream';

const S3_URL =
  'https://redfin-public-data.s3.us-west-2.amazonaws.com/redfin_market_tracker/zip_code_market_tracker.tsv000.gz';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_FILE = path.join(ROOT, 'src/adapters/redfin-zips.ts');
const MONTHS_BACK = 36;

// All supported ZIPs (from src/adapters/census.ts countyFromZip).
const ALLOWED_ZIPS = new Set([
  // Collin
  '75033','75034','75035','75071','75072','75070',
  // Denton
  '75036','76226','76227','76247',
  // Tarrant
  '76001','76002','76006','76010','76011','76012','76013','76014','76015','76016',
  '76017','76018','76019','76020','76021','76022','76034','76036','76039','76040',
  '76051','76052','76053','76054','76063','76071','76092','76102','76103','76104',
  '76105','76106','76107','76108','76109','76110','76111','76112','76114','76115',
  '76116','76117','76118','76119','76120','76123','76126','76127','76131','76132',
  '76133','76134','76135','76137','76140','76148','76155','76161','76164','76177',
  '76179','76180','76182','76244','76248',
]);

async function fetchAndParse() {
  console.log(`Fetching ${S3_URL} …`);
  const res = await fetch(S3_URL);
  if (!res.ok) throw new Error(`Redfin download failed: HTTP ${res.status}`);

  // Accumulate decompressed text via streaming gunzip.
  const chunks = [];
  const collector = new Writable({
    write(chunk, _enc, cb) { chunks.push(chunk); cb(); },
  });
  await pipeline(res.body, createGunzip(), collector);
  return Buffer.concat(chunks).toString('utf8');
}

function parseTsv(tsv) {
  const lines = tsv.split('\n');
  const header = lines[0].split('\t').map(h => h.trim());

  const idx = (name) => {
    const i = header.indexOf(name);
    if (i === -1) throw new Error(`TSV column "${name}" not found. Header: ${header.slice(0, 10).join(', ')}`);
    return i;
  };

  const iZip    = idx('region');           // "Zip Code: 75034" or just "75034"
  const iState  = idx('state_code');
  const iType   = idx('property_type');
  const iPeriod = idx('period_end');       // "2026-04-30" — we extract YYYY-MM
  const iPrice  = idx('median_sale_price');
  const iSold   = idx('homes_sold');

  // zip -> Array<{ month: "2026-04", medianSalePrice, homesSold }>
  const byZip = new Map();

  for (let i = 1; i < lines.length; i++) {
    const row = lines[i].split('\t');
    if (row.length < header.length) continue;

    if (row[iState]?.trim() !== 'TX') continue;
    if (row[iType]?.trim() !== 'Single Family Residential') continue;

    // Region field might be "Zip Code: 75034" or plain "75034"
    const rawRegion = row[iZip]?.trim() ?? '';
    const zip = rawRegion.replace(/^Zip Code:\s*/i, '').replace(/\D/g, '').slice(0, 5);
    if (!ALLOWED_ZIPS.has(zip)) continue;

    const price = parseFloat(row[iPrice]);
    const sold  = parseInt(row[iSold], 10);
    if (!isFinite(price) || price <= 0) continue;

    const periodRaw = row[iPeriod]?.trim() ?? '';
    const month = periodRaw.slice(0, 7); // "YYYY-MM"
    if (!/^\d{4}-\d{2}$/.test(month)) continue;

    if (!byZip.has(zip)) byZip.set(zip, []);
    byZip.get(zip).push({ month, medianSalePrice: price, homesSold: isFinite(sold) ? sold : 0 });
  }

  return byZip;
}

function buildEntries(byZip) {
  const result = {};

  for (const [zip, rows] of byZip) {
    // Sort chronologically, keep last MONTHS_BACK entries.
    rows.sort((a, b) => a.month.localeCompare(b.month));
    const recent = rows.slice(-MONTHS_BACK);
    if (recent.length === 0) continue;

    const latest = recent[recent.length - 1];

    // 12-month change: find entry closest to 12 months before latest.
    const targetMonth = subtractMonths(latest.month, 12);
    const prior = recent.find(r => r.month === targetMonth)
      ?? recent.find(r => r.month <= targetMonth && r.month >= subtractMonths(latest.month, 14));

    const pctChange12mo = prior
      ? parseFloat((((latest.medianSalePrice - prior.medianSalePrice) / prior.medianSalePrice) * 100).toFixed(1))
      : 0;

    result[zip] = {
      latestMonth: latest.month,
      medianSalePrice: Math.round(latest.medianSalePrice),
      pctChange12mo,
      homesSold: latest.homesSold,
    };
  }

  return result;
}

function subtractMonths(yyyyMM, n) {
  const [y, m] = yyyyMM.split('-').map(Number);
  const d = new Date(y, m - 1 - n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function renderBlock(entries) {
  const zips = Object.keys(entries).sort();
  if (zips.length === 0) return 'export const REDFIN_ZIPS: Record<string, RedfinZipEntry> = {};';

  const lines = zips.map(zip => {
    const e = entries[zip];
    return `  '${zip}': { latestMonth: '${e.latestMonth}', medianSalePrice: ${e.medianSalePrice}, pctChange12mo: ${e.pctChange12mo}, homesSold: ${e.homesSold} },`;
  });
  return `export const REDFIN_ZIPS: Record<string, RedfinZipEntry> = {\n${lines.join('\n')}\n};`;
}

function updateFile(block) {
  const src = readFileSync(OUT_FILE, 'utf8');
  const next = src.replace(
    /export const REDFIN_ZIPS: Record<string, RedfinZipEntry> = \{[\s\S]*?\};/,
    block,
  );
  if (next === src) return false;
  writeFileSync(OUT_FILE, next, 'utf8');
  return true;
}

async function main() {
  const tsv    = await fetchAndParse();
  const byZip  = parseTsv(tsv);
  const entries = buildEntries(byZip);
  const zips   = Object.keys(entries);

  console.log(`Parsed ${zips.length} ZIPs: ${zips.slice(0, 5).join(', ')}${zips.length > 5 ? ' …' : ''}`);

  const block   = renderBlock(entries);
  const changed = updateFile(block);

  if (changed) {
    console.log(`✓ Updated ${OUT_FILE}`);
  } else {
    console.log('No changes — redfin-zips.ts is already up to date.');
  }
}

main().catch(err => {
  console.error('refresh-redfin failed:', err.message);
  process.exit(1);
});
