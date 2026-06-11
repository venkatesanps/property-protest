/**
 * Market-value adapter (OPTIONAL module)
 *
 * Texas is a sale-price non-disclosure state and public sites (Zillow/Redfin/HAR)
 * block scraping. The only free-tier API is RentCast (50 calls/month). The key is
 * USER-SUPPLIED and stored only in the browser — never hard-coded or committed.
 *
 * NOTE: RentCast may not send browser CORS headers; if a call fails the app falls
 * back to user-entered manual comps, which always work.
 */

import type { MarketValueResult, ManualComp } from '../types';
import { median } from '../engine/equity';

const RENTCAST = 'https://api.rentcast.io/v1/avm/value';

interface RentcastComp {
  formattedAddress?: string;
  price?: number;
  squareFootage?: number;
  listedDate?: string;
  lastSeenDate?: string;
  removedDate?: string;
}
interface RentcastResponse {
  price?: number;
  priceRangeLow?: number;
  priceRangeHigh?: number;
  comparables?: RentcastComp[];
}

export async function fetchRentcastMarket(
  address: string,
  apiKey: string
): Promise<MarketValueResult> {
  const url = new URL(RENTCAST);
  url.searchParams.set('address', address);

  // NOTE: we deliberately do NOT route the request through a public CORS proxy.
  // That would expose the user's private API key to a third party. If the
  // browser blocks the direct call, we surface a clear message and fall back to
  // manual comps instead.
  let resp: Response;
  try {
    resp = await fetch(url.toString(), {
      headers: { 'X-Api-Key': apiKey, Accept: 'application/json' },
    });
  } catch {
    // fetch() rejects on a network failure OR a CORS block (the response is
    // opaque, so we can't tell which) — both land here.
    throw new Error(
      'RentCast could not be reached from the browser (likely a CORS block). ' +
        'Your manual comps are used instead. To use RentCast, call it from a small backend/proxy with your key.'
    );
  }
  if (!resp.ok) {
    if (resp.status === 401 || resp.status === 403) {
      throw new Error('RentCast rejected the API key (401/403). Double-check the key in Advanced options.');
    }
    if (resp.status === 402 || resp.status === 429) {
      throw new Error('RentCast quota reached (free tier is 50 lookups/month). Using manual comps instead.');
    }
    throw new Error(`RentCast error ${resp.status}. Using manual comps instead.`);
  }
  const d = (await resp.json()) as RentcastResponse;
  const comps = (d.comparables ?? []).map((c) => {
    const sqft = Number(c.squareFootage) || 0;
    const price = Number(c.price) || 0;
    return {
      address: c.formattedAddress ?? '',
      salePrice: price,
      saleDate: c.listedDate ?? c.lastSeenDate ?? c.removedDate ?? '',
      livingAreaSqft: sqft,
      pricePerSqft: sqft > 0 ? price / sqft : 0,
    };
  });
  return {
    source: 'rentcast',
    estimatedValue: Number(d.price) || 0,
    lowRange: d.priceRangeLow != null ? Number(d.priceRangeLow) : undefined,
    highRange: d.priceRangeHigh != null ? Number(d.priceRangeHigh) : undefined,
    comparables: comps,
  };
}

export function buildManualMarket(
  subjectSqft: number,
  manualComps: ManualComp[]
): MarketValueResult | null {
  const valid = manualComps.filter((c) => c.salePrice > 0 && c.livingAreaSqft > 0);
  if (valid.length === 0 || subjectSqft <= 0) return null;
  // Each comp implies a subject value at its own $/sqft; the estimate is the
  // median of those, and the range is the spread across the comps.
  const implied = valid.map((c) => (c.salePrice / c.livingAreaSqft) * subjectSqft);
  return {
    source: 'manual',
    estimatedValue: Math.round(median(valid.map((c) => c.salePrice / c.livingAreaSqft)) * subjectSqft),
    lowRange: Math.round(Math.min(...implied)),
    highRange: Math.round(Math.max(...implied)),
    comparables: valid.map((c) => ({
      address: c.address,
      salePrice: c.salePrice,
      saleDate: c.saleDate,
      livingAreaSqft: c.livingAreaSqft,
      pricePerSqft: c.salePrice / c.livingAreaSqft,
    })),
  };
}
