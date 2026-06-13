#!/usr/bin/env node

import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import fs from 'fs';

const pdfPath = process.argv[2] || '/Users/venkatesanps/Downloads/cad-evidence.pdf';

async function debugPDF() {
  try {
    const pdfData = new Uint8Array(fs.readFileSync(pdfPath));
    const pdf = await pdfjsLib.getDocument({ data: pdfData }).promise;

    console.log('📄 Extracting full text from all pages...\n');

    let fullText = '';

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map((item) => ('str' in item ? item.str : '')).join(' ');
      fullText += `\n═══ PAGE ${i} ═══\n` + pageText;
    }

    // Print first 3000 characters to see structure
    console.log(fullText.substring(0, 3000));
    console.log('\n...[truncated]...\n');

    // Extract key patterns
    console.log('\n═════════════════════════════════════════');
    console.log('KEY PATTERNS TO MATCH');
    console.log('═════════════════════════════════════════\n');

    // Look for dollar amounts
    const dollarMatch = fullText.match(/\$?\s*[\d,]+(?:\.\d{2})?/g) || [];
    console.log('Dollar amounts found:', dollarMatch.slice(0, 10).join(', '));

    // Look for "Value" mentions
    const valueMatches = fullText.match(/[A-Z][^.!?]*Value[^.!?]*/g) || [];
    console.log('\nValue mentions:');
    valueMatches.slice(0, 5).forEach((match) => console.log(' -', match.trim().substring(0, 80)));

    // Look for "Indicated"
    const indicatedMatches = fullText.match(/[A-Z][^.!?]*Indicated[^.!?]*/g) || [];
    console.log('\nIndicated mentions:');
    indicatedMatches.forEach((match) => console.log(' -', match.trim().substring(0, 100)));

    // Look for table-like content (multiple spaces)
    const tableLines = fullText
      .split('\n')
      .filter((line) => line.match(/\s{2,}\d+/) || (line.match(/\$/) && line.match(/\d{4}$/)));
    console.log('\nPossible table rows:', tableLines.length);
    if (tableLines.length > 0) {
      console.log('Sample rows:');
      tableLines.slice(0, 5).forEach((line) => console.log(' -', line.substring(0, 100)));
    }
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
}

debugPDF();
