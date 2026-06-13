/**
 * Counter-Strategy Analysis Engine
 *
 * Analyzes CAD evidence packets to identify:
 * 1. Inconsistencies in DCAD's own analysis
 * 2. Weaknesses in their comp selection
 * 3. Opportunities for negotiation
 * 4. County-specific settlement targets
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

  // 1. Indicated-vs-Appraised Gap
  if (evidence.equityIndicatedValue && evidence.equityIndicatedValue !== evidence.currentAppraised) {
    const gap = Math.abs(evidence.equityIndicatedValue - evidence.currentAppraised);
    const gapPercent = (gap / evidence.currentAppraised) * 100;

    if (gapPercent > 1) {
      const direction = evidence.equityIndicatedValue > evidence.currentAppraised ? 'overvalued' : 'undervalued';
      weaknesses.push({
        type: 'indicated-vs-appraised',
        severity: gapPercent > 5 ? 'major' : 'moderate',
        description: `DCAD's equity comps indicated $${evidence.equityIndicatedValue.toLocaleString()}, but they appraised you at $${evidence.currentAppraised.toLocaleString()}. This shows they left $${gap.toLocaleString()} on the table and then ${direction} you anyway.`,
        dollarImpact: gap,
        counterEvidence: `Use DCAD's own indicated value to argue for a lower appraisal. If their comps support $${evidence.equityIndicatedValue.toLocaleString()}, why didn't they use it?`,
      });
    }
  }

  // 2. Market vs Equity Conflict
  if (
    evidence.marketIndicatedValue &&
    evidence.equityIndicatedValue &&
    evidence.marketIndicatedValue < evidence.equityIndicatedValue
  ) {
    const gap = evidence.equityIndicatedValue - evidence.marketIndicatedValue;
    weaknesses.push({
      type: 'comp-selection-bias',
      severity: 'moderate',
      description: `DCAD's market comps indicate $${evidence.marketIndicatedValue.toLocaleString()}, but their equity comps indicate $${evidence.equityIndicatedValue.toLocaleString()}. The market says you're worth less than the equity approach.`,
      dollarImpact: gap,
      counterEvidence: 'Use the lower market value as your requested value. Market is the most defensible approach for §41.43(a).',
    });
  }

  // 3. Same-Street Omission (if user has better same-street comps)
  if (userEquity && userEquity.sameStreetComps.length >= 3 && evidence.equityComps.length > 0) {
    // Check if any of DCAD's comps are same-street
    const userStreet = extractStreetName(evidence.subjectAddress);
    const dcadHasSameStreet = evidence.equityComps.some((c) => extractStreetName(c.address) === userStreet);

    if (!dcadHasSameStreet) {
      const userSameStreetValue = userEquity.indicatedValueSameStreet || 0;
      const gap = Math.abs(userSameStreetValue - evidence.currentAppraised);

      weaknesses.push({
        type: 'same-street-omission',
        severity: 'major',
        description: `You have ${userEquity.sameStreetComps.length} homes on your own street that are more comparable than DCAD's selections. DCAD didn't use any same-street comps in their analysis.`,
        dollarImpact: gap,
        counterEvidence: `Present the same-street comps to the ARB. §41.43(b)(3) requires 'reasonable comparable properties' — same street is the most reasonable.`,
      });
    }
  }

  // 4. Comp Quality Issues
  if (evidence.equityComps.length > 0) {
    // Check for comps with very different sqft (suggesting poor quality)
    const subjSqft = extractSqftFromAddress() || 3500; // default
    const outlierComps = evidence.equityComps.filter((c) => {
      const cSqft = c.livingAreaSqft || 3500;
      const diff = Math.abs(cSqft - subjSqft) / subjSqft;
      return diff > 0.3; // >30% difference
    });

    if (outlierComps.length > evidence.equityComps.length / 2) {
      weaknesses.push({
        type: 'comp-selection-bias',
        severity: 'moderate',
        description: `Many of DCAD's comps differ by >30% in size. This suggests they cherry-picked properties to justify a high value.`,
        dollarImpact: 0,
        counterEvidence: 'Point out the size differences. DCAD should limit comps to ±20% of subject size.',
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

  // Primary ask: use user's same-street indicated value if available
  let ask = userEquity?.indicatedValueSameStreet || userEquity?.indicatedValueRefined || evidence.currentAppraised;

  // If user doesn't have same-street, try market evidence
  if (!userEquity?.indicatedValueSameStreet && evidence.marketIndicatedValue) {
    ask = Math.min(ask, evidence.marketIndicatedValue);
  }

  // Target: settle at ~60% of the gap between current and ask
  const gap = evidence.currentAppraised - ask;
  const target = evidence.currentAppraised - gap * profile.settleTarget;

  // Floor: don't accept above this (95% of ask)
  const floor = Math.ceil(ask * 0.95);

  return {
    ask: Math.round(ask),
    target: Math.round(target),
    floor: Math.round(floor),
  };
}

// ─── Likely Objections & Responses ─────────────────────────────────────────────

function buildObjectionResponses(county: County): Array<{
  objection: string;
  yourResponse: string;
}> {
  const profile = COUNTY_PROFILES[county];
  const responses: Array<{ objection: string; yourResponse: string }> = [];

  // Generic objections
  responses.push({
    objection: `${profile.name} used a proven methodology`,
    yourResponse:
      'I agree, but the statute allows rebuttal with evidence of unequal appraisal. My evidence shows I am overvalued relative to comparable properties.',
  });

  responses.push({
    objection: 'The comps DCAD selected are appropriate',
    yourResponse: `My analysis shows more directly comparable properties. Under §41.43(b)(3), I am entitled to propose reasonable comparables of my own.`,
  });

  responses.push({
    objection: 'Size adjustments are standard and justified',
    yourResponse: 'The statute limits adjustments to "reasonable" amounts. I am requesting a value based on unadjusted same-street comps.',
  });

  // County-specific objections
  profile.likelyObjections.forEach((obj) => {
    responses.push({
      objection: obj,
      yourResponse: `That may be their methodology, but the statute allows rebuttal. My evidence is defensible under §41.43(b)(3).`,
    });
  });

  return responses;
}

// ─── Talking Points Generation ─────────────────────────────────────────────────

function buildPrimaryArgument(evidence: ExtractedCADEvidence, weaknesses: CADWeakness[]): string {
  // Find the strongest weakness
  const majorWeakness = weaknesses.find((w) => w.severity === 'major') || weaknesses[0];

  if (!majorWeakness) {
    return `I am requesting a reduction from $${evidence.currentAppraised.toLocaleString()} based on unequal appraisal evidence.`;
  }

  return majorWeakness.counterEvidence || majorWeakness.description;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function extractStreetName(addr: string): string {
  // "1069 Angel Falls Dr, Frisco TX 75036" -> "angel falls dr"
  const parts = addr.split(',')[0].trim().split(/\s+/);
  return parts.slice(1).join(' ').toLowerCase();
}

function extractSqftFromAddress(): number | null {
  // Would need additional data; returning null for now
  return null;
}

// ─── Public API ────────────────────────────────────────────────────────────────

export function analyzeCADEvidence(
  evidence: ExtractedCADEvidence,
  userEquity: EquityResult | null
): CADAnalysis {
  const county = evidence.county;
  const profile = COUNTY_PROFILES[county];

  // Find weaknesses
  const weaknesses = findInconsistencies(evidence, userEquity);

  // Build strengths (be honest about DCAD's case)
  const strengths: Array<{ description: string; howToAddress: string }> = [];

  if (evidence.equityComps.length >= 3) {
    strengths.push({
      description: 'DCAD used a reasonable number of comparable properties.',
      howToAddress:
        'Acknowledge their methodology but argue your comps are more directly comparable under the statute.',
    });
  }

  // Calculate settlement targets
  const settlementTargets = calculateSettlementTargets(evidence, userEquity, county);

  // Build objections & responses
  const likelyObjections = buildObjectionResponses(county);

  // Build primary argument
  const primaryArgument = buildPrimaryArgument(evidence, weaknesses);

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
