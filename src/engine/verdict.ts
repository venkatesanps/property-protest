// ─── Verdict engine ───────────────────────────────────────────────────────────
//
// Combines the cap floor + equity (+ optional market, recent purchase, repairs)
// into a recommendation and the value to request at the ARB.

import type {
  SubjectProperty,
  CapFloorResult,
  EquityResult,
  MarketValueResult,
  ProtestExtras,
  Verdict,
} from '../types';
import { countyTaxRate } from '../constants';
import { fmtUSD } from '../format';

interface Candidate {
  method: string;
  value: number;
}

export function computeVerdict(
  subject: SubjectProperty,
  capFloor: CapFloorResult,
  equity: EquityResult | null,
  market: MarketValueResult | null,
  extras: ProtestExtras = {}
): Verdict {
  // Floor below which a protest actually saves money. When the homestead cap is
  // unavailable (Collin), any reduction below appraised value helps.
  const floor = capFloor.floor ?? subject.appraisedValue;

  // ── Build candidate values, lowest (best for the homeowner) wins. ──
  const candidates: Candidate[] = [];
  if (equity) {
    // Use the most-defensible equity number available. Prioritize same-street comps
    // when available (most directly comparable); else prefer refined comps.
    // Then take the lowest of the refinement methods.
    const equityOptions: Candidate[] = [];

    // Same-street comps are the strongest argument (same street, same quality class, most comparable).
    // Include them if available and they beat the floor.
    if (equity.indicatedValueSameStreet != null && equity.sameStreetComps.length >= 3) {
      equityOptions.push({
        method: `equity - same street (${equity.sameStreetComps.length} comps)`,
        value: equity.indicatedValueSameStreet,
      });
    }

    // Refined comps (size/age matched within the full neighborhood).
    const refinedOk = equity.refinedComps.length >= 3;
    equityOptions.push({
      method: refinedOk ? 'equity - refined comps' : 'equity - neighborhood median',
      value: refinedOk ? equity.indicatedValueRefined : equity.indicatedValueAll,
    });

    // Other refinement methods.
    if (equity.indicatedValueClassMatched != null) {
      equityOptions.push({ method: 'equity - same quality class', value: equity.indicatedValueClassMatched });
    }
    if (equity.indicatedValueSplit != null) {
      equityOptions.push({ method: 'equity - land + building split', value: equity.indicatedValueSplit });
    }
    equityOptions.push({ method: 'equity - size adjusted', value: equity.indicatedValueSizeAdjusted });
    candidates.push(equityOptions.reduce((a, b) => (b.value < a.value ? b : a)));
  }
  if (market && market.estimatedValue > 0) {
    const label = market.source === 'rentcast' ? 'market value (AVM)' : 'market value (comps)';
    candidates.push({ method: label, value: market.estimatedValue });
  }
  const purchase = extras.recentPurchasePrice ?? 0;
  if (purchase > 0) {
    candidates.push({ method: 'recent purchase price', value: purchase });
  }

  if (candidates.length === 0) {
    return base('incomplete', 'Not enough comparable data', null, null, null, null, capFloor, equity, market,
      'We could not gather enough comparable properties to evaluate this address.');
  }

  const best = candidates.reduce((a, b) => (b.value < a.value ? b : a));

  // ── Documented-repair (condition) deduction lowers the requested value further. ──
  const repair = extras.repairEstimateTotal && extras.repairEstimateTotal > 0 ? extras.repairEstimateTotal : 0;
  const target = Math.max(0, best.value - repair);

  if (target < floor - 500) {
    const reduction = floor - target;
    const tax = reduction * countyTaxRate(subject.county);
    const repairNote = repair > 0 ? ` (after a ${fmtUSD(repair)} repair/condition deduction)` : '';
    return base(
      'protest',
      `Worth protesting - target about ${fmtUSD(target)}`,
      Math.round(target),
      Math.round(reduction),
      best.method,
      repair > 0 ? Math.round(repair) : null,
      capFloor,
      equity,
      market,
      `The ${best.method} method indicates about ${fmtUSD(best.value)}${repairNote}, below your tax ` +
        `floor of ${fmtUSD(floor)}. That is roughly a ${fmtUSD(reduction)} reduction, or about ` +
        `${fmtUSD(tax)}/year in taxes (estimate).`
    );
  }

  let summary: string;
  if (capFloor.isCapped) {
    summary =
      `Your homestead 10% cap already holds your taxable value at ${fmtUSD(floor)}, below market. ` +
      `Your best supported value (about ${fmtUSD(target)}) still sits above that floor, so a protest ` +
      `would not lower your tax bill this year.`;
  } else {
    summary =
      `Your best supported value (about ${fmtUSD(target)}) is at or above your appraised value of ` +
      `${fmtUSD(subject.appraisedValue)}. The property appears fairly assessed.`;
  }
  return base('dont_protest', 'Probably not worth protesting this year', null, null, best.method,
    repair > 0 ? Math.round(repair) : null, capFloor, equity, market, summary);
}

function base(
  code: Verdict['code'],
  headline: string,
  targetValue: number | null,
  equityReduction: number | null,
  methodUsed: string | null,
  repairAdjustment: number | null,
  capFloor: CapFloorResult,
  equity: EquityResult | null,
  market: MarketValueResult | null,
  summary: string
): Verdict {
  return { code, headline, targetValue, equityReduction, methodUsed, repairAdjustment, capFloor, equity, market, summary };
}
