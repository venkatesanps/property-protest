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
  const resp = await fetch(url.toString(), {
    headers: { 'X-Api-Key': apiKey, Accept: 'application/json' },
  });
  if (!resp.ok) {
    throw new Error(`RentCast error ${resp.status} (check your API key / monthly quota)`);
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
  if (valid.length === 0) return null;
  const med = median(valid.map((c) => c.salePrice / c.livingAreaSqft));
  return {
    source: 'manual',
    estimatedValue: Math.round(med * subjectSqft),
    comparables: valid.map((c) => ({
      address: c.address,
      salePrice: c.salePrice,
      saleDate: c.saleDate,
      livingAreaSqft: c.livingAreaSqft,
      pricePerSqft: c.salePrice / c.livingAreaSqft,
    })),
  };
}
