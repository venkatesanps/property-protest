/**
 * Collin County Appraisal District adapter
 *
 * Data source: Texas Open Data Portal — Socrata SODA API
 * Dataset: 2025 Appraisal Roll
 * Base URL: https://data.texas.gov/resource/vffy-snc6.json
 *
 * CORS: Socrata endpoints are CORS-enabled — browser-direct fetch works.
 * No API key required for read access (add app token via VITE_SOCRATA_APP_TOKEN
 * to raise the per-IP rate limit from ~1 req/s to 1000 req/s).
 *
 * NOTE: This dataset does NOT expose a homestead-cap / net-appraised field.
 * The equity engine's cap-floor check will show "unavailable" for Collin properties.
 *
 * To update the dataset for a future tax year, change COLLIN_RESOURCE_ID.
 */

import type { SubjectProperty, Comp } from '../types';
import { parseAddress, sqlEscape } from './address';

// ── Config ───────────────────────────────────────────────────────────────────

/** Resource ID of the Collin County appraisal roll on data.texas.gov.
 *  Change this each year when the new roll is published. */
export const COLLIN_RESOURCE_ID = 'vffy-snc6'; // 2025 roll

const BASE_URL = `https://data.texas.gov/resource/${COLLIN_RESOURCE_ID}.json`;

/** Optional Socrata app token — set VITE_SOCRATA_APP_TOKEN in .env.local. */
const APP_TOKEN = import.meta.env.VITE_SOCRATA_APP_TOKEN as string | undefined;

// ── Field mapping ─────────────────────────────────────────────────────────────

interface CollinRow {
  propid?: string;
  situsconcat?: string;
  situsstreetname?: string;
  situsbldgnum?: string;
  currvalappraised?: string;
  currvalmarket?: string;
  currvalland?: string;
  currvalimprv?: string;
  imprvmainarea?: string;
  imprvyearbuilt?: string;
  nbhdcode?: string;
  marketareacode?: string;
  imprvclasscd?: string;
  landsizeacres?: string;
  landsizesqft?: string;
  imprvpoolflag?: string;
  propcategorycode?: string;
  geoid?: string;
  prevvalmarket?: string;
  prevvalappraised?: string;
  noticevalappraised?: string;
  noticedate?: string;
}

function num(v?: string): number {
  return v ? parseFloat(v) : 0;
}

function toSubject(row: CollinRow): SubjectProperty {
  return {
    account: row.propid ?? '',
    address: row.situsconcat ?? `${row.situsbldgnum ?? ''} ${row.situsstreetname ?? ''}`.trim(),
    county: 'collin',
    livingAreaSqft: num(row.imprvmainarea),
    yearBuilt: num(row.imprvyearbuilt),
    qualityClass: row.imprvclasscd ?? '',
    neighborhoodCode: row.nbhdcode ?? '',
    stateClass: row.propcategorycode ?? '',
    appraisedValue: num(row.currvalappraised),
    marketValue: num(row.currvalmarket),
    // Collin does NOT expose net appraised (homestead-capped) value in this dataset
    netAppraisedValue: null,
    homesteadCapAmount: null,
    landValue: num(row.currvalland),
    improvementValue: num(row.currvalimprv),
    priorYearValue: row.prevvalappraised ? num(row.prevvalappraised) : null,
    lat: null,
    lng: null,
  };
}

function toComp(row: CollinRow): Comp {
  const sqft = num(row.imprvmainarea);
  const appraised = num(row.currvalappraised);
  return {
    account: row.propid ?? '',
    address: row.situsconcat ?? '',
    county: 'collin',
    livingAreaSqft: sqft,
    yearBuilt: num(row.imprvyearbuilt),
    qualityClass: row.imprvclasscd ?? '',
    appraisedValue: appraised,
    pricePerSqft: sqft > 0 ? appraised / sqft : 0,
    isRefined: false, // set by engine
  };
}

// ── Fetch helpers ─────────────────────────────────────────────────────────────

function makeHeaders(): HeadersInit {
  const h: Record<string, string> = { Accept: 'application/json' };
  if (APP_TOKEN) h['X-App-Token'] = APP_TOKEN;
  return h;
}

async function soql<T>(params: Record<string, string>): Promise<T[]> {
  const url = new URL(BASE_URL);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const resp = await fetch(url.toString(), { headers: makeHeaders() });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`Collin SODA error ${resp.status}: ${body.slice(0, 200)}`);
  }
  return resp.json() as Promise<T[]>;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Look up a single property by street number + street name.
 * Address parsing: split on first space to get number vs name.
 */
export async function fetchCollinSubject(address: string): Promise<SubjectProperty> {
  // Appraisal roll stores street names WITHOUT the suffix; strip it before matching.
  const { bldgNum, streetName } = parseAddress(address);

  const rows = await soql<CollinRow>({
    $where: `situsbldgnum='${sqlEscape(bldgNum)}' AND situsstreetname LIKE '${sqlEscape(streetName)}%' AND propcategorycode='A'`,
    $select:
      'propid,situsconcat,situsstreetname,situsbldgnum,currvalappraised,currvalmarket,' +
      'currvalland,currvalimprv,imprvmainarea,imprvyearbuilt,nbhdcode,marketareacode,' +
      'imprvclasscd,landsizeacres,landsizesqft,imprvpoolflag,propcategorycode,geoid,' +
      'prevvalmarket,prevvalappraised,noticevalappraised,noticedate',
    $limit: '5',
  });

  if (rows.length === 0) {
    throw new Error(`No Collin County property found for "${address}". Check the address and try again.`);
  }
  return toSubject(rows[0]);
}

/** Exact lookup by propid — used when an autocomplete suggestion was selected. */
export async function fetchCollinSubjectByAccount(propid: string): Promise<SubjectProperty> {
  const rows = await soql<CollinRow>({
    $where: `propid='${sqlEscape(propid)}'`,
    $select:
      'propid,situsconcat,situsstreetname,situsbldgnum,currvalappraised,currvalmarket,' +
      'currvalland,currvalimprv,imprvmainarea,imprvyearbuilt,nbhdcode,marketareacode,' +
      'imprvclasscd,landsizeacres,landsizesqft,imprvpoolflag,propcategorycode,geoid,' +
      'prevvalmarket,prevvalappraised,noticevalappraised,noticedate',
    $limit: '1',
  });
  if (rows.length === 0) {
    throw new Error(`Collin County property ${propid} could not be loaded.`);
  }
  return toSubject(rows[0]);
}

/**
 * Fetch the comp pool: all residential (A) properties in the same CAD
 * neighborhood as the subject, with a living area > 0.
 */
export async function fetchCollinComps(
  neighborhoodCode: string,
  subjectAccount: string,
  limit = 500
): Promise<Comp[]> {
  const rows = await soql<CollinRow>({
    $where: `nbhdcode='${sqlEscape(neighborhoodCode)}' AND propcategorycode='A' AND imprvmainarea>0 AND currvalappraised>0`,
    $select:
      'propid,situsconcat,imprvmainarea,imprvyearbuilt,imprvclasscd,currvalappraised',
    $limit: String(limit),
  });
  return rows
    .filter((r) => r.propid !== subjectAccount)
    .map(toComp);
}
