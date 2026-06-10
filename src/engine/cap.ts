// ─── Homestead-cap floor check ────────────────────────────────────────────────
//
// Texas caps the TAXABLE (net appraised) value of a homestead at +10%/year.
// A protest only lowers your bill if you can argue market value below that floor.

import type { SubjectProperty, CapFloorResult } from '../types';

export function computeCapFloor(s: SubjectProperty): CapFloorResult {
  if (s.netAppraisedValue == null) {
    return {
      available: false,
      appraisedValue: s.appraisedValue,
      netAppraisedValue: null,
      capAmount: null,
      isCapped: false,
      floor: null,
    };
  }
  const isCapped = s.netAppraisedValue < s.appraisedValue - 1;
  return {
    available: true,
    appraisedValue: s.appraisedValue,
    netAppraisedValue: s.netAppraisedValue,
    capAmount: s.homesteadCapAmount,
    isCapped,
    floor: s.netAppraisedValue,
  };
}
