// ─── App-wide constants ───────────────────────────────────────────────────────

/** Fallback combined property-tax rate for the Frisco/Denton-Collin area.
 *  Used only when the county is unknown; prefer {@link countyTaxRate}. */
export const TAX_RATE = 0.0179;

/** Texas protest deadline (or 30 days after the notice of appraised value). */
export const PROTEST_DEADLINE = 'May 15';

/** Texas Comptroller Notice of Protest form number. */
export const COMPTROLLER_FORM = '50-132';

export const DISCLAIMER =
  'Estimates only - not legal or tax advice. The Appraisal Review Board makes the final decision.';

// ─── Per-county appraisal-district info ───────────────────────────────────────
//
// One record per supported county: the appraisal-district name, where the owner
// searches/protests, and a typical combined effective tax rate used ONLY for
// savings estimates. Tax rates vary by city/ISD/MUD within each county — these
// are county-typical figures for an order-of-magnitude estimate, not a quote.

export type SupportedCounty = 'collin' | 'denton' | 'tarrant';

export interface CountyInfo {
  /** Full appraisal-district name with abbreviation. */
  cadName: string;
  /** Short abbreviation, e.g. "CCAD". */
  cadAbbr: string;
  /** Public property-search site. */
  propertySearchUrl: string;
  /** Where the owner files / tracks an online protest (district portal home). */
  onlineProtestUrl: string;
  /** Appraisal Review Board information page. */
  arbInfoUrl: string;
  /** County-typical combined effective property-tax rate, for ESTIMATES only. */
  effectiveTaxRate: number;
  /** When the district typically mails notices of appraised value. */
  noticesMailedTypical: string;
}

export const COUNTY_INFO: Record<SupportedCounty, CountyInfo> = {
  collin: {
    cadName: 'Collin Central Appraisal District (CCAD)',
    cadAbbr: 'CCAD',
    propertySearchUrl: 'https://www.collincad.org/propertysearch',
    onlineProtestUrl: 'https://www.collincad.org',
    arbInfoUrl: 'https://www.collincad.org',
    effectiveTaxRate: 0.018,
    noticesMailedTypical: 'mid-April',
  },
  denton: {
    cadName: 'Denton Central Appraisal District (DCAD)',
    cadAbbr: 'DCAD',
    propertySearchUrl: 'https://www.dentoncad.com',
    onlineProtestUrl: 'https://www.dentoncad.com',
    arbInfoUrl: 'https://www.dentoncad.com',
    effectiveTaxRate: 0.019,
    noticesMailedTypical: 'mid-April',
  },
  tarrant: {
    cadName: 'Tarrant Appraisal District (TAD)',
    cadAbbr: 'TAD',
    propertySearchUrl: 'https://tarrant.prodigycad.com/property-search',
    onlineProtestUrl: 'https://www.tad.org',
    arbInfoUrl: 'https://www.tad.org',
    effectiveTaxRate: 0.021,
    noticesMailedTypical: 'mid-April',
  },
};

/** County info with a safe fallback (Denton) when the county is unknown. */
export function countyInfo(county: string): CountyInfo {
  return COUNTY_INFO[county as SupportedCounty] ?? COUNTY_INFO.denton;
}

/** County-typical effective tax rate, falling back to {@link TAX_RATE}. */
export function countyTaxRate(county: string): number {
  return COUNTY_INFO[county as SupportedCounty]?.effectiveTaxRate ?? TAX_RATE;
}

/** "Collin County (CCAD)" style short label used in headings. */
export function countyLabel(county: string): string {
  const info = COUNTY_INFO[county as SupportedCounty];
  if (!info) return 'Denton County (DCAD)';
  const name = county.charAt(0).toUpperCase() + county.slice(1);
  return `${name} County (${info.cadAbbr})`;
}

// ─── Protest season ───────────────────────────────────────────────────────────

export type SeasonPhase =
  /** Jan 1 – May 15: notices arrive, protests can be filed. */
  | 'filing'
  /** May 16 – Aug 31: deadline passed for most; informal reviews + ARB hearings run. */
  | 'hearing'
  /** Sep 1 – Dec 31: records approved; only §25.25 corrections + next-year prep remain. */
  | 'planning';

/** Which phase of the Texas protest calendar we are in, and the tax year at issue. */
export function protestSeason(now = new Date()): { phase: SeasonPhase; taxYear: number } {
  const taxYear = now.getFullYear();
  const m = now.getMonth(); // 0-based
  const filing = m < 4 || (m === 4 && now.getDate() <= 15);
  const phase: SeasonPhase = filing ? 'filing' : m <= 7 ? 'hearing' : 'planning';
  return { phase, taxYear };
}
