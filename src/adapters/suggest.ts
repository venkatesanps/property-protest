/**
 * Address autocomplete
 *
 * Type-ahead suggestions sourced directly from the county appraisal rolls
 * (Collin via Socrata, Denton via ArcGIS) — both CORS-enabled, no API key.
 *
 * Because the suggestion already tells us the county AND the account id, the
 * downstream analysis can look the property up by account and skip the (CORS-
 * blocked) Census geocoder entirely. That makes the happy path fully reliable
 * from a static GitHub Pages origin.
 */

import type { County } from '../types';
import { collinBaseUrl } from './collin';

const TARRANT_BASE =
  'https://tad.newedgeservices.com/arcgis/rest/services/Hosted/TADMap/FeatureServer/0/query';

export interface AddressSuggestion {
  /** Pretty, title-cased label for the dropdown. */
  label: string;
  /** Raw situs string from the roll (kept for reference). */
  raw: string;
  county: County;
  /** propid (Collin) or pid (Denton) — used for an exact lookup later. */
  account: string;
}

const DENTON_BASE =
  'https://gis.dentoncounty.gov/arcgis/rest/services/Parcels_FC/MapServer/0/query';

const APP_TOKEN = import.meta.env.VITE_SOCRATA_APP_TOKEN as string | undefined;

/** Title-case a SHOUTING situs string for display ("1013 SAFFOLD TRL" -> "1013 Saffold Trl"). */
function prettyAddress(raw: string): string {
  return raw
    .replace(/\s+,/g, ',') // "TRL ," -> "TRL,"
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/\b([a-z])/g, (m) => m.toUpperCase())
    .replace(/\bTx\b/g, 'TX');
}

/** Escape single quotes for a SoQL / SQL string literal. */
const esc = (s: string) => s.replace(/'/g, "''");

async function suggestCollin(prefix: string, signal?: AbortSignal): Promise<AddressSuggestion[]> {
  // Same resolved resource as the subject/comps queries (2026 preliminary roll
  // when available, falling back to the last certified roll).
  const url = new URL(await collinBaseUrl());
  url.searchParams.set('$select', 'propid,situsconcat');
  url.searchParams.set(
    '$where',
    `upper(situsconcat) like '${esc(prefix)}%' AND propcategorycode IN ('A','B') AND situsconcat IS NOT NULL`
  );
  url.searchParams.set('$order', 'situsconcat');
  url.searchParams.set('$limit', '8');

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (APP_TOKEN) headers['X-App-Token'] = APP_TOKEN;

  const resp = await fetch(url.toString(), { headers, signal });
  if (!resp.ok) return [];
  const rows = (await resp.json()) as { propid?: string; situsconcat?: string }[];
  return rows
    .filter((r) => r.propid && r.situsconcat)
    .map((r) => ({
      label: prettyAddress(r.situsconcat as string),
      raw: r.situsconcat as string,
      county: 'collin' as const,
      account: r.propid as string,
    }));
}

async function suggestDenton(prefix: string, signal?: AbortSignal): Promise<AddressSuggestion[]> {
  const url = new URL(DENTON_BASE);
  url.searchParams.set(
    'where',
    `situs_full_address LIKE '${esc(prefix)}%' AND stateCodes='A1'`
  );
  url.searchParams.set('outFields', 'pid,situs_full_address');
  url.searchParams.set('orderByFields', 'situs_full_address');
  url.searchParams.set('returnGeometry', 'false');
  url.searchParams.set('resultRecordCount', '8');
  url.searchParams.set('f', 'json');

  const resp = await fetch(url.toString(), { headers: { Accept: 'application/json' }, signal });
  if (!resp.ok) return [];
  const data = (await resp.json()) as {
    features?: { attributes: { pid?: number; situs_full_address?: string } }[];
  };
  return (data.features ?? [])
    .map((f) => f.attributes)
    .filter((a) => a.pid != null && a.situs_full_address)
    .map((a) => ({
      label: prettyAddress(a.situs_full_address as string),
      raw: a.situs_full_address as string,
      county: 'denton' as const,
      account: String(a.pid),
    }));
}

async function suggestTarrant(prefix: string, signal?: AbortSignal): Promise<AddressSuggestion[]> {
  const url = new URL(TARRANT_BASE);
  url.searchParams.set(
    'where',
    `situsaddress LIKE '${esc(prefix)}%' AND (applclasscd LIKE 'A1%' OR applclasscd LIKE 'B%')`
  );
  url.searchParams.set('outFields', 'pin,situsaddress');
  url.searchParams.set('orderByFields', 'situsaddress');
  url.searchParams.set('returnGeometry', 'false');
  url.searchParams.set('resultRecordCount', '8');
  url.searchParams.set('f', 'json');

  const resp = await fetch(url.toString(), { headers: { Accept: 'application/json' }, signal });
  if (!resp.ok) return [];
  const data = (await resp.json()) as {
    features?: { attributes: { pin?: string; situsaddress?: string } }[];
  };
  return (data.features ?? [])
    .map((f) => f.attributes)
    .filter((a) => a.pin && a.situsaddress)
    .map((a) => ({
      label: prettyAddress((a.situsaddress as string).trim()),
      raw: (a.situsaddress as string).trim(),
      county: 'tarrant' as const,
      account: (a.pin as string).trim(),
    }));
}

/**
 * Return up to ~12 address suggestions across all three supported counties.
 * Queries are issued in parallel and failures from any source are silently
 * dropped so one slow endpoint never kills the dropdown.
 */
export async function suggestAddresses(
  query: string,
  signal?: AbortSignal
): Promise<AddressSuggestion[]> {
  const prefix = query.trim().toUpperCase().replace(/\s+/g, ' ');
  // Need at least a building number + a couple letters to make a useful prefix.
  if (prefix.length < 4 || !/^\d/.test(prefix)) return [];

  const [collin, denton, tarrant] = await Promise.all([
    suggestCollin(prefix, signal).catch(() => []),
    suggestDenton(prefix, signal).catch(() => []),
    suggestTarrant(prefix, signal).catch(() => []),
  ]);

  // Interleave so all counties are represented, then cap.
  const merged: AddressSuggestion[] = [];
  const max = Math.max(collin.length, denton.length, tarrant.length);
  for (let i = 0; i < max; i++) {
    if (collin[i]) merged.push(collin[i]);
    if (denton[i]) merged.push(denton[i]);
    if (tarrant[i]) merged.push(tarrant[i]);
  }
  return merged.slice(0, 12);
}
