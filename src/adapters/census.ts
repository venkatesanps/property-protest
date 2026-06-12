/**
 * Census Geocoder adapter
 *
 * Uses the free US Census Bureau geocoder — no API key required.
 * Endpoint: https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress
 *
 * CORS NOTE: The Census geocoder does NOT send CORS headers that allow
 * browser-side fetch from non-census origins. Requests from a GitHub Pages
 * domain will be blocked by the browser's same-origin policy.
 *
 * Workaround used here: we try a direct fetch first; if it fails with a
 * network/CORS error we fall back to a manual county-selection prompt so
 * the app remains fully functional without a backend.
 *
 * If you control a server or a Cloudflare Worker, proxy the Census URL
 * through it and set CENSUS_PROXY_URL in vite's .env.local.
 */

import type { GeocodeResult, County } from '../types';

const CENSUS_BASE =
  'https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress';

const COUNTY_FIPS_MAP: Record<string, County> = {
  '48085': 'collin',
  '48121': 'denton',
  '48439': 'tarrant',
};

export async function geocodeAddress(address: string): Promise<GeocodeResult> {
  const url = new URL(CENSUS_BASE);
  url.searchParams.set('address', address);
  url.searchParams.set('benchmark', 'Public_AR_Current');
  url.searchParams.set('vintage', 'Current_Current');
  url.searchParams.set('format', 'json');

  let data: unknown;
  try {
    const resp = await fetch(url.toString());
    if (!resp.ok) throw new Error(`Census HTTP ${resp.status}`);
    data = await resp.json();
  } catch (err) {
    // CORS or network failure — surface a user-friendly message
    throw new CensusCorsBridgeError(
      'The Census geocoder is not reachable from the browser (CORS restriction). ' +
        'Please select your county manually below.',
      err
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = (data as any)?.result;
  const matches = result?.addressMatches;
  if (!Array.isArray(matches) || matches.length === 0) {
    throw new Error(
      `Address not found. Try a more specific address (e.g., "123 Main St, Frisco, TX 75034").`
    );
  }

  const match = matches[0];
  const coords = match.coordinates;
  const lat = parseFloat(coords?.y);
  const lng = parseFloat(coords?.x);

  // County GEOID is in geographies.Counties[0].GEOID — a 5-digit FIPS
  const counties: unknown[] = match.geographies?.Counties ?? [];
  if (counties.length === 0) {
    throw new Error('Could not determine county from geocoder response.');
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const countyGeo = counties[0] as any;
  const stateFp: string = countyGeo.STATE ?? '';
  const countyFp: string = countyGeo.COUNTY ?? '';
  const fips = stateFp + countyFp; // e.g. "48085"

  const county: County = COUNTY_FIPS_MAP[fips] ?? 'unsupported';

  return {
    address: match.matchedAddress ?? address,
    lat,
    lng,
    countyFips: fips,
    county,
    state: stateFp,
  };
}

/** Thrown when the Census geocoder cannot be reached (typically CORS). */
export class CensusCorsBridgeError extends Error {
  readonly originalError?: unknown;
  constructor(message: string, originalError?: unknown) {
    super(message);
    this.name = 'CensusCorsBridgeError';
    this.originalError = originalError;
  }
}

/** Resolve a county from user-selected zip code (offline fallback). */
export function countyFromZip(zip: string): County {
  const collinZips = ['75033', '75034', '75035', '75071', '75072', '75070'];
  const dentonZips = ['75036', '76226', '76227', '76247'];
  // Representative Tarrant County ZIPs (Fort Worth, Arlington, NRH, Keller, etc.)
  const tarrantZips = [
    '76001','76002','76006','76010','76011','76012','76013','76014','76015','76016',
    '76017','76018','76019','76020',
    '76021','76022','76034','76036','76039','76040','76051','76052','76053','76054',
    '76063','76071','76092','76102','76103','76104','76105','76106','76107','76108',
    '76109','76110','76111','76112','76114','76115','76116','76117','76118','76119',
    '76120','76123','76126','76127','76131','76132','76133','76134','76135','76137',
    '76140','76148','76155','76161','76164','76177','76179','76180','76182','76244','76248',
  ];
  if (collinZips.includes(zip)) return 'collin';
  if (dentonZips.includes(zip)) return 'denton';
  if (tarrantZips.includes(zip)) return 'tarrant';
  return 'unsupported';
}
