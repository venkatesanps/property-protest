/**
 * Tarrant Appraisal District adapter
 *
 * Data source: TAD's own ArcGIS FeatureServer (browser-direct JSON).
 * Service: tad.newedgeservices.com/arcgis/rest/services/Hosted/TADMap/FeatureServer/0
 * Records: 715k+ — full Tarrant County appraisal roll, updated live.
 *
 * CORS: The TAD ArcGIS server sends permissive CORS headers for all origins.
 * No API key required.
 *
 * Field notes:
 * - applclasscd: property class code. 'A1' = SFR, 'B' = condo/townhome.
 *   Stored with trailing space padding — use LIKE 'X%' when filtering.
 * - nbhdcd: 6-char neighborhood code, padded. Used for the comp pool.
 * - totalmarketvalue: TAD's total market value. Used as the appraised value
 *   because the ArcGIS layer does not expose the homestead-capped appraised
 *   value separately. Cap floor check shows "unavailable" for Tarrant.
 * - actualarea: heated living area in square feet.
 */

import type { SubjectProperty, Comp } from '../types';
import { parseAddress, sqlEscape } from './address';

const BASE =
  'https://tad.newedgeservices.com/arcgis/rest/services/Hosted/TADMap/FeatureServer/0/query';

const PAGE = 2000;

interface TarrantAttrs {
  pin?: string;
  situsaddress?: string;
  yearbuilt?: number;
  actualarea?: number;
  nbhdcd?: string;
  applclasscd?: string;
  landmarketvalue?: number;
  improvementmarketvalue?: number;
  totalmarketvalue?: number;
  taxyear?: number;
}

interface ArcGisFeature {
  attributes: TarrantAttrs;
  /** Parcel centroid in WGS84 when returnCentroid=true & outSR=4326. */
  centroid?: { x: number; y: number };
}

interface ArcGisResponse {
  features?: ArcGisFeature[];
  error?: { message?: string };
}

const SUBJECT_FIELDS =
  'pin,situsaddress,yearbuilt,actualarea,nbhdcd,applclasscd,' +
  'landmarketvalue,improvementmarketvalue,totalmarketvalue,taxyear';

const COMP_FIELDS =
  'pin,situsaddress,actualarea,yearbuilt,applclasscd,' +
  'landmarketvalue,improvementmarketvalue,totalmarketvalue';

// SFR (A1) and condo/townhome (B) — both padded, so use LIKE
const RESI_FILTER = "(applclasscd LIKE 'A1%' OR applclasscd LIKE 'B%')";

const n = (v?: number): number => (typeof v === 'number' ? v : 0);

async function query(
  where: string,
  outFields: string,
  offset = 0,
  withCentroid = false
): Promise<ArcGisFeature[]> {
  const url = new URL(BASE);
  url.searchParams.set('where', where);
  url.searchParams.set('outFields', outFields);
  url.searchParams.set('returnGeometry', 'false');
  if (withCentroid) {
    url.searchParams.set('returnCentroid', 'true');
    url.searchParams.set('outSR', '4326');
  }
  url.searchParams.set('resultOffset', String(offset));
  url.searchParams.set('resultRecordCount', String(PAGE));
  url.searchParams.set('f', 'json');

  const resp = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
  if (!resp.ok) throw new Error(`TAD ArcGIS error ${resp.status}`);
  const data = (await resp.json()) as ArcGisResponse;
  if (data.error) throw new Error(`TAD ArcGIS: ${data.error.message ?? 'query failed'}`);
  return data.features ?? [];
}

