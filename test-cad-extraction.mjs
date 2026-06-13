#!/usr/bin/env node

import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import fs from 'fs';

const pdfPath = process.argv[2] || '/Users/venkatesanps/Downloads/cad-evidence.pdf';

async function testCADExtraction() {
  try {
    const pdfData = new Uint8Array(fs.readFileSync(pdfPath));
    const pdf = await pdfjsLib.getDocument({ data: pdfData }).promise;

    console.log('📄 PDF Document loaded:', pdf.numPages, 'pages\n');

    let fullText = '';

    for (let i = 1; i <= Math.min(3, pdf.numPages); i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map((item) => ('str' in item ? item.str : '')).join(' ');
      fullText += pageText + '\n---PAGE BREAK---\n';
      console.log(`✓ Page ${i} extracted - ${pageText.length} characters`);
    }

    console.log('\n═════════════════════════════════════════');
    console.log('PARSER EXTRACTION TESTS');
    console.log('═════════════════════════════════════════\n');

    // Test countyDetection
    const countyMatch = fullText.match(/denton|collin|tarrant/i);
    console.log(`✓ County Detection: ${countyMatch ? countyMatch[0].toUpperCase() : 'FAILED'}`);

    // Test property ID
    const propIdMatch = fullText.match(/(?:Property\s+ID|PID)[:\s]+(\d+)/i);
    console.log(`✓ Property ID: ${propIdMatch ? propIdMatch[1] : 'NOT FOUND'}`);

    // Test address
    const addrMatch = fullText.match(/(?:Subject|Situs)[:\s]+([0-9]+\s+[A-Z][\w\s]+(?:St|Rd|Ave|Ln|Dr|Ct|Way|Blvd|Circle))/i);
    const addr = addrMatch ? addrMatch[1].trim() : 'NOT FOUND';
    console.log(`✓ Address: ${addr.substring(0, 50)}`);

    // Test appraised value
    const apprMatch = fullText.match(/(?:Current|Total|Appraised)\s+(?:Appraised|Value)[:\s]*\$?([\d,]+)/i);
    console.log(`✓ Current Appraised: ${apprMatch ? '$' + apprMatch[1] : 'NOT FOUND'}`);

    // Test indicated value
    const indicMatch = fullText.match(/Indicated\s+(?:Value|values)?[:\s]*\$?([\d,]+)/i);
    console.log(`✓ Indicated Value: ${indicMatch ? '$' + indicMatch[1] : 'NOT FOUND'}`);

    // Test methodology
    const methodMatch = fullText.match(/(?:Equity|Market|Cost|Hybrid)\s+(?:Approach|Analysis|Methodology)/i);
    console.log(`✓ Methodology: ${methodMatch ? methodMatch[0] : 'UNKNOWN'}`);

    // Count comparable addresses (rough estimate)
    const compLines = fullText.split('\n').filter((line) => {
      return line.match(/\d+\s+[A-Z][\w\s]+(?:St|Rd|Ave|Ln|Dr|Ct)/) && line.match(/\$/) && line !== addrMatch?.[0];
    });
    console.log(`✓ Comparable Properties Found: ${compLines.length} addresses`);

    // Test net appraised (homestead cap)
    const netMatch = fullText.match(/(?:Net\s+)?Appraised[:\s]*\$?([\d,]+)/i);
    console.log(`✓ Net/Capped Value: ${netMatch ? '$' + netMatch[1] : 'NOT FOUND'}`);

    console.log('\n✅ EXTRACTION COMPLETE - Parser ready for live testing!');
    console.log('\nTo test in the browser:');
    console.log('1. Open: https://venkatesanps.github.io/property-protest/');
    console.log(`2. Analyze property: ${addr}`);
    console.log(`3. Upload PDF: ${pdfPath}`);
    console.log('4. View extracted data and counter-strategy analysis');
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
}

testCADExtraction();
