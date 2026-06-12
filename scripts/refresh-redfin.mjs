#!/usr/bin/env node
/**
 * Reads the Redfin Data Center ZIP-code market tracker TSV from stdin and
 * regenerates the REDFIN_ZIPS block in src/adapters/redfin-zips.ts.
 *
 * Invoked by the workflow as:
 *   curl -fsSL <S3_URL> | gunzip | node scripts/refresh-redfin.mjs
 *
 * The workflow handles download + decompression so this script only does
 * line-by-line parsing — safe for any file size with minimal memory use.
 *
 * Run manually (requires curl + gunzip):
 *   curl -fsSL "https://redfin-public-data.s3.us-west-2.amazonaws.com/redfin_market_tracker/zip_code_market_tracker.tsv000.gz" | gunzip | node scripts/refresh-redfin.mjs
 *
 * Source: https://www.redfin.com/news/data-center/
 * License: free for non-commercial use with attribution.
 */

import { createInterface } from 'node:readline';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT     = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_FILE = path.join(ROOT, 'src/adapters/redfin-zips.ts');
const MONTHS_BACK = 36;

// All supported ZIPs (mirrors src/adapters/census.ts countyFromZip).
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

async function parseStdin() {
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

  const byZip = new Map();
  let header = null;
  let iZip = -1, iState = -1, iType = -1, iPeriod = -1, iPrice = -1, iSold = -1;
  let lineCount = 0;
  let matchCount = 0;

  for await (const line of rl) {
    lineCount++;

    if (!header) {
      header = line.split('\t').map(h => h.trim().replace(/^"|"$/g, '').toLowerCase());

      // Print first 15 columns so we can debug column-name mismatches.
      console.error('Header (first 15 cols):', header.slice(0, 15).join(' | '));

      const col = (name) => {
        const i = header.indexOf(name);
        if (i === -1) {
          console.error(`Available columns: ${header.join(', ')}`);
          throw new Error(`Column "${name}" not found in TSV header.`);
        }
        return i;
      };

      iZip    = col('region');
      iState  = col('state_code');
      iType   = col('property_type');
      iPeriod = col('period_end');
      iPrice  = col('median_sale_price');
      iSold   = col('homes_sold');

      console.error('Columns found. Streaming data rows…');
      continue;
    }

    // Fast pre-filter before splitting the whole line (speeds up by 10×).
    if (!line.includes('TX')) continue;
    if (!line.includes('Single Family Residential')) continue;

    const cols = line.split('\t');
    if (cols.length <= Math.max(iZip, iState, iType, iPeriod, iPrice, iSold)) continue;

    const cell = (i) => cols[i]?.trim().replace(/^"|"$/g, '') ?? '';

    if (cell(iState) !== 'TX') continue;
    if (cell(iType) !== 'Single Family Residential') continue;

    // Region may be "Zip Code: 75034" or plain "75034"
    const zip = cell(iZip).replace(/^Zip Code:\s*/i, '').replace(/\D/g, '').slice(0, 5);
    if (!ALLOWED_ZIPS.has(zip)) continue;

    const price = parseFloat(cell(iPrice));
    if (!isFinite(price) || price <= 0) continue;

    const month = cell(iPeriod).slice(0, 7); // "YYYY-MM"
    if (!/^\d{4}-\d{2}$/.test(month)) continue;

    const sold = parseInt(cell(iSold), 10);

    if (!byZip.has(zip)) byZip.set(zip, []);
    byZip.get(zip).push({ month, medianSalePrice: price, homesSold: isFinite(sold) ? sold : 0 });
    matchCount++;
  }

  console.error(`Streamed ${lineCount.toLocaleString()} lines → ${matchCount} matched rows → ${byZip.size} ZIPs.`);
  return byZip;
}

function buildEntries(byZip) {
  const result = {};

  for (const [zip, rows] of byZip) {
    rows.sort((a, b) => a.month.localeCompare(b.month));
    const recent = rows.slice(-MONTHS_BACK);
    if (recent.length === 0) continue;

    const latest = recent[recent.length - 1];

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
  const byZip   = await parseStdin();
  const entries = buildEntries(byZip);
  const zips    = Object.keys(entries);

  if (zips.length === 0) {
    throw new Error(
      'No ZIP entries built. Check that the column names above match and that ' +
      'ALLOWED_ZIPS contains valid ZIPs present in the dataset.'
    );
  }

  console.error(`Built ${zips.length} ZIP entries: ${zips.slice(0, 6).join(', ')}${zips.length > 6 ? ' …' : ''}`);

  const block   = renderBlock(entries);
  const changed = updateFile(block);

  if (changed) {
    console.log(`✓ Updated ${OUT_FILE}`);
  } else {
    console.log('No changes — redfin-zips.ts is already up to date.');
  }
}

main().catch(err => {
  console.error('refresh-redfin FAILED:', err.message);
  process.exit(1);
});
