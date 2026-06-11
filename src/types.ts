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
  /** Tax year of the appraisal roll the values came from (null if unknown). */
  rollYear: number | null;
  /** Human label for the data vintage, e.g. "2026 preliminary roll". */
  rollLabel: string;
  /** Raw exemption codes from the roll (Denton only; null when not published). */
  exemptions: string | null;
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

/** Result of aging a known purchase price to today via the FHFA House Price Index. */
export interface HpiAdjustment {
  rawValue: number;       // the price as entered
  adjustedValue: number;  // aged to the latest available quarter
  fromLabel: string;      // e.g. "2021 Q2"
  toLabel: string;        // e.g. "2026 Q1"
  fromIndex: number;
  toIndex: number;
  pctChange: number;      // percent change in the index (can be negative)
  area: string;           // e.g. "Dallas-Plano-Irving, TX"
}

/** A recent purchase the owner entered, optionally aged to today via HPI. */
export interface PurchaseEvidence {
  price: number;              // raw price entered
  date: string | null;       // YYYY-MM-DD, or null if not given
  hpi: HpiAdjustment | null;  // present only when a date is known
  /** Value used as market evidence: HPI-adjusted when a date exists, else raw. */
  marketValue: number;
}

/** Manual comp entered by the user. */
export interface ManualComp {
  address: string;
  salePrice: number;
  saleDate: string;
  livingAreaSqft: number;
  notes: string;
}

/**
 * Property condition issues the owner documents.
 * Each category holds a dollar estimate; zero means "not applicable."
 * Used for §41.43(a) market-value reduction and condition talking points.
 */
export interface PropertyCondition {
  foundation: number;
  roof: number;
  hvac: number;
  plumbingElectrical: number;
  other: number;
  /** Free-text note (e.g. "foundation crack estimate from ABC Co.") */
  notes: string;
}

/**
 * Discrepancies between what the CAD record says and what the owner knows.
 * Wrong sqft is especially common and directly changes the §41.43 argument.
 */
export interface PropertyCharacteristics {
  /** Owner's measured/actual living area, if different from the CAD record. */
  actualSqft: number | null;
  /** True if owner disputes the quality class shown on the CAD record. */
  wrongQualityClass: boolean;
  /** Free-text description of what is wrong with the CAD record. */
  characteristicsNotes: string;
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
