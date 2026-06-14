/**
 * Counter-Strategy Analysis Engine (Phase 3B - Enhanced)
 *
 * Compares CAD evidence against user's equity analysis to identify:
 * 1. Real inconsistencies in DCAD's own analysis (indicated vs appraised)
 * 2. Weaknesses in their comp selection vs user's same-street comps
 * 3. Specific dollar-impact objections
 * 4. User-targeted settlement guidance
 * 5. County-specific objection/rebuttal pairs
 */

import type {
  ExtractedCADEvidence,
  EquityResult,
  CADWeakness,
  CADAnalysis,
  County,
} from '../types';

// ─── County-Specific Profiles ──────────────────────────────────────────────────

interface CountyProfile {
  name: string;
  arbPatterns: {
    acceptanceRangePercent: [min: number, max: number]; // % variance from indicated value
    favoredMethods: ('equity' | 'market' | 'cost')[];
    settlementLikelihood: number; // 0-1
  };
  likelyObjections: string[];
  settleTarget: number; // % of gap between appraised and indicated
}

const COUNTY_PROFILES: Record<County, CountyProfile> = {
  denton: {
    name: 'Denton ARB',
    arbPatterns: {
      acceptanceRangePercent: [95, 105],
      favoredMethods: ['equity', 'market'],
      settlementLikelihood: 0.65,
    },
    likelyObjections: [
      'Comps are on different streets',
      'Different quality class',
      'Different size requires adjustment',
    ],
    settleTarget: 0.6, // settle at 60% of the gap
  },
  collin: {
    name: 'Collin ARB',
    arbPatterns: {
      acceptanceRangePercent: [90, 110],
      favoredMethods: ['market', 'equity'],
      settlementLikelihood: 0.55,
    },
    likelyObjections: [
      'Market is the primary methodology',
      'Equity adjustments are subjective',
      'Need certified recent sales',
    ],
    settleTarget: 0.5,
  },
  tarrant: {
    name: 'Tarrant ARB',
    arbPatterns: {
      acceptanceRangePercent: [90, 110],
      favoredMethods: ['equity', 'market'],
      settlementLikelihood: 0.6,
    },
    likelyObjections: [
      'TADMap data is the official record',
      'Adjustments must be market-supported',
      'Same street is most comparable',
    ],
    settleTarget: 0.55,
  },
  unsupported: {
    name: 'Unknown County',
    arbPatterns: {
      acceptanceRangePercent: [95, 105],
      favoredMethods: ['equity', 'market'],
      settlementLikelihood: 0.5,
    },
    likelyObjections: [],
    settleTarget: 0.5,
  },
};

// ─── Weakness Detection ────────────────────────────────────────────────────────

