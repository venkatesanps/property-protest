#!/usr/bin/env node

/**
 * Test script for CAD evidence PDF parser
 * Usage: node test-pdf-parser.mjs /path/to/evidence.pdf
 */

import fs from 'fs';
import path from 'path';

const pdfPath = process.argv[2];

if (!pdfPath) {
  console.error('❌ Usage: node test-pdf-parser.mjs /path/to/cad-evidence.pdf');
  console.error('');
  console.error('Where to get it:');
  console.error('  Denton: https://www.dentoncad.com/public-portal/protest-cad-evidence');
  console.error('  Collin: Check your county CAD evidence portal');
  console.error('  Tarrant: Check your county CAD evidence portal');
  process.exit(1);
}

if (!fs.existsSync(pdfPath)) {
  console.error(`❌ File not found: ${pdfPath}`);
  process.exit(1);
}

const fileSize = fs.statSync(pdfPath).size;
console.log(`📄 Testing PDF: ${path.basename(pdfPath)} (${(fileSize / 1024).toFixed(1)} KB)`);
console.log('');

// Import parser (will fail since we're in Node, but that's okay for now)
console.log('🧪 PDF Parser Test Script');
console.log('═'.repeat(60));
console.log('');
console.log('Note: The parser uses pdfjs-dist which requires browser APIs.');
console.log('To test the parser:');
console.log('');
console.log('1. Open the live app: https://venkatesanps.github.io/property-protest/');
console.log('2. Run analysis for your property');
console.log('3. Scroll to "CAD Evidence Analysis" section');
console.log(`4. Upload the PDF: ${pdfPath}`);
console.log('');
console.log('The parser will:');
console.log('  ✓ Detect county (Denton/Collin/Tarrant)');
console.log('  ✓ Extract property ID, address, appraised value');
console.log('  ✓ Parse comparable tables (address, value, sqft, year, class)');
console.log('  ✓ Detect DCAD methodology (equity/market/cost/hybrid)');
console.log('  ✓ Find indicated values');
console.log('  ✓ Return confidence score (0-100%)');
console.log('');
console.log('Expected output:');
console.log('  - County: denton/collin/tarrant');
console.log('  - Property ID: extracted from PDF');
console.log('  - Equity comps: 3+ properties with values');
console.log('  - Indicated value: DCAD\'s calculated value');
console.log('  - Confidence: 70%+ if well-formatted');
console.log('');
console.log('═'.repeat(60));
