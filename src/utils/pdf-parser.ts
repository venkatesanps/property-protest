/**
 * CAD Evidence PDF Parser
 *
 * Extracts comparable properties, indicated values, and methodology from CAD
 * evidence packets. Supports Denton, Collin, and Tarrant County formats.
 *
 * Handles:
 * - Equity analysis (appraisal comps)
 * - Market sales analysis
 * - Subject property card data
 * - Indicated values and adjustments
 */

import type { County, ExtractedCADEvidence, CADComp } from '../types';
import * as pdfjsLib from 'pdfjs-dist';

// Set up the worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

// ─── Types ────────────────────────────────────────────────────────────────────

interface ParsedTable {
  headers: string[];
  rows: Record<string, string>[];
}

interface ParsedPdf {
  fullText: string;
  tables: ParsedTable[];
  images: number; // count of images found
}

// ─── PDF Text Extraction ──────────────────────────────────────────────────────

async function extractPdfText(file: File): Promise<ParsedPdf> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  let fullText = '';
  let imageCount = 0;
  const tables: ParsedTable[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();

    // Extract text (line by line)
    let currentLine = '';
    let lastY = -1;

    for (const item of textContent.items) {
      if ('str' in item && 'transform' in item) {
        const textItem = item as any;
        const str = textItem.str as string;
        const y = textItem.transform?.[5] ?? 0;
        // Detect line breaks
        if (lastY !== -1 && Math.abs(y - lastY) > 5) {
          if (currentLine.trim()) fullText += currentLine + '\n';
          currentLine = '';
        }
        currentLine += str + ' ';
        lastY = y;
      }
    }
    if (currentLine.trim()) fullText += currentLine + '\n';

    // Try to extract tables from this page (basic heuristic)
    // Look for rows with multiple values separated by significant gaps
    const pageText = fullText.split('\n').slice(-50); // Last 50 lines of this page
    const possibleTables = detectTableStructure(pageText);
    tables.push(...possibleTables);
  }

  return { fullText, tables, images: imageCount };
}

// ─── Table Detection (Heuristic) ───────────────────────────────────────────────

function detectTableStructure(lines: string[]): ParsedTable[] {
  const tables: ParsedTable[] = [];
  let currentTable: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    // Lines with multiple numbers/dollars likely part of a table
    if (trimmed && (trimmed.match(/\d/g) || trimmed.match(/\$/g))) {
      currentTable.push(trimmed);
    } else if (currentTable.length > 0) {
      // End of table
      const table = parseTableLines(currentTable);
      if (table.rows.length >= 2) tables.push(table);
      currentTable = [];
    }
  }

  if (currentTable.length > 0) {
    const table = parseTableLines(currentTable);
    if (table.rows.length >= 2) tables.push(table);
  }

  return tables;
}

function parseTableLines(lines: string[]): ParsedTable {
  if (lines.length < 2) return { headers: [], rows: [] };

  // First line is usually headers
  const headerLine = lines[0];
  const headers = headerLine
    .split(/\s{2,}/) // Split on 2+ spaces
    .map((h) => h.trim())
    .filter((h) => h.length > 0);

  const rows: Record<string, string>[] = [];

  // Parse data rows
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const cells = line.split(/\s{2,}/).map((c) => c.trim());

    if (cells.length >= headers.length / 2) {
      // At least half the headers have data
      const row: Record<string, string> = {};
      headers.forEach((header, idx) => {
        row[header] = cells[idx] || '';
      });
      rows.push(row);
    }
  }

  return { headers, rows };
}

// ─── CAD-Specific Parsing ──────────────────────────────────────────────────────

function detectCounty(fullText: string): County {
  const text = fullText.toUpperCase();
  if (text.includes('DENTON') || text.includes('DENTONCAD') || text.includes('DCAD')) {
    return 'denton';
  }
  if (text.includes('COLLIN')) {
    return 'collin';
  }
  if (text.includes('TARRANT') || text.includes('TCAD')) {
    return 'tarrant';
  }
  return 'unsupported';
}