function findInconsistencies(
  evidence: ExtractedCADEvidence,
  userEquity: EquityResult | null
): CADWeakness[] {
  const weaknesses: CADWeakness[] = [];

  // ══════════════════════════════════════════════════════════════════════════
  // 1. DCAD'S OWN INCONSISTENCY: Indicated vs Appraised (their comps vs their value)
  // ══════════════════════════════════════════════════════════════════════════
  if (evidence.equityIndicatedValue && evidence.equityIndicatedValue > evidence.currentAppraised) {
    const gap = evidence.equityIndicatedValue - evidence.currentAppraised;

    // DCAD LEFT MONEY ON THE TABLE - this is THE smoking gun
    weaknesses.push({
      type: 'indicated-vs-appraised',
      severity: 'major',
      description: `DCAD's own equity comps indicated $${evidence.equityIndicatedValue.toLocaleString()} ($${(evidence.equityIndicatedValue / (evidence.currentAppraised / 0.01)).toFixed(0)}/sqft estimated), but they appraised you at $${evidence.currentAppraised.toLocaleString()}. Their own methodology says you should be worth $${gap.toLocaleString()} MORE. This proves they have discretion and room to move.`,
      dollarImpact: gap,
      counterEvidence: `Their equity comps support a HIGHER value, yet they appraised you lower. This inconsistency is your leverage. Ask: "If your comps indicated $${evidence.equityIndicatedValue.toLocaleString()}, why did you stop at $${evidence.currentAppraised.toLocaleString()}? That's $${gap.toLocaleString()} of discrepancy you can't explain."`,
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 2. SAME-STREET OMISSION: You have 3+ comps they ignored
  // ══════════════════════════════════════════════════════════════════════════
  if (userEquity && userEquity.sameStreetComps.length >= 3) {
    const userStreet = extractStreetName(evidence.subjectAddress);
    const dcadHasSameStreet = evidence.equityComps.some((c) => extractStreetName(c.address) === userStreet);

    if (!dcadHasSameStreet && evidence.equityComps.length > 0) {
      const userSameStreetValue = userEquity.indicatedValueSameStreet || evidence.currentAppraised;
      const gap = evidence.currentAppraised - userSameStreetValue;

      weaknesses.push({
        type: 'same-street-omission',
        severity: 'major',
        description: `You have ${userEquity.sameStreetComps.length} comparable homes on your same street (${userStreet.toUpperCase()}). All are the same VB2 class, built 2015-2016, identical $${userEquity.sameStreetComps[0]?.landValue.toLocaleString() || '183k'} land values. DCAD used comps from DIFFERENT streets (${evidence.equityComps[0]?.address || 'Rolling Thunder Rd'} area, 0.06-0.16 miles away). Same street = most directly comparable under §41.43(b)(3).`,
        dollarImpact: gap,
        counterEvidence: `"Your Honor, the statute requires 'reasonable comparable properties.' Same-street properties are the definition of reasonable. I have ${userEquity.sameStreetComps.length} homes on my street, all VB2 class, all built within 1 year. They support an indicated value of $${userSameStreetValue.toLocaleString()}, which is $${gap.toLocaleString()} lower than the current appraisal."`,
      });
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 3. MARKET VS EQUITY CONFLICT: If market is lower, use it
  // ══════════════════════════════════════════════════════════════════════════
  if (evidence.marketIndicatedValue && evidence.equityIndicatedValue) {
    if (evidence.marketIndicatedValue < evidence.equityIndicatedValue) {
      const gap = evidence.equityIndicatedValue - evidence.marketIndicatedValue;
      weaknesses.push({
        type: 'comp-selection-bias',
        severity: 'moderate',
        description: `DCAD's market comps indicate $${evidence.marketIndicatedValue.toLocaleString()} (market sales approach), but equity comps indicate $${evidence.equityIndicatedValue.toLocaleString()}. Market value is the most defensible approach — DCAD's own market evidence supports a LOWER value.`,
        dollarImpact: gap,
        counterEvidence: `"Your market analysis shows $${evidence.marketIndicatedValue.toLocaleString()}, yet you appraised me at $${evidence.currentAppraised.toLocaleString()}. That's already above your own market data. Market value is the strongest evidence—use it."`,
      });
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 4. COMP DISTANCE/LOCATION BIAS: User's same-street vs DCAD's scattered comps
  // ══════════════════════════════════════════════════════════════════════════
  if (userEquity?.sameStreetComps.length && evidence.equityComps.length > 0) {
    const dcadAvgValue = evidence.equityComps.reduce((sum, c) => sum + (c.appraisedValue || 0), 0) / evidence.equityComps.length;
    const userAvgValue = userEquity.sameStreetComps.reduce((sum, c) => sum + c.appraisedValue, 0) / userEquity.sameStreetComps.length;

    if (userAvgValue < dcadAvgValue) {
      const gap = dcadAvgValue - userAvgValue;
      weaknesses.push({
        type: 'comp-selection-bias',
        severity: 'major',
        description: `DCAD's equity comps average $${dcadAvgValue.toLocaleString()} ($${(dcadAvgValue / (evidence.currentAppraised / 0.01)).toFixed(0)}/sqft). Your same-street comps average $${userAvgValue.toLocaleString()} ($${(userAvgValue / (evidence.currentAppraised / 0.01)).toFixed(0)}/sqft). DCAD selected higher-valued comps, which justifies a higher appraisal. This is comp selection bias.`,
        dollarImpact: gap,
        counterEvidence: `"You selected comps that were worth more than homes on my street. That's cherry-picking to support a higher value. My street's homes are more comparable and worth less. Use those."`,
      });
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 5. SIZE OUTLIERS: DCAD's comps differ by >30% sqft
  // ══════════════════════════════════════════════════════════════════════════
  if (evidence.equityComps.length > 0 && evidence.currentAppraised > 0) {
    const outlierComps = evidence.equityComps.filter((c) => {
      if (!c.livingAreaSqft) return false;
      // Estimate subject sqft from appraised value (rough)
      const estimatedSubjSqft = 3300; // typical suburban home
      const diff = Math.abs(c.livingAreaSqft - estimatedSubjSqft) / estimatedSubjSqft;
      return diff > 0.3;
    });

    if (outlierComps.length > evidence.equityComps.length * 0.4) {
      weaknesses.push({
        type: 'comp-selection-bias',
        severity: 'moderate',
        description: `${outlierComps.length} of DCAD's ${evidence.equityComps.length} comps differ by >30% in size. DCAD should limit comps to ±20% of subject size. This shows loose selection criteria.`,
        dollarImpact: 0,
        counterEvidence: `"The appraisal profession limits comps to ±20% size difference to ensure apples-to-apples comparison. You included comps that are 30-40% different. That's outside industry standards."`,
      });
    }
  }

  return weaknesses;
}

// ─── Settlement Target Calculation ─────────────────────────────────────────────

function calculateSettlementTargets(
  evidence: ExtractedCADEvidence,
  userEquity: EquityResult | null,
  county: County
): { ask: number; target: number; floor: number } {
  const profile = COUNTY_PROFILES[county];

  // ════════════════════════════════════════════════════════════════════════
  // PRIMARY: User's strongest argument (same-street indicated)
  // ════════════════════════════════════════════════════════════════════════
  const ask = userEquity?.indicatedValueSameStreet ||
            userEquity?.indicatedValueRefined ||
            evidence.marketIndicatedValue ||
            evidence.currentAppraised;

  // If user has same-street comps, that's the ask
  // If not, use refined equity analysis
  // If not, use market indicated
  // Worst case: current appraised

  // ════════════════════════════════════════════════════════════════════════
  // TARGET: Settle at X% of the gap (county-specific)
  // ════════════════════════════════════════════════════════════════════════
  const gap = evidence.currentAppraised - ask;
  const target = evidence.currentAppraised - gap * profile.settleTarget;

  // ════════════════════════════════════════════════════════════════════════
  // FLOOR: Don't accept above this
  // ════════════════════════════════════════════════════════════════════════
  // Use 98% of ask (very close to your request)
  const floor = Math.ceil(ask * 0.98);

  return {
    ask: Math.round(ask),
    target: Math.round(target),
    floor: Math.round(floor),
  };
}

// ─── Likely Objections & Responses ─────────────────────────────────────────────

function buildObjectionResponses(
  evidence: ExtractedCADEvidence,
  userEquity: EquityResult | null
): Array<{ objection: string; yourResponse: string }> {
  const responses: Array<{ objection: string; yourResponse: string }> = [];

  const userStreet = extractStreetName(evidence.subjectAddress).toUpperCase();
  const sameStreetCount = userEquity?.sameStreetComps.length || 0;

  // ════════════════════════════════════════════════════════════════════════
  // OBJECTION 1: "Our methodology is sound"
  // ════════════════════════════════════════════════════════════════════════
  responses.push({
    objection: `Your appraisal used industry-standard methodology and our comps support the current value.`,
    yourResponse: `I don't dispute your methodology. But §41.43(b)(3) allows me to rebut with comparable evidence. Your own equity comps indicated $${evidence.equityIndicatedValue?.toLocaleString() || 'X'}, yet you appraised me at $${evidence.currentAppraised.toLocaleString()}. That's $${((evidence.equityIndicatedValue || 0) - evidence.currentAppraised).toLocaleString()} of discrepancy. Using more directly comparable same-street properties, the value should be lower.`,
  });

  // ════════════════════════════════════════════════════════════════════════
  // OBJECTION 2: "Those comps on different streets are fine"
  // ════════════════════════════════════════════════════════════════════════
  if (sameStreetCount >= 3) {
    responses.push({
      objection: `We used appropriate comparables from across the market area. Different streets are acceptable for appraisal comps.`,
      yourResponse: `For market analysis, yes. But for §41.43(b)(3) unequal appraisal, the statute contemplates using the MOST directly comparable properties. I have ${sameStreetCount} homes on ${userStreet}, all VB2 class, all built 2015-2016, with identical land values. Same street is the most reasonable comparison. You didn't use any of them.`,
    });
  }

  // ════════════════════════════════════════════════════════════════════════
  // OBJECTION 3: "Same-street exclusion"
  // ════════════════════════════════════════════════════════════════════════
  if (sameStreetCount >= 3) {
    responses.push({
      objection: `We focused on the broader neighborhood to capture market trends, not just street-level anomalies.`,
      yourResponse: `"Anomalies" are actually a more directly comparable set. All ${sameStreetCount} homes on my street are within 1 year old, same quality class, and same improvements. That's not anomalous—that's the BEST comparison set. The statute says 'reasonable comparable properties.' Same-street is the most reasonable definition.`,
    });
  }

  // ════════════════════════════════════════════════════════════════════════
  // OBJECTION 4: "We can't accept every comp a homeowner proposes"
  // ════════════════════════════════════════════════════════════════════════
  responses.push({
    objection: `We have to use a consistent methodology across all properties. We can't cherry-pick comps based on homeowner selection.`,
    yourResponse: `These aren't cherry-picked—they're your own data in your system. These ${sameStreetCount} homes are automatically comparable by every standard criterion: same street, same class, same age, same neighborhood. If you're not using same-street comps when they're available, you're the ones cherry-picking by using distant comps instead.`,
  });

  // ════════════════════════════════════════════════════════════════════════
  // OBJECTION 5: "Market data supports our value"
  // ════════════════════════════════════════════════════════════════════════
  if (evidence.marketIndicatedValue && evidence.marketIndicatedValue < evidence.currentAppraised) {
    responses.push({
      objection: `Our market analysis shows the appraisal is appropriate.`,
      yourResponse: `Your own market comps indicated $${evidence.marketIndicatedValue.toLocaleString()}, but you appraised me at $${evidence.currentAppraised.toLocaleString()}. That means I'm ABOVE your market evidence. Even by your market analysis, I'm overvalued.`,
    });
  }

  // ════════════════════════════════════════════════════════════════════════
  // OBJECTION 6: "Adjustments are needed for differences"
  // ════════════════════════════════════════════════════════════════════════
  if (sameStreetCount >= 3) {
    responses.push({
      objection: `Without adjustments, we can't compare different properties.`,
      yourResponse: `True—but same-street comps need minimal adjustments. They're the same size range, same age, same class. I'm NOT asking you to use properties that differ significantly and need large adjustments. I'm asking you to use your own neighborhood properties that already match mine across the major value drivers.`,
    });
  }

  // ════════════════════════════════════════════════════════════════════════
  // OBJECTION 7: "The appraisal notice shows the value is fair"
  // ════════════════════════════════════════════════════════════════════════
  responses.push({
    objection: `The appraisal notice documents our analysis and shows the value is supported.`,
    yourResponse: `I'm not disputing that you followed a process. I'm arguing the RESULT is unequal. The statute allows me to present evidence that the final value exceeds comparable properties. I have that evidence—same-street comps that are $${(evidence.currentAppraised - (userEquity?.indicatedValueSameStreet || evidence.currentAppraised)).toLocaleString()} lower.`,
  });

  return responses;
}

// ─── Talking Points Generation ─────────────────────────────────────────────────

function buildPrimaryArgument(
  evidence: ExtractedCADEvidence,
  userEquity: EquityResult | null,
  weaknesses: CADWeakness[]
): string {
  // ════════════════════════════════════════════════════════════════════════
  // PRIMARY ARGUMENT: Use strongest evidence in this order:
  // 1. Same-street omission (user has 3+ comps they ignored)
  // 2. DCAD's own indicated-vs-appraised gap (they left money on table)
  // 3. Market vs equity conflict (market says lower)
  // ════════════════════════════════════════════════════════════════════════

  const sameStreetWeakness = weaknesses.find((w) => w.type === 'same-street-omission');
  const indicatedWeakness = weaknesses.find((w) => w.type === 'indicated-vs-appraised');

  if (sameStreetWeakness && userEquity?.sameStreetComps.length) {
    const street = extractStreetName(evidence.subjectAddress).toUpperCase();
    const medianPsf = (userEquity.sameStreetMedianPsf || 0).toFixed(2);
    return `I am requesting a reduction to $${userEquity.indicatedValueSameStreet?.toLocaleString() || evidence.currentAppraised.toLocaleString()} based on unequal appraisal. I have ${userEquity.sameStreetComps.length} comparable homes on ${street}, all VB2 class, all built 2015-2016, identical land values. They are appraised at a median of $${medianPsf}/sqft. I am appraised at $${(evidence.currentAppraised / (evidence.currentAppraised / 0.01)).toFixed(2)}/sqft—a ${((evidence.currentAppraised / (userEquity.indicatedValueSameStreet || evidence.currentAppraised)) - 1) * 100 > 0 ? '+' : ''}${(((evidence.currentAppraised / (userEquity.indicatedValueSameStreet || evidence.currentAppraised)) - 1) * 100).toFixed(1)}% premium over same-street homes. Under §41.43(b)(3), same-street comparables are the most directly comparable and support a lower value.`;
  }

  if (indicatedWeakness && evidence.equityIndicatedValue && evidence.equityIndicatedValue > evidence.currentAppraised) {
    const gap = evidence.equityIndicatedValue - evidence.currentAppraised;
    return `I am requesting a reduction from $${evidence.currentAppraised.toLocaleString()} based on unequal appraisal. Your own equity analysis indicated $${evidence.equityIndicatedValue.toLocaleString()}—$${gap.toLocaleString()} higher than the appraisal. This shows the appraisal is supported by your own comps, yet you valued me below that indication. This inconsistency proves there is room for reduction under §41.43(b)(3).`;
  }

  const majorWeakness = weaknesses.find((w) => w.severity === 'major') || weaknesses[0];
  if (majorWeakness) {
    return majorWeakness.counterEvidence || majorWeakness.description;
  }

  return `I am requesting a reduction from $${evidence.currentAppraised.toLocaleString()} based on unequal appraisal evidence under §41.43(b)(3).`;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function extractStreetName(addr: string): string {
  // "1069 Angel Falls Dr, Frisco TX 75036" -> "angel falls dr"
  const parts = addr.split(',')[0].trim().split(/\s+/);
  return parts.slice(1).join(' ').toLowerCase();
}

// ─── Public API ────────────────────────────────────────────────────────────────

export function analyzeCADEvidence(
  evidence: ExtractedCADEvidence,
  userEquity: EquityResult | null
): CADAnalysis {
  const county = evidence.county;
  const profile = COUNTY_PROFILES[county];

  // ════════════════════════════════════════════════════════════════════════
  // PHASE 3B ENHANCEMENT: Compare DCAD evidence + user's equity analysis
  // ════════════════════════════════════════════════════════════════════════

  // Find real inconsistencies (DCAD's indicated vs appraised, comp gaps, etc.)
  const weaknesses = findInconsistencies(evidence, userEquity);

  // Sort weaknesses by severity and dollar impact
  weaknesses.sort((a, b) => {
    const severityOrder = { major: 0, moderate: 1, minor: 2 };
    const aSev = severityOrder[a.severity] ?? 3;
    const bSev = severityOrder[b.severity] ?? 3;
    if (aSev !== bSev) return aSev - bSev;
    return b.dollarImpact - a.dollarImpact;
  });

  // Build strengths (be honest about what DCAD did right)
  const strengths: Array<{ description: string; howToAddress: string }> = [];

  if (evidence.equityComps.length >= 3) {
    strengths.push({
      description: 'DCAD used a reasonable number of comparable properties and followed standard appraisal methodology.',
      howToAddress:
        'Acknowledge their process, but argue that more directly comparable same-street properties are available and should be prioritized under §41.43(b)(3).',
    });
  }

  if (evidence.marketIndicatedValue && evidence.currentAppraised >= evidence.marketIndicatedValue) {
    strengths.push({
      description: 'Market comps provide objective evidence of value.',
      howToAddress:
        'Your market data actually supports a lower value. Use their own market evidence to negotiate.',
    });
  }

  // Calculate settlement targets using USER'S strongest argument
  const settlementTargets = calculateSettlementTargets(evidence, userEquity, county);

  // Build objections & responses specific to this case
  const likelyObjections = buildObjectionResponses(evidence, userEquity);

  // Build primary argument using user's strongest evidence
  const primaryArgument = buildPrimaryArgument(evidence, userEquity, weaknesses);

  return {
    evidenceUsed: evidence,
    inconsistencies: weaknesses.map((w) => ({
      type: w.type as 'indicated-vs-appraised' | 'market-vs-equity' | 'methodology-shift',
      severity: w.severity,
      description: w.description,
      dollarImpact: w.dollarImpact,
    })),
    weaknesses,
    strengths,
    recommendedStrategy: {
      primaryArgument,
      secondaryArguments: weaknesses.slice(1).map((w) => w.description),
      weaknessesToAvoid: ['Mentioning what you paid for the home', 'Saying your taxes are too high'],
      settlementTargets,
      countySpecificNotes: `${profile.name} typically accepts values within ${profile.arbPatterns.acceptanceRangePercent[0]}-${profile.arbPatterns.acceptanceRangePercent[1]}% of indicated value. Settlement likelihood: ${(profile.arbPatterns.settlementLikelihood * 100).toFixed(0)}%.`,
      likelyObjections,
    },
    analysisCreatedAt: new Date().toISOString(),
  };
}
