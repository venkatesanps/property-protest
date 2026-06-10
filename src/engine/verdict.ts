// ─── Verdict engine ───────────────────────────────────────────────────────────
//
// Combines the cap floor + equity (+ optional market) into a recommendation.

import type {
  SubjectProperty,
  CapFloorResult,
  EquityResult,
  MarketValueResult,
  Verdict,
} from '../types';
import { TAX_RATE } from '../constants';
import { fmtUSD } from '../format';

export function computeVerdict(
  subject: SubjectProperty,
  capFloor: CapFloorResult,
  equity: EquityResult | null,
  market: MarketValueResult | null
): Verdict {
  // Floor below which a protest actually saves money. When the homestead cap is
  // unavailable (Collin), any reduction below appraised value helps.
  const floor = capFloor.floor ?? subject.appraisedValue;

  const candidates: { method: string; value: number }[] = [];
  if (equity) {
    const indicated =
      equity.refinedComps.length >= 3 ? equity.indicatedValueRefined : equity.indicatedValueAll;
    candidates.push({ method: 'equity (unequal appraisal)', value: indicated });
  }
  if (market && market.estimatedValue > 0) {
    candidates.push({ method: 'market value', value: market.estimatedValue });
  }

  if (candidates.length === 0) {
    return {
      code: 'incomplete',
      headline: 'Not enough comparable data',
      targetValue: null,
      equityReduction: null,
      capFloor,
      equity,
      market,
      summary: 'We could not gather enough comparable properties to evaluate this address.',
    };
  }

  const best = candidates.reduce((a, b) => (b.value < a.value ? b : a));

  if (best.value < floor - 500) {
    const reduction = floor - best.value;
    const tax = reduction * TAX_RATE;
    return {
      code: 'protest',
      headline: `Worth protesting - target about ${fmtUSD(best.value)}`,
      targetValue: Math.round(best.value),
      equityReduction: Math.round(reduction),
      capFloor,
      equity,
      market,
      summary:
        `The ${best.method} method indicates about ${fmtUSD(best.value)}, below your tax floor of ` +
        `${fmtUSD(floor)}. That is roughly a ${fmtUSD(reduction)} reduction, or about ` +
        `${fmtUSD(tax)}/year in taxes (estimate).`,
    };
  }

  let summary: string;
  if (capFloor.isCapped) {
    summary =
      `Your homestead 10% cap already holds your taxable value at ${fmtUSD(floor)}, below market. ` +
      `Comparable values (about ${fmtUSD(best.value)}) sit above that floor, so a protest would not ` +
      `lower your tax bill this year.`;
  } else {
    summary =
      `Comparable values (about ${fmtUSD(best.value)}) are at or above your appraised value of ` +
      `${fmtUSD(subject.appraisedValue)}. The property appears fairly assessed.`;
  }
  return {
    code: 'dont_protest',
    headline: 'Probably not worth protesting this year',
    targetValue: null,
    equityReduction: null,
    capFloor,
    equity,
    market,
    summary,
  };
}