function extractPropertyData(fullText: string): {
  propertyId: string;
  subjectAddress: string;
  currentAppraised: number;
  currentNetAppraised: number | null;
} {
  const data = {
    propertyId: '',
    subjectAddress: '',
    currentAppraised: 0,
    currentNetAppraised: null as number | null,
  };

  // Extract property ID (usually "Property ID: XXXXXX" or "PID: XXXXXX")
  let match = fullText.match(/(?:Property\s+ID|PID)[:\s]+(\d+)/i);
  if (match) data.propertyId = match[1];

  // Extract address (usually "SITUS : address" or "Subject: address")
  match = fullText.match(/SITUS\s*:\s*([0-9]+\s+[A-Z][\w\s]+(?:St|Rd|Ave|Ln|Dr|Ct|Way|Blvd))/i);
  if (!match) {
    match = fullText.match(
      /(?:Subject|Property)[:\s]+([0-9]+\s+[A-Z][\w\s]+(?:St|Rd|Ave|Ln|Dr|Ct|Way|Blvd))/i
    );
  }
  if (match) data.subjectAddress = match[1].trim();

  // Extract current appraised value (often appears with living area like "0.1452  $836,185")
  // Look for patterns: large dollar amounts, often after property characteristics
  const dollarPattern = /\$\s*([\d,]+)/g;
  const dollarMatches = Array.from(fullText.matchAll(dollarPattern));

  if (dollarMatches.length > 0) {
    // The subject property's appraised value is often one of the larger values
    // Usually around 4-6 values in and typically > $200k for residential
    const dollarValues = dollarMatches.map((m) => parseInt(m[1].replace(/,/g, ''), 10));
    const residential = dollarValues.filter((v) => v > 100000 && v < 5000000);
    if (residential.length > 0) {
      // The highest value close to median is likely the appraised value
      const sorted = [...residential].sort((a, b) => a - b);
      data.currentAppraised = sorted[Math.floor(sorted.length / 2)];
    }
  }

  // Extract net appraised: usually 8-10% lower than current appraised (homestead cap)
  const halfValue = Math.floor(data.currentAppraised * 0.9);
  if (fullText.match(new RegExp(`\\$\\s*${halfValue.toLocaleString('en-US').replace(/,/g, '[,\\s]*')}`))) {
    data.currentNetAppraised = halfValue;
  }

  return data;
}

function extractComps(fullText: string, method: 'equity' | 'market'): CADComp[] {
  const comps: CADComp[] = [];

  // Split by "Comp 1", "Comp 2", etc. for structured data
  const sectionPattern =
    method === 'equity'
      ? /SUBJECT\s+EQUITY\s+ANALYSIS([\s\S]*?)(?=COMPARABLE|$)/i
      : /COMPARABLE\s+SALES\s+ANALYSIS([\s\S]*?)(?=SUBJECT|$)/i;

  const sectionMatch = fullText.match(sectionPattern);
  if (!sectionMatch) return comps;

  const section = sectionMatch[1];

  // Look for address patterns: "XXX STREET_NAME CITY STATE"
  const addressPattern = /(\d+\s+[A-Z][\w\s]+(?:ST|RD|AVE|LN|DR|CT|WAY|BLVD|CIRCLE))\s+([A-Z]+)\s+(TX|OK)/gi;
  const addresses = Array.from(section.matchAll(addressPattern));

  for (const addressMatch of addresses) {
    const address = `${addressMatch[1]} ${addressMatch[2]} ${addressMatch[3]}`;

    // Find dollar amounts near this address
    const contextStart = Math.max(0, section.indexOf(addressMatch[0]) - 200);
    const contextEnd = Math.min(section.length, section.indexOf(addressMatch[0]) + 300);
    const context = section.substring(contextStart, contextEnd);

    const comp: CADComp = { address: address.trim() };

    // Extract appraised/equity value
    const apprPattern = /\$\s*([\d,]+)/g;
    const apprMatches = Array.from(context.matchAll(apprPattern)).map((m) =>
      parseInt(m[1].replace(/,/g, ''), 10)
    );

    if (method === 'equity' && apprMatches.length > 0) {
      // For equity, take the first large value near the address
      comp.appraisedValue = apprMatches[0];
    } else if (method === 'market' && apprMatches.length > 0) {
      // For market/sales, take the last (usually sale price)
      comp.salePrice = apprMatches[apprMatches.length - 1];
    }

    // Extract sqft (usually 3-4 digit number)
    const sqftMatch = context.match(/(\d{3,4}(?:\.\d+)?)\s+(?:living|sqft|area)/i) ||
      context.match(/(\d{3,4})\s+[A-Z]/);
    if (sqftMatch) comp.livingAreaSqft = parseInt(sqftMatch[1], 10);

    // Extract year built (YYYY or YY/YY format)
    const yearMatch = context.match(/(\d{4})\s*\/\s*(\d{4})|(\d{4})\s+/);
    if (yearMatch) comp.yearBuilt = parseInt(yearMatch[1] || yearMatch[3], 10);

    // Extract class (usually 3-4 letter code)
    const classMatch = context.match(/(VB\d|RA|RB|RC|UD)\s/);
    if (classMatch) comp.qualityClass = classMatch[1];

    if (comp.appraisedValue || comp.salePrice) {
      comps.push(comp);
    }
  }

  return comps;
}


