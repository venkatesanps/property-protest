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

  // Extract address (usually first substantial address in the document)
  match = fullText.match(
    /(?:Subject|Property|Situs)[:\s]+([0-9]+\s+[A-Z][\w\s]+(?:St|Rd|Ave|Ln|Dr|Ct|Way|Blvd))/i
  );
  if (match) data.subjectAddress = match[1].trim();

  // Extract current appraised value
  match = fullText.match(
    /(?:Current|Total|Appraised)\s+(?:Appraised|Value)[:\s]*\$?([\d,]+)/i
  );
  if (match) data.currentAppraised = parseInt(match[1].replace(/,/g, ''), 10);

  // Extract net appraised (homestead-capped) if present
  match = fullText.match(/(?:Net\s+)?Appraised[:\s]*\$?([\d,]+)/i);
  if (match) {
    const netVal = parseInt(match[1].replace(/,/g, ''), 10);
    if (netVal < data.currentAppraised) data.currentNetAppraised = netVal;
  }

  return data;
}

function extractComps(
  tables: ParsedTable[],
  method: 'equity' | 'market'
): CADComp[] {
  const comps: CADComp[] = [];

  for (const table of tables) {
    // Look for tables with address/value columns
    const addressCol = findColumn(table.headers, ['Address', 'Property', 'Situs']);
    const valueCol =
      method === 'equity'
        ? findColumn(table.headers, ['Appraised', 'Value', 'Assessment'])
        : findColumn(table.headers, ['Sale', 'Price', 'Value']);

    if (addressCol === -1 || valueCol === -1) continue;

    for (const row of table.rows) {
      const address = Object.values(row)[addressCol]?.trim();
      const valueStr = Object.values(row)[valueCol]?.replace(/[$,]/g, '');
      const value = valueStr ? parseInt(valueStr, 10) : undefined;

      if (address && value) {
        const comp: CADComp = { address, appraisedValue: value };

        // Try to extract sqft, year built, class
        const sqftCol = findColumn(table.headers, ['Sqft', 'Area', 'Living']);
        const yearCol = findColumn(table.headers, ['Year', 'Built']);
        const classCol = findColumn(table.headers, ['Class', 'Grade']);

        if (sqftCol !== -1) {
          const sqftStr = Object.values(row)[sqftCol]?.replace(/,/g, '');
          comp.livingAreaSqft = sqftStr ? parseInt(sqftStr, 10) : undefined;
        }
        if (yearCol !== -1) {
          const yearStr = Object.values(row)[yearCol];
          comp.yearBuilt = yearStr ? parseInt(yearStr, 10) : undefined;
        }
        if (classCol !== -1) {
          comp.qualityClass = Object.values(row)[classCol]?.trim();
        }

        comps.push(comp);
      }
    }

    // Found comps, no need to check other tables
    if (comps.length > 0) break;
  }

  return comps;
}

function findColumn(headers: string[], keywords: string[]): number {
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i].toUpperCase();
    if (keywords.some((k) => h.includes(k.toUpperCase()))) {
      return i;
    }
  }
  return -1;
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

  // Look for "Indicated Value" or similar
  let match = fullText.match(/Equity\s+(?:Indicated|Value)[:\s]*\$?([\d,]+)/i);
  if (match) equityIndicatedValue = parseInt(match[1].replace(/,/g, ''), 10);

  match = fullText.match(/Market\s+(?:Indicated|Value)[:\s]*\$?([\d,]+)/i);
  if (match) marketIndicatedValue = parseInt(match[1].replace(/,/g, ''), 10);

  // Detect methodology
  if (fullText.match(/Equity\s+(?:Approach|Analysis)/i)) valuationMethod = 'equity';
  else if (fullText.match(/Market\s+(?:Approach|Sales)/i)) valuationMethod = 'market-sales';
  else if (fullText.match(/Cost\s+(?:Approach|Analysis)/i)) valuationMethod = 'cost-approach';
  else if (fullText.match(/(?:Multiple|Hybrid|Combined)\s+Approaches?/i)) valuationMethod = 'hybrid';

  return { equityIndicatedValue, marketIndicatedValue, valuationMethod };
}

// ─── Public API ────────────────────────────────────────────────────────────────

export async function parseCADEvidencePDF(file: File): Promise<ExtractedCADEvidence> {
  const { fullText, tables } = await extractPdfText(file);

  const county = detectCounty(fullText);
  if (county === 'unsupported') {
    throw new Error(
      'Could not detect county from PDF. Supported: Denton, Collin, Tarrant. Check file and try again.'
    );
  }

  const propertyData = extractPropertyData(fullText);
  const equityComps = extractComps(tables, 'equity');
  const marketComps = extractComps(tables, 'market');
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
