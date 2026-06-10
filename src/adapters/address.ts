// ─── Shared address parsing ───────────────────────────────────────────────────
//
// Appraisal districts store the street NAME without the suffix (e.g. "ANGEL FALLS"
// not "ANGEL FALLS DR"). Users type the full thing. So we split off the building
// number and strip a trailing street suffix before matching.

const SUFFIXES = new Set([
  'ST', 'STREET', 'DR', 'DRIVE', 'RD', 'ROAD', 'LN', 'LANE', 'CT', 'COURT',
  'BLVD', 'BOULEVARD', 'AVE', 'AVENUE', 'WAY', 'CIR', 'CIRCLE', 'TRL', 'TRAIL',
  'PL', 'PLACE', 'PKWY', 'PARKWAY', 'CV', 'COVE', 'TER', 'TERRACE', 'LOOP',
  'RUN', 'PASS', 'BND', 'BEND', 'XING', 'CROSSING', 'PT', 'POINT', 'SQ', 'SQUARE',
]);

export interface ParsedAddress {
  bldgNum: string;
  streetName: string;
}

export function parseAddress(input: string): ParsedAddress {
  const clean = input
    .replace(/,.*$/, '') // drop city/state/zip after first comma
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');
  const parts = clean.split(' ');
  const bldgNum = parts[0] ?? '';
  let rest = parts.slice(1);
  // strip a trailing suffix token (keep at least one word of street name)
  while (rest.length > 1 && SUFFIXES.has(rest[rest.length - 1])) {
    rest = rest.slice(0, -1);
  }
  return { bldgNum, streetName: rest.join(' ') };
}

/** Escape a value for inclusion in a single-quoted SQL/SoQL string literal. */
export function sqlEscape(v: string): string {
  return v.replace(/'/g, "''");
}
