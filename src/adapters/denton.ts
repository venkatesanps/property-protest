/**
 * Denton Central Appraisal District adapter
 *
 * Data source: Denton County ArcGIS REST FeatureServer (browser-direct JSON).
 * Layer: Parcels_FC/MapServer/0 — full appraisal roll with values + characteristics.
 *
 * CORS: ArcGIS REST services send permissive CORS headers; browser fetch works.
 * No API key required. maxRecordCount is 2000, so comp pulls paginate.
 *
 * Unlike Collin, Denton DOES expose the homestead-capped (net appraised) value.
 */

import type { SubjectProperty, Comp } from '../types';
import { parseAddress, sqlEscape } from './address';

const BASE =
  'https://gis.dentoncounty.gov/arcgis/rest/services/Parcels_FC/MapServer/0/query';
const PAGE = 2000;

interface DentonAttrs {
  pid?: number;
  situs_full_address?: string;
  ownerMarketValue?: number;
  ownerAppraisedValue?: number;
  ownerNetAppraisedValue?: number;
  ownerHSTaxLimitationValue?: number;
  improvementValue?: number;
  landHSValue?: number;
  landNHSValue?: number;
  imprvMainArea?: number;
  imprvActualYearBuilt?: number;
  imprvClasses?: string;
  asCode?: string;
  stateCodes?: string;
  abstractSubdivisionDescription?: string;
  geoID?: string;
  exemptions?: string;
}

interface ArcGisFeature {
  attributes: DentonAttrs;
  /** Parcel centroid, present when the query asks for it (outSR=4326 → lng/lat). */
  centroid?: { x: number; y: number };
}

interface ArcGisResponse {
  features?: ArcGisFeature[];
  error?: { message?: string };
}

const SUBJECT_FIELDS =
  'pid,situs_full_address,ownerMarketValue,ownerAppraisedValue,ownerNetAppraisedValue,' +
  'ownerHSTaxLimitationValue,improvementValue,landHSValue,landNHSValue,imprvMainArea,' +
  'imprvActualYearBuilt,imprvClasses,asCode,stateCodes,abstractSubdivisionDescription,geoID,exemptions';

const COMP_FIELDS =
  'pid,situs_full_address,imprvMainArea,imprvActualYearBuilt,imprvClasses,ownerAppraisedValue,' +
  'improvementValue,landHSValue,landNHSValue';

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
    // Parcel centroid in WGS84 — feeds the FEMA flood-zone lookup without
    // needing the (CORS-blocked) Census geocoder. Ignored by older servers.
    url.searchParams.set('returnCentroid', 'true');
    url.searchParams.set('outSR', '4326');
  }
  url.searchParams.set('resultOffset', String(offset));
  url.searchParams.set('resultRecordCount', String(PAGE));
  url.searchParams.set('f', 'json');

  const resp = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
  if (!resp.ok) throw new Error(`Denton ArcGIS error ${resp.status}`);
  const data = (await resp.json()) as ArcGisResponse;
  if (data.error) throw new Error(`Denton ArcGIS: ${data.error.message ?? 'query failed'}`);
  return data.features ?? [];
}

function toSubject(f: ArcGisFeature): SubjectProperty {
  const a = f.attributes;
  return {
    account: String(a.pid ?? ''),
    address: a.situs_full_address ?? '',
    county: 'denton',
    livingAreaSqft: n(a.imprvMainArea),
    yearBuilt: n(a.imprvActualYearBuilt),
    qualityClass: a.imprvClasses ?? '',
    neighborhoodCode: a.asCode ?? '',
    stateClass: a.stateCodes ?? '',
    appraisedValue: n(a.ownerAppraisedValue),
    marketValue: n(a.ownerMarketValue),
    netAppraisedValue: a.ownerNetAppraisedValue == null ? null : n(a.ownerNetAppraisedValue),
    homesteadCapAmount: a.ownerHSTaxLimitationValue == null ? null : n(a.ownerHSTaxLimitationValue),
    landValue: n(a.landHSValue) + n(a.landNHSValue),
    improvementValue: n(a.improvementValue),
    // Denton's ArcGIS service does not expose lot size or a pool flag here.
    lotSizeSqft: null,
    hasPool: null,
    priorYearValue: null,
    // The ArcGIS service serves the live roll and updates in place; the current
    // tax year's values appear as DCAD loads them.
    rollYear: new Date().getFullYear(),
    rollLabel: 'Denton CAD live roll',
    exemptions: a.exemptions ?? null,
    lat: f.centroid?.y ?? null,
    lng: f.centroid?.x ?? null,
  };
}

function toComp(a: DentonAttrs): Comp {
  const sqft = n(a.imprvMainArea);
  const appraised = n(a.ownerAppraisedValue);
  return {
    account: String(a.pid ?? ''),
    address: a.situs_full_address ?? '',
    county: 'denton',
    livingAreaSqft: sqft,
    yearBuilt: n(a.imprvActualYearBuilt),
    qualityClass: a.imprvClasses ?? '',
    appraisedValue: appraised,
    pricePerSqft: sqft > 0 ? appraised / sqft : 0,
    landValue: n(a.landHSValue) + n(a.landNHSValue),
    improvementValue: n(a.improvementValue),
    isRefined: false,
  };
}

export async function fetchDentonSubject(address: string): Promise<SubjectProperty> {
  const { bldgNum, streetName } = parseAddress(address);
  const pattern = sqlEscape(`${bldgNum} ${streetName}`);

  let feats = await query(
    `situs_full_address LIKE '${pattern}%' AND stateCodes='A1'`,
    SUBJECT_FIELDS,
    0,
    true
  );
  if (feats.length === 0) {
    feats = await query(`situs_full_address LIKE '${pattern}%'`, SUBJECT_FIELDS, 0, true);
  }
  if (feats.length === 0) {
    throw new Error(`No Denton County property found for "${address}". Check the address and try again.`);
  }
  return toSubject(feats[0]);
}

/** Exact lookup by pid — used when an autocomplete suggestion was selected. */
export async function fetchDentonSubjectByAccount(pid: string): Promise<SubjectProperty> {
  const feats = await query(`pid=${Number(pid)}`, SUBJECT_FIELDS, 0, true);
  if (feats.length === 0) {
    throw new Error(`Denton County property ${pid} could not be loaded.`);
  }
  return toSubject(feats[0]);
}

export async function fetchDentonComps(
  neighborhoodCode: string,
  subjectAccount: string
): Promise<Comp[]> {
  const where =
    `asCode='${sqlEscape(neighborhoodCode)}' AND stateCodes='A1' ` +
    `AND imprvMainArea>0 AND ownerAppraisedValue>0`;

  const all: DentonAttrs[] = [];
  let offset = 0;
  for (;;) {
    const pageRows = await query(where, COMP_FIELDS, offset);
    all.push(...pageRows.map((f) => f.attributes));
    if (pageRows.length < PAGE) break;
    offset += PAGE;
  }
  return all.map(toComp).filter((c) => c.account !== subjectAccount);
}