function extractIndicatedValues(fullText: string): {
  equityIndicatedValue: number | null;
  marketIndicatedValue: number | null;
  valuationMethod: 'cost-approach' | 'market-sales' | 'equity' | 'hybrid' | 'unknown';
} {
  let equityIndicatedValue: number | null = null;
  let marketIndicatedValue: number | null = null;
  let valuationMethod: 'cost-approach' | 'market-sales' | 'equity' | 'hybrid' | 'unknown' =
    'unknown';

  // Look for "COMPARABLE SALES ANALYSIS" section with median
  let match = fullText.match(/COMPARABLE\s+SALES\s+ANALYSIS.*?Median\s*\$?([\d,]+)/is);
  if (match) marketIndicatedValue = parseInt(match[1].replace(/,/g, ''), 10);

  // Look for "EQUITY ANALYSIS" section with median
  match = fullText.match(/EQUITY\s+(?:ANALYSIS|COMPARABLES).*?Median\s*\$?([\d,]+)/is);
  if (match) equityIndicatedValue = parseInt(match[1].replace(/,/g, ''), 10);

  // Alternative: look for explicit "Indicated Value" patterns
  if (!equityIndicatedValue) {
    match = fullText.match(/Equity.*?Indicated.*?\$?([\d,]+)/is);
    if (match) equityIndicatedValue = parseInt(match[1].replace(/,/g, ''), 10);
  }

  if (!marketIndicatedValue) {
    match = fullText.match(/Market.*?Indicated.*?\$?([\d,]+)/is);
    if (match) marketIndicatedValue = parseInt(match[1].replace(/,/g, ''), 10);
  }

  // Detect methodology - check for section headings
  if (fullText.match(/SUBJECT\s+EQUITY\s+ANALYSIS/i)) valuationMethod = 'equity';
  else if (fullText.match(/COMPARABLE\s+SALES\s+ANALYSIS/i)) valuationMethod = 'market-sales';
  else if (fullText.match(/COST\s+(?:APPROACH|ANALYSIS)/i)) valuationMethod = 'cost-approach';

  // If both present, it's hybrid
  if (equityIndicatedValue && marketIndicatedValue) valuationMethod = 'hybrid';

  return { equityIndicatedValue, marketIndicatedValue, valuationMethod };
}

// ─── Public API ────────────────────────────────────────────────────────────────

export async function parseCADEvidencePDF(file: File): Promise<ExtractedCADEvidence> {
  const { fullText } = await extractPdfText(file);

  const county = detectCounty(fullText);
  if (county === 'unsupported') {
    throw new Error(
      'Could not detect county from PDF. Supported: Denton, Collin, Tarrant. Check file and try again.'
    );
  }

  const propertyData = extractPropertyData(fullText);
  const equityComps = extractComps(fullText, 'equity');
  const marketComps = extractComps(fullText, 'market');
  const { equityIndicatedValue, marketIndicatedValue, valuationMethod } =
    extractIndicatedValues(fullText);

  // Confidence score (0-1): based on how complete the extraction was
  let confidence = 0.5;
  if (propertyData.propertyId) confidence += 0.1;
  if (propertyData.subjectAddress) confidence += 0.1;
  if (propertyData.currentAppraised > 0) confidence += 0.1;
  if (equityComps.length >= 2 || marketComps.length >= 2) confidence += 0.2;

  const extractionNotes: string[] = [];
  if (!propertyData.propertyId) extractionNotes.push('Property ID not found');
  if (equityComps.length === 0 && marketComps.length === 0) {
    extractionNotes.push('No comparable properties found in tables');
  }
  if (valuationMethod === 'unknown') extractionNotes.push('Could not detect valuation methodology');

  return {
    county,
    propertyId: propertyData.propertyId,
    subjectAddress: propertyData.subjectAddress,
    currentAppraised: propertyData.currentAppraised,
    currentNetAppraised: propertyData.currentNetAppraised,
    homesteadCap: propertyData.currentNetAppraised
      ? propertyData.currentAppraised - propertyData.currentNetAppraised
      : null,
    equityComps,
    equityIndicatedValue: equityIndicatedValue ?? undefined,
    marketComps,
    marketIndicatedValue: marketIndicatedValue ?? undefined,
    valuationMethod,
    adjustmentDetails: {}, // TODO: extract from text patterns
    extractedAt: new Date().toISOString(),
    confidence,
    extractionNotes,
  };
}
