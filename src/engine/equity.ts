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

function extractStreet(address: string): string {
  // Extract street name without house number.
  // E.g. "ANGEL FALLS DR" from "1069 ANGEL FALLS DR, FRISCO, TX"
  // or "ANGEL FALLS DR" from "1069 ANGEL FALLS DR"
  const beforeComma = address.split(',')[0].trim();
  // Remove leading house number: "1069 ANGEL FALLS DR" -> "ANGEL FALLS DR"
  const withoutNumber = beforeComma.replace(/^\d+\s+/, '').trim();
  return withoutNumber;
}

export function computeEquity(subject: SubjectProperty, comps: Comp[]): EquityResult | null {
  if (subject.livingAreaSqft <= 0) return null;
  const valid = comps.filter((c) => c.livingAreaSqft > 0 && c.appraisedValue > 0);
  if (valid.length < 3) return null;

  const subjectPsf = subject.appraisedValue / subject.livingAreaSqft;
  const medAll = median(valid.map((c) => c.pricePerSqft));

  // ── same-street comps: when available, these are the most directly comparable.
  // Extract street name from subject and filter comps on the same street.
  const subjectStreet = extractStreet(subject.address);
  const sameStreet = valid.filter(
    (c) => extractStreet(c.address).toUpperCase() === subjectStreet.toUpperCase()
  );

  // Filter same-street comps by refinement criteria (size ±20%, year ±12).
  // These are the "best" comparable properties on the same street.
  const refinedSameStreet = sameStreet.filter((c) =>
    Math.abs(c.livingAreaSqft - subject.livingAreaSqft) <= 0.2 * subject.livingAreaSqft &&
    Math.abs((c.yearBuilt || 0) - subject.yearBuilt) <= 12
  );

  const hasSameStreet = sameStreet.length >= 3;
  const hasRefinedSameStreet = refinedSameStreet.length >= 3;

  // Use refined same-street comps if available; otherwise fall back to all same-street.
  const sameStreetToUse = hasRefinedSameStreet ? refinedSameStreet : sameStreet;
  const sameStreetMedianPsf = hasSameStreet ? median(sameStreetToUse.map((c) => c.pricePerSqft)) : null;
  const indicatedValueSameStreet = sameStreetMedianPsf
    ? sameStreetMedianPsf * subject.livingAreaSqft
    : null;

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

  // ── quality-class matching: only comps of the subject's class (apples-to-apples)
  const classMatched =
    subject.qualityClass.trim() !== ''
      ? valid.filter((c) => c.qualityClass.trim() === subject.qualityClass.trim())
      : [];
  const hasClass = classMatched.length >= 3;
  const classMatchedMedianPsf = hasClass ? median(classMatched.map((c) => c.pricePerSqft)) : null;
  const indicatedValueClassMatched = classMatchedMedianPsf
    ? classMatchedMedianPsf * subject.livingAreaSqft
    : null;

  // ── size adjustment: larger homes carry lower $/sqft, so bring each comp to the
  // subject's size using a diminishing marginal rate (~50% of the median $/sqft).
  // Indicated value = median of size-adjusted comp values. Standard mass-appraisal
  // approach that prevents small comps from inflating a large subject (and vice versa).
  const sizeAdjMarginalRate = 0.5 * medAll;
  const adjustedValues = valid.map(
    (c) => c.appraisedValue + (subject.livingAreaSqft - c.livingAreaSqft) * sizeAdjMarginalRate
  );
  const indicatedValueSizeAdjusted = median(adjustedValues);

  // ── land + building split: appraised value = land + improvement. Land values
  // are CAD-set per lot and roughly uniform within a neighborhood, while the
  // building is where over-appraisal hides. Compare each part on its own basis:
  //   building -> median(comp improvement $/living-sqft) x subject sqft
  //   land     -> median(comp land value)   (uniform per lot, no lot size needed)
  // Total = indicated building + indicated land. Only runs when comps carry the
  // land/improvement split (>=3 with both > 0); otherwise the fields stay null.
  const splitComps = valid.filter((c) => c.improvementValue > 0 && c.landValue > 0);
  let improvementMedianPsf: number | null = null;
  let landMedianValue: number | null = null;
  let indicatedImprovementValue: number | null = null;
  let indicatedLandValue: number | null = null;
  let indicatedValueSplit: number | null = null;
  if (splitComps.length >= 3) {
    improvementMedianPsf = median(splitComps.map((c) => c.improvementValue / c.livingAreaSqft));
    landMedianValue = median(splitComps.map((c) => c.landValue));
    indicatedImprovementValue = improvementMedianPsf * subject.livingAreaSqft;
    indicatedLandValue = landMedianValue;
    indicatedValueSplit = indicatedImprovementValue + indicatedLandValue;
  }

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
    classMatchedComps: [...classMatched].sort((a, b) => a.pricePerSqft - b.pricePerSqft),
    classMatchedMedianPsf,
    indicatedValueClassMatched,
    sizeAdjMarginalRate,
    indicatedValueSizeAdjusted,
    improvementMedianPsf,
    landMedianValue,
    indicatedImprovementValue,
    indicatedLandValue,
    indicatedValueSplit,
    sameStreetComps: [...sameStreet].sort((a, b) => a.pricePerSqft - b.pricePerSqft),
    refinedSameStreetComps: [...refinedSameStreet].sort((a, b) => a.pricePerSqft - b.pricePerSqft),
    sameStreetMedianPsf,
    indicatedValueSameStreet,
  };
}
