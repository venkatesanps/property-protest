// ─── Analysis orchestrator ────────────────────────────────────────────────────
//
// Ties together: geocode -> county router -> data adapter -> cap + equity +
// optional market -> verdict. Runs entirely in the browser; no backend.

import type {
  AppStep,
  County,
  GeocodeResult,
  SubjectProperty,
  EquityResult,
  CapFloorResult,
  MarketValueResult,
  ListingResult,
  Verdict,
  ManualComp,
  Comp,
  PurchaseEvidence,
  PropertyCondition,
  PropertyCharacteristics,
} from '../types';
import { adjustToToday } from '../adapters/hpi';
import { fetchFloodZone } from '../adapters/flood';
import type { FloodZoneResult } from '../adapters/flood';
import { geocodeAddress } from '../adapters/census';
import {
  fetchCollinSubject,
  fetchCollinSubjectByAccount,
  fetchCollinComps,
} from '../adapters/collin';
import {
  fetchDentonSubject,
  fetchDentonSubjectByAccount,
  fetchDentonComps,
} from '../adapters/denton';
import {
  fetchTarrantSubject,
  fetchTarrantSubjectByAccount,
  fetchTarrantComps,
} from '../adapters/tarrant';
import { fetchRentcastMarket, fetchRentcastListing, buildManualMarket } from '../adapters/market';
import { computeCapFloor } from './cap';
import { computeEquity } from './equity';
import { computeVerdict } from './verdict';

export interface AnalysisResult {
  geocode: GeocodeResult | null;
  subject: SubjectProperty;
  capFloor: CapFloorResult;
  equity: EquityResult | null;
  market: MarketValueResult | null;
  /** Recent-purchase evidence (HPI-aged to today), if the owner entered a price. */
  purchase: PurchaseEvidence | null;
  /** Why RentCast was skipped, if a key was given but the call failed. */
  rentcastError: string | null;
  /** Active MLS listing for this property, if currently for sale (RentCast). */
  listing: ListingResult | null;
  /** FEMA flood zone for this property (null if lat/lng unavailable or API failed). */
  floodZone: FloodZoneResult | null;
  /** Owner-documented condition issues. */
  condition: PropertyCondition | null;
  /** Owner-reported discrepancies in the CAD record. */
  characteristics: PropertyCharacteristics | null;
  verdict: Verdict;
}

export interface RunOptions {
  address: string;
  county?: County;
  /** propid (Collin) / pid (Denton) from a selected autocomplete suggestion. */
  account?: string;
  rentcastKey?: string;
  manualComps?: ManualComp[];
  repairEstimateTotal?: number;
  recentPurchasePrice?: number;
  recentPurchaseDate?: string;
  condition?: PropertyCondition | null;
  characteristics?: PropertyCharacteristics | null;
  onStep?: (s: AppStep) => void;
}

async function fetchSubject(
  county: County,
  address: string,
  account?: string
): Promise<SubjectProperty> {
  if (county === 'collin') {
    return account ? fetchCollinSubjectByAccount(account) : fetchCollinSubject(address);
  }
  if (county === 'denton') {
    return account ? fetchDentonSubjectByAccount(account) : fetchDentonSubject(address);
  }
  if (county === 'tarrant') {
    return account ? fetchTarrantSubjectByAccount(account) : fetchTarrantSubject(address);
  }
  throw new Error('This county is not yet supported (Collin, Denton, and Tarrant only).');
}

async function fetchComps(subject: SubjectProperty): Promise<Comp[]> {
  if (subject.county === 'collin') return fetchCollinComps(subject.neighborhoodCode, subject.account);
  if (subject.county === 'denton') return fetchDentonComps(subject.neighborhoodCode, subject.account);
  if (subject.county === 'tarrant') return fetchTarrantComps(subject.neighborhoodCode, subject.account);
  return [];
}

