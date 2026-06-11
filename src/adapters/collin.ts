/**
 * Collin County Appraisal District adapter
 *
 * Data source: Texas Open Data Portal — Socrata SODA API
 *
 * Collin publishes a NEW resource each tax year (plus a year-less "Preliminary"
 * dataset that carries the current year's notice values during protest season).
 * COLLIN_SOURCES lists them newest-first; at runtime the adapter probes each one
 * with the exact field set it needs and uses the first that answers, so the app
 * automatically picks up the new year's values without a code change — and falls
 * back to the last certified roll if the schema ever drifts.
 *
 * CORS: Socrata endpoints are CORS-enabled — browser-direct fetch works.
 * No API key required for read access (add app token via VITE_SOCRATA_APP_TOKEN
 * to raise the per-IP rate limit from ~1 req/s to 1000 req/s).
 *
 * NOTE: These datasets do NOT expose a homestead-cap / net-appraised field.
 * The equity engine's cap-floor check will show "unavailable" for Collin properties.
 */

import type { SubjectProperty, Comp } from '../types';
import { parseAddress, sqlEscape } from './address';

// ── Config ───────────────────────────────────────────────────────────────────

interface CollinSource {
  id: string;
  /** Label used when the roll year can't be read from the data itself. */
  label: string;
}

/** Candidate appraisal-roll resources on data.texas.gov, newest-first.
 *  Add the new certified roll's resource ID at the top each year. */
const COLLIN_SOURCES: CollinSource[] = [
  { id: 'nne4-8riu', label: 'preliminary roll' }, // "Collin CAD Appraisal Data - Preliminary"
  { id: 'vffy-snc6', label: '2025 certified roll' }, // "Collin CAD Appraisal Data - 2025"
];

/** Default resource (last certified roll) — used before the probe resolves. */
export const COLLIN_RESOURCE_ID = 'vffy-snc6';

const resourceUrl = (id: string) => `https://data.texas.gov/resource/${id}.json`;

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
    rollYear: resolvedRoll?.year ?? null,
    rollLabel: `Collin CAD ${resolvedRoll?.label ?? 'appraisal roll'}`,
    exemptions: null,
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
    landValue: num(row.currvalland),
    improvementValue: num(row.currvalimprv),
    isRefined: false, // set by engine
  };
}

// ── Fetch helpers ─────────────────────────────────────────────────────────────

function makeHeaders(): HeadersInit {
  const h: Record<string, string> = { Accept: 'application/json' };
  if (APP_TOKEN) h['X-App-Token'] = APP_TOKEN;
  return h;
}

const SUBJECT_SELECT =
  'propid,situsconcat,situsstreetname,situsbldgnum,currvalappraised,currvalmarket,' +
  'currvalland,currvalimprv,imprvmainarea,imprvyearbuilt,nbhdcode,marketareacode,' +
  'imprvclasscd,landsizeacres,landsizesqft,imprvpoolflag,propcategorycode,geoid,' +
  'prevvalmarket,prevvalappraised,noticevalappraised,noticedate';

// ── Roll resolution ───────────────────────────────────────────────────────────

export interface CollinRollInfo {
  id: string;
  year: number | null;
  /** e.g. "2026 preliminary roll" or "2025 certified roll". */
  label: string;
}

const ROLL_CACHE_KEY = 'protest.collinRoll.v1';
const ROLL_CACHE_TTL = 24 * 60 * 60 * 1000; // re-probe daily

let resolvedRoll: CollinRollInfo | null = null;
let resolving: Promise<CollinRollInfo> | null = null;

function readRollCache(): CollinRollInfo | null {
  try {
    const raw = sessionStorage.getItem(ROLL_CACHE_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as CollinRollInfo & { ts: number };
    if (Date.now() - c.ts > ROLL_CACHE_TTL) return null;
    if (!COLLIN_SOURCES.some((s) => s.id === c.id)) return null;
    return { id: c.id, year: c.year, label: c.label };
  } catch {
    return null; // no sessionStorage (node) or corrupt cache
  }
}

function writeRollCache(info: CollinRollInfo) {
  try {
    sessionStorage.setItem(ROLL_CACHE_KEY, JSON.stringify({ ...info, ts: Date.now() }));
  } catch {
    /* best effort */
  }
}

/** Probe one resource: must answer the full subject field set with ≥1 'A' row. */
async function probeSource(src: CollinSource): Promise<CollinRollInfo | null> {
  try {
    const url = new URL(resourceUrl(src.id));
    url.searchParams.set('$select', SUBJECT_SELECT);
    url.searchParams.set('$where', "propcategorycode='A'");
    url.searchParams.set('$order', 'noticedate DESC');
    url.searchParams.set('$limit', '1');
    const resp = await fetch(url.toString(), { headers: makeHeaders() });
    if (!resp.ok) return null; // 400 = schema mismatch, 404 = gone
    const rows = (await resp.json()) as CollinRow[];
    if (!Array.isArray(rows) || rows.length === 0) return null;
    const yearMatch = rows[0].noticedate?.match(/(\d{4})/);
    const year = yearMatch ? Number(yearMatch[1]) : null;
    const baseLabel = src.label.replace(/^\d{4}\s*/, '');
    return { id: src.id, year, label: year != null ? `${year} ${baseLabel}` : src.label };
  } catch {
    return null;
  }
}

/** Pick the newest Collin resource that actually answers our queries. */
async function resolveCollinRoll(): Promise<CollinRollInfo> {
  if (resolvedRoll) return resolvedRoll;
  if (resolving) return resolving;
  resolving = (async () => {
    const cached = readRollCache();
    if (cached) {
      resolvedRoll = cached;
      return cached;
    }
    for (const src of COLLIN_SOURCES) {
      const info = await probeSource(src);
      if (info) {
        resolvedRoll = info;
        writeRollCache(info);
        return info;
      }
    }
    // Every probe failed (offline?) — fall back to the last certified roll so the
    // real lookup can surface its own, more useful error.
    const fallback = COLLIN_SOURCES[COLLIN_SOURCES.length - 1];
    resolvedRoll = { id: fallback.id, year: null, label: fallback.label };
    return resolvedRoll;
  })();
  return resolving;
}

/** Resolved SODA endpoint — shared with the autocomplete adapter. */
export async function collinBaseUrl(): Promise<string> {
  const { id } = await resolveCollinRoll();
  return resourceUrl(id);
}

/** Vintage of the roll in use (null until the first query resolves it). */
export function getCollinRollInfo(): CollinRollInfo | null {
  return resolvedRoll;
}

async function soql<T>(params: Record<string, string>): Promise<T[]> {
  const url = new URL(await collinBaseUrl());
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
    $select: SUBJECT_SELECT,
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
    $select: SUBJECT_SELECT,
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
      'propid,situsconcat,imprvmainarea,imprvyearbuilt,imprvclasscd,currvalappraised,currvalland,currvalimprv',
    $limit: String(limit),
  });
  return rows
    .filter((r) => r.propid !== subjectAccount)
    .map(toComp);
}