function toSubject(f: ArcGisFeature): SubjectProperty {
  const a = f.attributes;
  const market = n(a.totalmarketvalue);
  return {
    account: (a.pin ?? '').trim(),
    address: (a.situsaddress ?? '').trim(),
    county: 'tarrant',
    livingAreaSqft: n(a.actualarea),
    yearBuilt: n(a.yearbuilt),
    qualityClass: (a.applclasscd ?? '').trim(),
    neighborhoodCode: (a.nbhdcd ?? '').trim(),
    stateClass: (a.applclasscd ?? '').trim().slice(0, 2),
    // TADMap only publishes market values; appraised value (possibly homestead-
    // capped) is not exposed. We use market value as a proxy; for most owners
    // the values are equal, and those with an active homestead cap are already
    // taxed below market value, making a protest less likely.
    appraisedValue: market,
    marketValue: market,
    netAppraisedValue: null,
    homesteadCapAmount: null,
    landValue: n(a.landmarketvalue),
    improvementValue: n(a.improvementmarketvalue),
    priorYearValue: null,
    rollYear: a.taxyear ?? null,
    rollLabel: 'Tarrant CAD live roll',
    exemptions: null,
    lat: f.centroid?.y ?? null,
    lng: f.centroid?.x ?? null,
  };
}

function toComp(a: TarrantAttrs): Comp {
  const sqft = n(a.actualarea);
  const appraised = n(a.totalmarketvalue);
  return {
    account: (a.pin ?? '').trim(),
    address: (a.situsaddress ?? '').trim(),
    county: 'tarrant',
    livingAreaSqft: sqft,
    yearBuilt: n(a.yearbuilt),
    qualityClass: (a.applclasscd ?? '').trim(),
    appraisedValue: appraised,
    pricePerSqft: sqft > 0 ? appraised / sqft : 0,
    landValue: n(a.landmarketvalue),
    improvementValue: n(a.improvementmarketvalue),
    isRefined: false,
  };
}

/**
 * Look up a single Tarrant property by street address.
 * Strips the suffix token (parseAddress) and uses a LIKE prefix match, which
 * handles "123 Main St" and "123 Main" equally against "123 MAIN ST".
 */
export async function fetchTarrantSubject(address: string): Promise<SubjectProperty> {
  const { bldgNum, streetName } = parseAddress(address);
  const pattern = sqlEscape(`${bldgNum} ${streetName}`);

  let feats = await query(
    `situsaddress LIKE '${pattern}%' AND ${RESI_FILTER}`,
    SUBJECT_FIELDS,
    0,
    true
  );
  // Broaden to all property types if the residential filter matched nothing.
  if (feats.length === 0) {
    feats = await query(`situsaddress LIKE '${pattern}%'`, SUBJECT_FIELDS, 0, true);
  }
  if (feats.length === 0) {
    throw new Error(
      `No Tarrant County property found for "${address}". Check the address and try again.`
    );
  }
  return toSubject(feats[0]);
}

/** Exact lookup by pin — used when an autocomplete suggestion was selected. */
export async function fetchTarrantSubjectByAccount(pin: string): Promise<SubjectProperty> {
  const escaped = sqlEscape(pin.trim());
  // The pin field is padded with trailing spaces; LIKE handles that.
  const feats = await query(`pin LIKE '${escaped}%'`, SUBJECT_FIELDS, 0, true);
  if (feats.length === 0) {
    throw new Error(`Tarrant County property ${pin} could not be loaded.`);
  }
  return toSubject(feats[0]);
}

/**
 * Fetch the comp pool: all A1/B properties in the same TAD neighborhood,
 * with living area and market value both > 0.
 */
export async function fetchTarrantComps(
  neighborhoodCode: string,
  subjectAccount: string,
  limit = 500
): Promise<Comp[]> {
  const nbhd = sqlEscape(neighborhoodCode);
  const where =
    `nbhdcd LIKE '${nbhd}%' AND ${RESI_FILTER} AND actualarea>0 AND totalmarketvalue>0`;

  const all: TarrantAttrs[] = [];
  let offset = 0;
  for (;;) {
    const pageRows = await query(where, COMP_FIELDS, offset);
    all.push(...pageRows.map((f) => f.attributes));
    if (pageRows.length < PAGE || all.length >= limit) break;
    offset += PAGE;
  }
  return all
    .map(toComp)
    .filter((c) => c.account !== subjectAccount)
    .slice(0, limit);
}
