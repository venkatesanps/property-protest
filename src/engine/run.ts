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
  Verdict,
  ManualComp,
  Comp,
  PurchaseEvidence,
} from '../types';
import { adjustToToday } from '../adapters/hpi';
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
import { fetchRentcastMarket, buildManualMarket } from '../adapters/market';
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
  throw new Error('This county is not yet supported (Collin and Denton only).');
}

async function fetchComps(subject: SubjectProperty): Promise<Comp[]> {
  if (subject.county === 'collin') return fetchCollinComps(subject.neighborhoodCode, subject.account);
  if (subject.county === 'denton') return fetchDentonComps(subject.neighborhoodCode, subject.account);
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
        `Address is in county FIPS ${geocode.countyFips}, which is not yet supported (Collin & Denton only).`
      );
    }
  }

  onStep?.('loading_property');
  const subject = await fetchSubject(county, address, opts.account);
  if (geocode) {
    subject.lat = geocode.lat;
    subject.lng = geocode.lng;
  }

  onStep?.('loading_comps');
  const comps = await fetchComps(subject);

  const capFloor = computeCapFloor(subject);
  const equity = computeEquity(subject, comps);

  let market: MarketValueResult | null = null;
  let rentcastError: string | null = null;
  if (opts.rentcastKey) {
    try {
      market = await fetchRentcastMarket(address, opts.rentcastKey);
    } catch (e) {
      // CORS, bad key, or quota — record why, then fall back to manual comps.
      rentcastError = e instanceof Error ? e.message : 'RentCast request failed.';
      market = null;
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

  const verdict = computeVerdict(subject, capFloor, equity, market, {
    repairEstimateTotal: opts.repairEstimateTotal,
    recentPurchasePrice: purchase ? purchase.marketValue : undefined,
    recentPurchaseDate: opts.recentPurchaseDate,
  });
  onStep?.('results');
  return { geocode, subject, capFloor, equity, market, purchase, rentcastError, verdict };
}