export async function runAnalysis(opts: RunOptions): Promise<AnalysisResult> {
  const { address, onStep } = opts;
  let county = opts.county;
  let geocode: GeocodeResult | null = null;

  // When the user picked an autocomplete suggestion we already know the county
  // (and account), so we skip the CORS-blocked Census geocoder entirely.
  if (!county) {
    onStep?.('geocoding');
    geocode = await geocodeAddress(address);
    county = geocode.county;
    if (county === 'unsupported') {
      throw new Error(
        `Address is in county FIPS ${geocode.countyFips}, which is not yet supported (Collin, Denton, and Tarrant only).`
      );
    }
  }

  onStep?.('loading_property');
  const subject = await fetchSubject(county, address, opts.account);
  if (geocode) {
    subject.lat = geocode.lat;
    subject.lng = geocode.lng;
  }

  // Coordinates feed the flood-zone lookup. Denton supplies a parcel centroid;
  // for Collin (no geometry in the Socrata roll) try the Census geocoder as a
  // best-effort fallback, in parallel with the comp fetch so it costs no time.
  const coordsPromise =
    subject.lat == null || subject.lng == null
      ? geocodeAddress(subject.address || address).catch(() => null)
      : null;

  onStep?.('loading_comps');
  const comps = await fetchComps(subject);

  if (coordsPromise) {
    const geo = await coordsPromise;
    if (geo) {
      subject.lat = geo.lat;
      subject.lng = geo.lng;
    }
  }

  const capFloor = computeCapFloor(subject);
  const equity = computeEquity(subject, comps);

  let market: MarketValueResult | null = null;
  let rentcastError: string | null = null;
  let listing: ListingResult | null = null;
  if (opts.rentcastKey) {
    // Fire AVM + listing lookup in parallel — each costs 1 API call.
    const [marketResult, listingResult] = await Promise.allSettled([
      fetchRentcastMarket(address, opts.rentcastKey),
      fetchRentcastListing(address, opts.rentcastKey),
    ]);
    if (marketResult.status === 'fulfilled') {
      market = marketResult.value;
    } else {
      rentcastError = marketResult.reason instanceof Error
        ? marketResult.reason.message
        : 'RentCast request failed.';
    }
    if (listingResult.status === 'fulfilled') {
      listing = listingResult.value;
    }
  }
  if (!market && opts.manualComps && opts.manualComps.length > 0) {
    market = buildManualMarket(subject.livingAreaSqft, opts.manualComps);
  }

  // Recent purchase price: age it to today's market via the FHFA HPI when a date
  // is known, so an older purchase becomes a current-market estimate. The aged
  // (or raw) value is what the verdict treats as market evidence.
  let purchase: PurchaseEvidence | null = null;
  if (opts.recentPurchasePrice && opts.recentPurchasePrice > 0) {
    const hpi = adjustToToday(opts.recentPurchasePrice, opts.recentPurchaseDate);
    purchase = {
      price: Math.round(opts.recentPurchasePrice),
      date: opts.recentPurchaseDate ?? null,
      hpi,
      marketValue: hpi ? hpi.adjustedValue : Math.round(opts.recentPurchasePrice),
    };
  }

  // Flood zone — fire-and-forget after geocoder provides lat/lng; silently null if unavailable
  const floodZone = subject.lat && subject.lng
    ? await fetchFloodZone(subject.lat, subject.lng).catch(() => null)
    : null;

  // Total repair estimate: explicit total OR sum of condition categories
  const conditionTotal = opts.condition
    ? opts.condition.foundation + opts.condition.roof + opts.condition.hvac +
      opts.condition.plumbingElectrical + opts.condition.other
    : 0;
  const repairTotal = (opts.repairEstimateTotal ?? 0) + conditionTotal;

  const verdict = computeVerdict(subject, capFloor, equity, market, {
    repairEstimateTotal: repairTotal > 0 ? repairTotal : undefined,
    recentPurchasePrice: purchase ? purchase.marketValue : undefined,
    recentPurchaseDate: opts.recentPurchaseDate,
  });
  onStep?.('results');
  return {
    geocode, subject, capFloor, equity, market, purchase, rentcastError,
    listing,
    floodZone,
    condition: opts.condition ?? null,
    characteristics: opts.characteristics ?? null,
    verdict,
  };
}
