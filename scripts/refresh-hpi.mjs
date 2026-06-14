#!/usr/bin/env node
/**
 * Fetches the FHFA quarterly all-transactions metro HPI CSV and regenerates the
 * per-metro HPI tables in src/adapters/hpi.ts:
 *   • CBSA 19124 — Dallas-Plano-Irving (Collin/Denton)   -> DALLAS_HPI
 *   • CBSA 23104 — Fort Worth-Arlington-Grapevine (Tarrant) -> FORT_WORTH_HPI
 *
 * Run manually:  node scripts/refresh-hpi.mjs
 * Also run by:   .github/workflows/refresh-hpi.yml  (scheduled quarterly)
 *
 * Source: https://www.fhfa.gov/data/hpi/datasets
 * File:   hpi_at_metro.csv
 * Format (no header): "place_name",cbsa,year,quarter,index_nsa,index_sa
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Each table in hpi.ts is regenerated from one CBSA series.
const METROS = [
  { cbsa: 19124, varName: 'DALLAS_HPI' },      // Dallas-Plano-Irving, TX MSAD
  { cbsa: 23104, varName: 'FORT_WORTH_HPI' },  // Fort Worth-Arlington-Grapevine, TX MSAD
];
const CSV_URL      = 'https://www.fhfa.gov/hpi/download/quarterly_datasets/hpi_at_metro.csv';
const ROOT         = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HPI_FILE     = path.join(ROOT, 'src/adapters/hpi.ts');

// Each CSV row: "place name with, commas",cbsa,year,quarter,index_nsa,index_sa
// index_nsa is either a decimal number or "-" (data not available).
const ROW_RE = /^"[^"]+",(\d+),(\d{4}),([1-4]),([0-9]+\.[0-9]+)/;

async function fetchCsv() {
  const res = await fetch(CSV_URL);
  if (!res.ok) throw new Error(`FHFA download failed: HTTP ${res.status} ${res.url}`);
  return res.text();
}

function parse(csv, cbsaWanted) {
  /** @type {Map<string, number>} */
  const map = new Map();
  for (const line of csv.split('\n')) {
    const m = ROW_RE.exec(line.trim());
    if (!m) continue;
    const [, cbsa, yr, q, nsa] = m;
    if (Number(cbsa) !== cbsaWanted) continue;
    const val = parseFloat(nsa);
    if (!isFinite(val)) continue;
    map.set(`${yr}Q${q}`, val);
  }
  return map;
}

function renderHpiBlock(varName, map) {
  const keys = [...map.keys()].sort();
  if (keys.length === 0) throw new Error('Parsed map is empty — check CSV format.');

  // Four quarters per line, matching the hand-written style in hpi.ts
  const lines = [];
  for (let i = 0; i < keys.length; i += 4) {
    const chunk = keys.slice(i, i + 4);
    lines.push('  ' + chunk.map(k => `'${k}': ${map.get(k).toFixed(2)}`).join(', ') + ',');
  }
  return `const ${varName}: Record<string, number> = {\n${lines.join('\n')}\n};`;
}

function updateFile(varName, hpiBlock) {
  const src = readFileSync(HPI_FILE, 'utf8');
  const re = new RegExp(`const ${varName}: Record<string, number> = \\{[\\s\\S]*?\\};`);
  if (!re.test(src)) throw new Error(`Could not find ${varName} table in ${HPI_FILE}`);
  const next = src.replace(re, hpiBlock);
  if (next === src) return false;   // nothing changed
  writeFileSync(HPI_FILE, next, 'utf8');
  return true;
}

async function main() {
  console.log(`Fetching ${CSV_URL} …`);
  const csv = await fetchCsv();

  let anyChanged = false;
  for (const { cbsa, varName } of METROS) {
    const map  = parse(csv, cbsa);
    const keys = [...map.keys()].sort();
    if (keys.length === 0) {
      throw new Error(
        `No valid data found for CBSA ${cbsa}. ` +
        'Check that the CSV URL and column format are still correct.'
      );
    }
    const latest = keys[keys.length - 1];
    console.log(`CBSA ${cbsa}: ${keys.length} quarters ${keys[0]} → ${latest}  (index ${map.get(latest)})`);

    const changed = updateFile(varName, renderHpiBlock(varName, map));
    if (changed) {
      console.log(`✓ Updated ${varName} in ${HPI_FILE}`);
      anyChanged = true;
    } else {
      console.log(`No changes — ${varName} is already up to date.`);
    }
  }

  if (!anyChanged) console.log('hpi.ts is already up to date.');
}

main().catch(err => {
  console.error('refresh-hpi failed:', err.message);
  process.exit(1);
});
