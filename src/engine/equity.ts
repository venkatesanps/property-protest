// ─── Equity / unequal-appraisal engine ────────────────────────────────────────
//
// Tex. Tax Code 41.43(b)(3): a property is over-appraised if its value exceeds
// the median appraised value of a reasonable number of comparable properties,
// appropriately adjusted. Ported from research/analyze.py.

import type { SubjectProperty, Comp, EquityResult } from '../types';

export function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function computeEquity(subject: SubjectProperty, comps: Comp[]): EquityResult | null {
  if (subject.livingAreaSqft <= 0) return null;
  const valid = comps.filter((c) => c.livingAreaSqft > 0 && c.appraisedValue > 0);
  if (valid.length < 3) return null;

  const subjectPsf = subject.appraisedValue / subject.livingAreaSqft;
  const medAll = median(valid.map((c) => c.pricePerSqft));

  // refined: similar size (+/-20%) and age (+/-12 yr)
  for (const c of valid) {
    c.isRefined =
      Math.abs(c.livingAreaSqft - subject.livingAreaSqft) <= 0.2 * subject.livingAreaSqft &&
      Math.abs((c.yearBuilt || 0) - subject.yearBuilt) <= 12;
  }
  const refined = valid.filter((c) => c.isRefined);
  const medRefined = refined.length > 0 ? median(refined.map((c) => c.pricePerSqft)) : medAll;

  const higher = valid.filter((c) => c.pricePerSqft < subjectPsf).length;
  const rank = valid.filter((c) => c.pricePerSqft > subjectPsf).length + 1;
  const sorted = [...valid].sort((a, b) => a.pricePerSqft - b.pricePerSqft);

  return {
    neighborhoodMedianPsf: medAll,
    refinedMedianPsf: medRefined,
    indicatedValueAll: medAll * subject.livingAreaSqft,
    indicatedValueRefined: medRefined * subject.livingAreaSqft,
    subjectPsf,
    subjectRankOf: rank,
    neighborhoodCount: valid.length,
    percentileHigher: (higher / valid.length) * 100,
    comps: sorted,
    refinedComps: sorted.filter((c) => c.isRefined),
  };
}
