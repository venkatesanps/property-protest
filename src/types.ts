// ─── Core domain types ────────────────────────────────────────────────────────

export type County = 'collin' | 'denton' | 'unsupported';

/** Normalized property record from either county adapter. */
export interface SubjectProperty {
  account: string;           // propid (Collin) or pid (Denton)
  address: string;
  county: County;
  livingAreaSqft: number;
  yearBuilt: number;
  qualityClass: string;      // imprvclasscd (Collin) or imprvClasses (Denton)
  neighborhoodCode: string;  // nbhdcode (Collin) or asCode (Denton)
  stateClass: string;        // propcategorycode (Collin) or stateCodes (Denton)
  appraisedValue: number;    // CAD appraised value (may be homestead-capped)
  marketValue: number;       // assessed market value
  /** Homestead-capped taxable value — Denton only; null for Collin (not exposed). */
  netAppraisedValue: number | null;
  /** The homestead cap limit amount — Denton only. */
  homesteadCapAmount: number | null;
  landValue: number;
  improvementValue: number;
  priorYearValue: number | null;
  lat: number | null;
  lng: number | null;
}

/** A comparable property used in equity analysis. */
export interface Comp {
  account: string;
  address: string;
  county: County;
  livingAreaSqft: number;
  yearBuilt: number;
  qualityClass: string;
  appraisedValue: number;
  pricePerSqft: number;
  /** CAD land value (0 if the county dataset didn't supply it for comps). */
  landValue: number;
  /** CAD improvement/building value (0 if not supplied). */
  improvementValue: number;
  isRefined: boolean; // passes the ±20% size, ±12yr filter
}

/** Result of the equity analysis engine. */
export interface EquityResult {
  neighborhoodMedianPsf: number;   // full neighborhood
  refinedMedianPsf: number;        // filtered comps (size/age)
  indicatedValueAll: number;       // median_all × subj sqft
  indicatedValueRefined: number;   // median_refined × subj sqft
  subjectPsf: number;
  subjectRankOf: number;           // rank (1 = highest $/sqft, worst)
  neighborhoodCount: number;
  percentileHigher: number;        // % of neighborhood below subject psf
  comps: Comp[];
  refinedComps: Comp[];
  // ── adjustment refinements ──
  /** Comps matched on quality/class code (apples-to-apples). */
  classMatchedComps: Comp[];
  classMatchedMedianPsf: number | null;
  indicatedValueClassMatched: number | null;
  /** Marginal $/sqft used for the size adjustment (diminishing-value rule). */
  sizeAdjMarginalRate: number;
  /** Median of size-adjusted comp values brought to subject size. */
  indicatedValueSizeAdjusted: number;
  // ── land + building split (requires comp land/improvement values) ──
  /** Median comp improvement (building) $ per living sqft. Null if comps lack the data. */
  improvementMedianPsf: number | null;
  /** Median comp land value (CAD land values are roughly uniform per lot in a nbhd). */
  landMedianValue: number | null;
  /** improvementMedianPsf x subject sqft — the indicated building value. */
  indicatedImprovementValue: number | null;
  /** landMedianValue — the indicated land value. */
  indicatedLandValue: number | null;
  /** indicatedImprovementValue + indicatedLandValue — total via the split method. */
  indicatedValueSplit: number | null;
}

/** Result of the homestead-cap floor check. */
export interface CapFloorResult {
  available: boolean;
  appraisedValue: number;
  netAppraisedValue: number | null;
  capAmount: number | null;
  isCapped: boolean;             // netAppraised < appraised
  floor: number | null;          // the taxable floor (= netAppraisedValue)
}

/** Optional market value estimate from RentCast AVM, manual comps, or a recent sale. */
export interface MarketValueResult {
  source: 'rentcast' | 'manual' | 'purchase';
  estimatedValue: number;
  lowRange?: number;
  highRange?: number;
  comparables?: MarketComp[];
}

/** Homeowner-supplied extras that strengthen a protest. */
export interface ProtestExtras {
  /** Total of contractor repair/deferred-maintenance estimates (condition adj.). */
  repairEstimateTotal?: number;
  /** Recent arms-length purchase price — strongest market evidence if recent. */
  recentPurchasePrice?: number;
  recentPurchaseDate?: string;
}

export interface MarketComp {
  address: string;
  salePrice: number;
  saleDate: string;
  livingAreaSqft: number;
  pricePerSqft: number;
}

/** Manual comp entered by the user. */
export interface ManualComp {
  address: string;
  salePrice: number;
  saleDate: string;
  livingAreaSqft: number;
  notes: string;
}

export type VerdictCode = 'protest' | 'borderline' | 'dont_protest' | 'incomplete';

/** Final recommendation combining cap floor + equity (+ optional market). */
export interface Verdict {
  code: VerdictCode;
  headline: string;
  targetValue: number | null;     // the value to request at ARB
  equityReduction: number | null; // how much equity method saves vs floor
  /** Which method produced the recommended value (for the packet). */
  methodUsed: string | null;
  /** Dollar amount deducted for documented repairs/condition, if any. */
  repairAdjustment: number | null;
  capFloor: CapFloorResult;
  equity: EquityResult | null;
  market: MarketValueResult | null;
  summary: string;
}

// ─── Census geocoder ─────────────────────────────────────────────────────────

export interface GeocodeResult {
  address: string;
  lat: number;
  lng: number;
  countyFips: string;
  county: County;
  state: string;
}

// ─── App state ───────────────────────────────────────────────────────────────

export type AppStep =
  | 'input'
  | 'geocoding'
  | 'loading_property'
  | 'loading_comps'
  | 'results'
  | 'error';

export interface AppState {
  step: AppStep;
  rawAddress: string;
  geocode: GeocodeResult | null;
  subject: SubjectProperty | null;
  equity: EquityResult | null;
  capFloor: CapFloorResult | null;
  verdict: Verdict | null;
  market: MarketValueResult | null;
  manualComps: ManualComp[];
  rentcastKey: string;
  error: string | null;
}
