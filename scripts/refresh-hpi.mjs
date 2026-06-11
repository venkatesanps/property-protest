#!/usr/bin/env node
/**
 * Fetches the FHFA quarterly all-transactions metro HPI CSV and regenerates
 * the HPI table in src/adapters/hpi.ts for CBSA 19124 (Dallas-Plano-Irving).
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

const CBSA         = 19124;   // Dallas-Plano-Irving, TX Metropolitan Statistical Area
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

function parse(csv) {
  /** @type {Map<string, number>} */
  const map = new Map();
  for (const line of csv.split('\n')) {
    const m = ROW_RE.exec(line.trim());
    if (!m) continue;
    const [, cbsa, yr, q, nsa] = m;
    if (Number(cbsa) !== CBSA) continue;
    const val = parseFloat(nsa);
    if (!isFinite(val)) continue;
    map.set(`${yr}Q${q}`, val);
  }
  return map;
}

function renderHpiBlock(map) {
  const keys = [...map.keys()].sort();
  if (keys.length === 0) throw new Error('Parsed map is empty — check CSV format.');

  // Four quarters per line, matching the hand-written style in hpi.ts
  const lines = [];
  for (let i = 0; i < keys.length; i += 4) {
    const chunk = keys.slice(i, i + 4);
    lines.push('  ' + chunk.map(k => `'${k}': ${map.get(k).toFixed(2)}`).join(', ') + ',');
  }
  return `const HPI: Record<string, number> = {\n${lines.join('\n')}\n};`;
}

function updateFile(hpiBlock) {
  const src = readFileSync(HPI_FILE, 'utf8');
  const next = src.replace(
    /const HPI: Record<string, number> = \{[\s\S]*?\};/,
    hpiBlock,
  );
  if (next === src) return false;   // nothing changed
  writeFileSync(HPI_FILE, next, 'utf8');
  return true;
}

async function main() {
  console.log(`Fetching ${CSV_URL} …`);
  const csv  = await fetchCsv();
  const map  = parse(csv);
  const keys = [...map.keys()].sort();

  if (keys.length === 0) {
    throw new Error(
      `No valid data found for CBSA ${CBSA}. ` +
      'Check that the CSV URL and column format are still correct.'
    );
  }

  const latest = keys[keys.length - 1];
  console.log(`Parsed ${keys.length} quarters: ${keys[0]} → ${latest}  (index ${map.get(latest)})`);

  const block   = renderHpiBlock(map);
  const changed = updateFile(block);

  if (changed) {
    console.log(`✓ Updated ${HPI_FILE}`);
  } else {
    console.log('No changes — hpi.ts is already up to date.');
  }
}

main().catch(err => {
  console.error('refresh-hpi failed:', err.message);
  process.exit(1);
});
