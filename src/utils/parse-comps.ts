/**
 * Bulk Comps Parser
 *
 * Parses CSV/TSV pasted data into comparable properties.
 * Expects columns: address, sqft (or living_area, sq_ft), price (or sale_price), year (or year_sold, sale_year)
 *
 * Examples:
 * - "973 ANGEL FALLS DR | 3228 | 780000 | 2016"
 * - "973 Angel Falls Dr, 3228, 780000, 2016"
 * - Tab-separated or comma-separated
 */

export interface ParsedComp {
  address: string;
  livingAreaSqft: number;
  price: number;
  yearSold: number;
}

export interface ParseResult {
  comps: ParsedComp[];
  errors: { row: number; error: string }[];
}

const SQFT_PATTERNS = ['sqft', 'sq_ft', 'sq ft', 'living_area', 'livingarea', 'area'];
const PRICE_PATTERNS = ['price', 'sale_price', 'saleprice', 'sales_price'];
const YEAR_PATTERNS = ['year', 'year_sold', 'yearsold', 'sale_year', 'saleyear'];

function parseNumber(val: string): number | null {
  const cleaned = val.replace(/[$,\s]/g, '').trim();
  const num = parseInt(cleaned, 10);
  return isNaN(num) ? null : num;
}

function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/\s+/g, '_');
}

function findColumnIndex(
  headers: string[],
  patterns: string[]
): number | null {
  for (let i = 0; i < headers.length; i++) {
    const normalized = normalizeHeader(headers[i]);
    if (patterns.some((p) => normalized.includes(p))) {
      return i;
    }
  }
  return null;
}

export function parseCompsFromPaste(pastedText: string): ParseResult {
  const comps: ParsedComp[] = [];
  const errors: { row: number; error: string }[] = [];

  const lines = pastedText
    .trim()
    .split('\n')
    .filter((line) => line.trim().length > 0);

  if (lines.length === 0) {
    return { comps, errors: [{ row: 0, error: 'No data provided' }] };
  }

  // Detect delimiter (tab or comma)
  const delimiter = lines[0].includes('\t') ? '\t' : ',';
  const headerLine = lines[0].split(delimiter).map((s) => s.trim());

  // Find column indices
  const addressIdx = 0; // Assume first column is always address
  const sqftIdx = findColumnIndex(headerLine, SQFT_PATTERNS);
  const priceIdx = findColumnIndex(headerLine, PRICE_PATTERNS);
  const yearIdx = findColumnIndex(headerLine, YEAR_PATTERNS);

  if (sqftIdx === null || priceIdx === null || yearIdx === null) {
    return {
      comps,
      errors: [
        {
          row: 0,
          error: `Could not find columns. Expected: address, [${SQFT_PATTERNS.join('|')}], [${PRICE_PATTERNS.join('|')}], [${YEAR_PATTERNS.join('|')}]`,
        },
      ],
    };
  }

  // Parse data rows (skip header)
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(delimiter).map((s) => s.trim());

    if (parts.length < Math.max(addressIdx, sqftIdx, priceIdx, yearIdx) + 1) {
      errors.push({ row: i + 1, error: 'Not enough columns' });
      continue;
    }

    const address = parts[addressIdx];
    const sqftStr = parts[sqftIdx];
    const priceStr = parts[priceIdx];
    const yearStr = parts[yearIdx];

    // Validate
    if (!address) {
      errors.push({ row: i + 1, error: 'Missing address' });
      continue;
    }

    const sqft = parseNumber(sqftStr);
    if (sqft === null || sqft < 500 || sqft > 10000) {
      errors.push({ row: i + 1, error: `Invalid sqft: "${sqftStr}" (must be 500-10000)` });
      continue;
    }

    const price = parseNumber(priceStr);
    if (price === null || price < 50000 || price > 5000000) {
      errors.push({ row: i + 1, error: `Invalid price: "${priceStr}" (must be $50k-$5m)` });
      continue;
    }

    const year = parseInt(yearStr, 10);
    if (isNaN(year) || year < 1980 || year > new Date().getFullYear()) {
      errors.push({ row: i + 1, error: `Invalid year: "${yearStr}" (must be 1980-${new Date().getFullYear()})` });
      continue;
    }

    comps.push({
      address: address.toUpperCase(),
      livingAreaSqft: sqft,
      price,
      yearSold: year,
    });
  }

  return { comps, errors };
}
