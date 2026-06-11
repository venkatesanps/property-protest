// ─── App-wide constants ───────────────────────────────────────────────────────

/** Approximate combined property-tax rate for the Frisco/Denton-Collin area.
 *  Used only to ESTIMATE annual tax savings — not an exact figure. */
export const TAX_RATE = 0.0179;

/** Texas protest deadline (or 30 days after the notice of appraised value). */
export const PROTEST_DEADLINE = 'May 15';

/** Texas Comptroller Notice of Protest form number. */
export const COMPTROLLER_FORM = '50-132';

export const DISCLAIMER =
  'Estimates only - not legal or tax advice. The Appraisal Review Board makes the final decision.';

// ─── Protest season ───────────────────────────────────────────────────────────

export type SeasonPhase =
  /** Jan 1 – May 15: notices arrive, protests can be filed. */
  | 'filing'
  /** May 16 – Aug 31: deadline passed for most; informal reviews + ARB hearings run. */
  | 'hearing'
  /** Sep 1 – Dec 31: records approved; only §25.25 corrections + next-year prep remain. */
  | 'planning';

/** Which phase of the Texas protest calendar we are in, and the tax year at issue. */
export function protestSeason(now = new Date()): { phase: SeasonPhase; taxYear: number } {
  const taxYear = now.getFullYear();
  const m = now.getMonth(); // 0-based
  const filing = m < 4 || (m === 4 && now.getDate() <= 15);
  const phase: SeasonPhase = filing ? 'filing' : m <= 7 ? 'hearing' : 'planning';
  return { phase, taxYear };
}
