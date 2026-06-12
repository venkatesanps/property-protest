/**
 * Evidence packet generators (pdf-lib, fully client-side)
 *
 * Two documents are produced from the same analysis:
 *
 *   1. Board packet  — formal evidence to file with / present to the Appraisal
 *      Review Board (ARB). Facts, comps, requested value, statute citation.
 *
 *   2. Personal packet — the homeowner's private hearing-day playbook: the number
 *      to ask for, plain-English talking points, a what-to-say script, a
 *      bring-this checklist, deadlines and do/don't tips. NOT for submission.
 */

import { rgb } from 'pdf-lib';
import type { AnalysisResult } from '../engine/run';
import { getZipTrend } from '../adapters/redfinTrend';
import { COMPTROLLER_FORM, PROTEST_DEADLINE, DISCLAIMER, TAX_RATE, protestSeason } from '../constants';
import { fmtUSD, fmtNum, fmtPsf } from '../format';
import {
  createDoc,
  drawTable,
  MARGIN,
  PAGE_W,
  PAGE_H,
  NAVY,
  GRAY,
  SLATE,
  EMERALD,
  WHITE,
  type DocBuilder,
} from './builder';

const SUBTITLE = rgb(0.7, 0.78, 0.85);
const EMERALD_BG = rgb(0.9, 0.96, 0.93);
const AMBER_BG = rgb(0.99, 0.96, 0.86);

function countyLabel(county: string): string {
  if (county === 'collin') return 'Collin County (CCAD)';
  if (county === 'tarrant') return 'Tarrant County (TAD)';
  return 'Denton County (DCAD)';
}

/** Numbers + arguments derived once, shared by both packets. */
function derive(result: AnalysisResult) {
  const { subject, capFloor, equity, market, purchase, verdict } = result;
  const floor = capFloor.floor ?? subject.appraisedValue;

  // The value to request: verdict target, else the lowest indicated value we have.
  const indicated: number[] = [];
  if (equity) {
    indicated.push(equity.indicatedValueRefined, equity.indicatedValueSizeAdjusted);
    if (equity.indicatedValueClassMatched != null) indicated.push(equity.indicatedValueClassMatched);
    if (equity.indicatedValueSplit != null) indicated.push(equity.indicatedValueSplit);
  }
  if (market && market.estimatedValue > 0) indicated.push(market.estimatedValue);
  if (purchase && purchase.marketValue > 0) indicated.push(purchase.marketValue);
  if (result.listing && result.listing.listPrice > 0) indicated.push(result.listing.listPrice);
  const requested =
    verdict.targetValue ?? (indicated.length ? Math.min(...indicated) : null);

  // Open the conversation a touch below the ask so there is room to settle.
  const opening = requested != null ? Math.round((requested * 0.96) / 1000) * 1000 : null;
  const reduction = requested != null ? Math.max(0, Math.round(floor - requested)) : null;
  const savings = reduction != null ? Math.round(reduction * TAX_RATE) : null;

  // ── Plain-English talking points, strongest first. ──
  const points: string[] = [];
  if (purchase) {
    if (purchase.hpi) {
      const pct = purchase.hpi.pctChange;
      points.push(
        `You purchased this home for ${fmtUSD(purchase.price)} (${purchase.hpi.fromLabel}). Aged to today with the ${purchase.hpi.area} FHFA House Price Index (${pct >= 0 ? '+' : ''}${pct.toFixed(0)}% since), that is about ${fmtUSD(purchase.marketValue)} in current-market terms.`
      );
    } else {
      points.push(
        `You purchased this home recently for ${fmtUSD(purchase.price)} in an arms-length sale - the single strongest indicator of market value.`
      );
    }
  }
  if (equity) {
    points.push(
      `Your appraisal works out to ${fmtPsf(equity.subjectPsf)}/sqft versus a neighborhood median of ${fmtPsf(equity.neighborhoodMedianPsf)}/sqft - you are appraised higher than ${equity.percentileHigher.toFixed(0)}% of comparable homes (rank #${equity.subjectRankOf} of ${equity.neighborhoodCount}).`
    );
    points.push(
      `The median of comparable appraisals indicates a value of about ${fmtUSD(equity.indicatedValueRefined)} for a home like yours (refined, size/age-matched comps).`
    );
    if (equity.indicatedValueClassMatched != null) {
      points.push(
        `Limiting comps to your exact quality class (${subject.qualityClass}) indicates about ${fmtUSD(equity.indicatedValueClassMatched)} - an apples-to-apples comparison.`
      );
    }
    points.push(
      `After a size adjustment (larger homes carry lower $/sqft), comparable values indicate about ${fmtUSD(equity.indicatedValueSizeAdjusted)}.`
    );
    if (
      equity.indicatedValueSplit != null &&
      equity.indicatedImprovementValue != null &&
      equity.indicatedLandValue != null
    ) {
      points.push(
        `Splitting land from building: neighborhood comps indicate about ${fmtUSD(equity.indicatedLandValue)} in land and ${fmtUSD(equity.indicatedImprovementValue)} in building (${fmtPsf(equity.improvementMedianPsf ?? 0)}/sqft), for an indicated total of about ${fmtUSD(equity.indicatedValueSplit)}.`
      );
    }
  }
  if (result.listing && result.listing.listPrice > 0) {
    points.push(
      `This property is currently listed for sale at ${fmtUSD(result.listing.listPrice)}${result.listing.mlsName ? ` (${result.listing.mlsName}${result.listing.mlsNumber ? ` MLS# ${result.listing.mlsNumber}` : ''})` : ''} — an active list price below the CAD appraised value is the strongest market-value exhibit you can bring.`
    );
  }
  if (market && market.source !== 'purchase' && market.estimatedValue > 0) {
    points.push(
      `Market-value evidence (${market.source === 'rentcast' ? 'an automated valuation' : 'comparable sales you supplied'}) puts the home around ${fmtUSD(market.estimatedValue)}.`
    );
  }
  if (verdict.repairAdjustment != null) {
    points.push(
      `Documented repairs / deferred maintenance total about ${fmtUSD(verdict.repairAdjustment)}, which should come off the value - bring the contractor bids.`
    );
  }
  if (capFloor.available && capFloor.isCapped) {
    points.push(
      `Note: your homestead 10% cap already holds your taxable value at ${fmtUSD(floor)}. A reduction only lowers your bill if your argued value drops below that floor.`
    );
  }
  if (result.floodZone?.sfha) {
    points.push(
      `This property is in FEMA flood zone ${result.floodZone.zone} (Special Flood Hazard Area). Mandatory flood insurance adds $1,500-$4,000+/year in holding costs and buyers typically discount SFHA homes 5-15% below comparable non-flood properties. Attach the FEMA FIRM map panel as an exhibit.`
    );
  }
  if (result.characteristics) {
    const ch = result.characteristics;
    if (ch.actualSqft != null && ch.actualSqft < subject.livingAreaSqft) {
      points.push(
        `The CAD record shows ${fmtNum(subject.livingAreaSqft)} sqft, but the actual living area is ${fmtNum(ch.actualSqft)} sqft - an overstatement of ${fmtNum(subject.livingAreaSqft - ch.actualSqft)} sqft. The district appraised your home at a higher $/sqft ratio than it should have. Bring a floor plan, tax form, or appraisal as exhibit.`
      );
    }
    if (ch.wrongQualityClass) {
      points.push(
        `The CAD quality class (${subject.qualityClass}) is disputed. A lower class produces a lower value per sqft across the neighborhood and is independent grounds for reduction.`
      );
    }
  }

  return { floor, requested, opening, reduction, savings, points };
}

// ── Shared chrome ──────────────────────────────────────────────────────────────

function titleBand(b: DocBuilder, title: string, subtitle: string) {
  const pg = b.page();
  const h = 66;
  pg.drawRectangle({ x: 0, y: PAGE_H - h, width: PAGE_W, height: h, color: NAVY });
  pg.drawText(title, { x: MARGIN, y: PAGE_H - 34, size: 19, font: b.bold, color: WHITE });
  pg.drawText(subtitle, { x: MARGIN, y: PAGE_H - 52, size: 9.5, font: b.font, color: SUBTITLE });
  b.gap(38); // drop the cursor below the band
}

function disclaimer(b: DocBuilder) {
  b.gap(12);
  b.wrap(DISCLAIMER, { size: 8, color: GRAY });
}

function compRows(comps: import('../types').Comp[]): string[][] {
  return comps.map((c) => [
    c.address.slice(0, 40),
    fmtNum(c.livingAreaSqft),
    c.yearBuilt ? String(c.yearBuilt) : '-',
    fmtUSD(c.appraisedValue),
    fmtPsf(c.pricePerSqft),
  ]);
}

const COMP_XS = [MARGIN, MARGIN + 230, MARGIN + 300, MARGIN + 360, MARGIN + 440];

// ─────────────────────────────────────────────────────────────────────────────
// 1. BOARD PACKET — formal evidence for the ARB
// ─────────────────────────────────────────────────────────────────────────────

export async function generateBoardPacket(result: AnalysisResult): Promise<Uint8Array> {
  const { subject, capFloor, equity, market, verdict } = result;
  const d = derive(result);
  const b = await createDoc();

  titleBand(
    b,
    'Property Tax Protest - Evidence Packet',
    `${countyLabel(subject.county)}   |   ${subject.rollLabel}   |   For the Appraisal Review Board   |   Generated ${new Date().toLocaleDateString('en-US')}`
  );

  // Requested value up top so the appraiser sees the ask immediately.
  if (d.requested != null) {
    b.callout(
      [
        { text: `Requested appraised value: ${fmtUSD(d.requested)}`, size: 13, bold: true, color: NAVY },
        ...(d.reduction
          ? [
              {
                text: `Reduction of ${fmtUSD(d.reduction)} from the current ${fmtUSD(d.floor)} (est. ${fmtUSD(d.savings ?? 0)}/yr in tax savings).`,
                size: 10,
              },
            ]
          : []),
        ...(verdict.methodUsed ? [{ text: `Primary basis: ${verdict.methodUsed}.`, size: 9.5, color: GRAY }] : []),
      ],
      EMERALD_BG
    );
  }

  // ── Subject ──
  b.heading('Subject Property');
  b.kv('Account / PID', subject.account);
  b.kv('Address', subject.address);
  b.kv('Living area (sqft)', fmtNum(subject.livingAreaSqft));
  b.kv('Year built', subject.yearBuilt ? String(subject.yearBuilt) : 'n/a');
  b.kv('Quality class', subject.qualityClass || 'n/a');
  b.kv('Neighborhood code', subject.neighborhoodCode || 'n/a');
  b.kv('Current appraised value', fmtUSD(subject.appraisedValue), NAVY);
  b.kv('Current market value', fmtUSD(subject.marketValue));
  if (capFloor.available && capFloor.netAppraisedValue != null) {
    b.kv('Net appraised (taxable)', fmtUSD(capFloor.netAppraisedValue));
  }

  // ── Grounds ──
  b.heading('Grounds for Protest');
  b.wrap(
    'The owner protests on the grounds of (1) over-market value and (2) unequal appraisal under ' +
      'Tex. Tax Code 41.43(b)(3): the appraised value exceeds the median appraised value of a ' +
      'reasonable number of comparable properties, appropriately adjusted.',
  );

  // ── Homestead cap ──
  b.heading('Homestead Cap (10%) Check');
  if (!capFloor.available) {
    b.wrap(
      'The taxable (net appraised) value is not published in this county dataset, so the homestead-cap ' +
        'floor could not be verified automatically. If the owner has a homestead exemption, a reduction ' +
        'lowers the tax bill only if the argued value falls below the capped taxable value on the notice.',
    );
  } else if (capFloor.isCapped) {
    b.kv('Appraised value', fmtUSD(capFloor.appraisedValue));
    b.kv('Taxable floor (capped)', fmtUSD(capFloor.floor ?? 0));
    b.wrap('The 10% homestead cap already holds the taxable value below market.');
  } else {
    b.kv('Taxable floor', fmtUSD(capFloor.floor ?? 0));
    b.text('Not currently capped - appraised value equals taxable value.');
  }

  // ── Unequal appraisal ──
  b.heading('Unequal Appraisal Analysis (Tex. Tax Code 41.43(b)(3))');
  if (!equity) {
    b.wrap('Not enough comparable properties were found in this neighborhood to run the equity analysis.');
  } else {
    b.kv('Subject $/sqft', fmtPsf(equity.subjectPsf));
    b.kv('Neighborhood median $/sqft', fmtPsf(equity.neighborhoodMedianPsf));
    b.kv('Refined comps median $/sqft', fmtPsf(equity.refinedMedianPsf));
    b.kv('Indicated value (all comps)', fmtUSD(equity.indicatedValueAll));
    b.kv('Indicated value (refined)', fmtUSD(equity.indicatedValueRefined), NAVY);
    if (equity.indicatedValueClassMatched != null) {
      b.kv(
        `Indicated value (class ${subject.qualityClass})`,
        `${fmtUSD(equity.indicatedValueClassMatched)}  (${equity.classMatchedComps.length} same-class comps)`
      );
    }
    b.kv('Indicated value (size adjusted)', fmtUSD(equity.indicatedValueSizeAdjusted));
    if (
      equity.indicatedValueSplit != null &&
      equity.indicatedLandValue != null &&
      equity.indicatedImprovementValue != null
    ) {
      b.kv(
        'Indicated value (land + building)',
        `${fmtUSD(equity.indicatedValueSplit)}  (land ${fmtUSD(equity.indicatedLandValue)} + bldg ${fmtUSD(equity.indicatedImprovementValue)})`,
        NAVY
      );
    }
    b.kv('Subject rank', `#${equity.subjectRankOf} of ${equity.neighborhoodCount} (1 = highest $/sqft)`);
    b.gap(4);
    b.text('Comparable properties (refined set, sorted by $/sqft):', { font: b.bold });
    const comps = equity.refinedComps.length >= 3 ? equity.refinedComps : equity.comps;
    drawTable(b, ['Address', 'SqFt', 'Year', 'Apprsd', '$/sqft'], compRows(comps), COMP_XS);
  }

  // ── Active MLS listing ──
  if (result.listing && result.listing.listPrice > 0) {
    b.heading('Active MLS Listing');
    b.kv('List price', fmtUSD(result.listing.listPrice), NAVY);
    b.kv('Status', result.listing.status);
    if (result.listing.daysOnMarket != null) b.kv('Days on market', String(result.listing.daysOnMarket));
    if (result.listing.listedDate) b.kv('Listed', result.listing.listedDate.slice(0, 10));
    if (result.listing.mlsName) {
      b.kv('MLS', `${result.listing.mlsName}${result.listing.mlsNumber ? ` · #${result.listing.mlsNumber}` : ''}`);
    }
    if (result.listing.listPrice < result.subject.appraisedValue) {
      b.gap(4);
      b.wrap(
        `The active list price (${fmtUSD(result.listing.listPrice)}) is ` +
        `${fmtUSD(result.subject.appraisedValue - result.listing.listPrice)} below the CAD appraised value ` +
        `(${fmtUSD(result.subject.appraisedValue)}). An arms-length list price is compelling market-value evidence ` +
        `under Tex. Tax Code §41.43(a). Print the MLS listing sheet and attach it as Exhibit A.`,
        { color: NAVY }
      );
    }
  }

  // ── Market evidence ──
  if (market && market.estimatedValue > 0) {
    b.heading('Market Value Evidence');
    const src =
      market.source === 'rentcast'
        ? 'Automated valuation (RentCast)'
        : market.source === 'purchase'
          ? 'Recent purchase price'
          : 'Comparable sales (owner-supplied)';
    b.kv('Source', src);
    b.kv('Estimated market value', fmtUSD(market.estimatedValue), NAVY);
    if (market.lowRange != null && market.highRange != null) {
      b.kv('Estimate range', `${fmtUSD(market.lowRange)} - ${fmtUSD(market.highRange)}`);
    }
    if (market.comparables && market.comparables.length > 0) {
      b.gap(4);
      b.text('Comparable sales:', { font: b.bold });
      drawTable(
        b,
        ['Address', 'Sale', 'Date', 'SqFt', '$/sqft'],
        market.comparables.map((c) => [
          c.address.slice(0, 40),
          fmtUSD(c.salePrice),
          c.saleDate ? c.saleDate.slice(0, 10) : '-',
          fmtNum(c.livingAreaSqft),
          fmtPsf(c.pricePerSqft),
        ]),
        [MARGIN, MARGIN + 230, MARGIN + 310, MARGIN + 390, MARGIN + 460]
      );
    }
  }

  // ── Recent purchase / HPI ──
  if (result.purchase) {
    const p = result.purchase;
    b.heading('Recent Purchase Evidence');
    b.kv('Purchase price', fmtUSD(p.price));
    if (p.date) b.kv('Purchase date', p.date);
    if (p.hpi) {
      b.kv(
        'Aged to today (FHFA HPI)',
        `${fmtUSD(p.marketValue)}  (${p.hpi.fromLabel} -> ${p.hpi.toLabel}, ${p.hpi.pctChange >= 0 ? '+' : ''}${p.hpi.pctChange.toFixed(1)}%)`,
        NAVY
      );
      b.wrap(
        `Current-market estimate derived from the ${p.hpi.area} FHFA House Price Index ` +
          '(a public, area-wide index of home-price change). It ages the actual purchase ' +
          'price to the present; it is an area average, not a property-specific appraisal.',
        { size: 9, color: GRAY }
      );
    } else {
      b.wrap('A recent arms-length purchase is the strongest single indicator of market value.', {
        size: 9,
        color: GRAY,
      });
    }
  }

  // ── Redfin ZIP median sale price ──
  const zipMatch = result.subject.address.match(/\b(7\d{4})\b/);
  const subjectZip = zipMatch ? zipMatch[1] : null;
  const zipTrend = getZipTrend(subjectZip);
  if (zipTrend && subjectZip) {
    b.heading('Redfin ZIP Median Sale Price');
    b.kv('ZIP', subjectZip);
    b.kv('Median sale price', fmtUSD(zipTrend.medianSalePrice), NAVY);
    b.kv('Month', zipTrend.latestMonth);
    b.kv('12-month change', `${zipTrend.pctChange12mo >= 0 ? '+' : ''}${zipTrend.pctChange12mo.toFixed(1)}%`);
    b.wrap(
      'Source: Redfin Data Center (free public data, updated monthly). This is a ZIP-level ' +
      'median for single-family homes — use as market context, not an indicated value for ' +
      'this specific home.',
      { size: 9, color: GRAY }
    );
  }

  // ── Flood zone ──
  if (result.floodZone) {
    const fz = result.floodZone;
    b.heading('FEMA Flood Zone');
    b.kv('Zone', fz.zone, fz.sfha ? EMERALD : undefined);
    b.kv('Special Flood Hazard Area', fz.sfha ? 'YES' : 'No', fz.sfha ? EMERALD : undefined);
    b.wrap(fz.description, { size: 9.5 });
    if (fz.sfha) {
      b.wrap(
        'Properties in an SFHA require mandatory flood insurance ($1,500-$4,000+/yr), which ' +
        'reduces buyer purchasing power and results in 5-15% price discounts versus comparable ' +
        'non-flood properties. This supports a market-value reduction under Tex. Tax Code 41.43(a). ' +
        'Attach the FEMA FIRM map panel as Exhibit.',
        { size: 9, color: GRAY }
      );
    }
  }

  // ── Condition / deferred maintenance ──
  if (result.condition) {
    const c = result.condition;
    const total = c.foundation + c.roof + c.hvac + c.plumbingElectrical + c.other;
    if (total > 0) {
      b.heading('Property Condition - Deferred Maintenance');
      b.wrap(
        'Documented repair estimates reduce the effective market value of the property. ' +
        'Contractor bids should be attached as exhibits.',
        { size: 9.5 }
      );
      if (c.foundation > 0) b.kv('Foundation repair estimate', fmtUSD(c.foundation));
      if (c.roof > 0)       b.kv('Roof repair estimate', fmtUSD(c.roof));
      if (c.hvac > 0)       b.kv('HVAC replacement estimate', fmtUSD(c.hvac));
      if (c.plumbingElectrical > 0)
        b.kv('Plumbing / electrical estimate', fmtUSD(c.plumbingElectrical));
      if (c.other > 0)      b.kv('Other repairs', fmtUSD(c.other));
      b.kv('Total condition deduction', fmtUSD(total), NAVY);
      if (c.notes) b.wrap(c.notes, { size: 9, color: GRAY });
    }
  }

  // ── CAD record discrepancies ──
  if (result.characteristics) {
    const ch = result.characteristics;
    const hasAnything = ch.actualSqft != null || ch.wrongQualityClass ||
      ch.characteristicsNotes.trim().length > 0;
    if (hasAnything) {
      b.heading('CAD Record Discrepancies');
      b.wrap(
        'The owner disputes the following characteristics in the CAD record. An incorrect ' +
        'square footage directly changes the per-sqft appraisal ratio and is independent ' +
        'grounds for reduction.',
        { size: 9.5 }
      );
      if (ch.actualSqft != null) {
        b.kv('CAD living area', fmtNum(subject.livingAreaSqft) + ' sqft');
        b.kv('Owner-reported living area', fmtNum(ch.actualSqft) + ' sqft', NAVY);
        if (ch.actualSqft < subject.livingAreaSqft) {
          b.wrap(
            `CAD overstates living area by ${fmtNum(subject.livingAreaSqft - ch.actualSqft)} sqft. ` +
            'Provide a floor plan, tax form, or appraisal as exhibit.',
            { size: 9, color: GRAY }
          );
        }
      }
      if (ch.wrongQualityClass) {
        b.kv('Quality class', `CAD shows ${subject.qualityClass} - owner disputes this classification`);
      }
      if (ch.characteristicsNotes) b.wrap(ch.characteristicsNotes, { size: 9, color: GRAY });
    }
  }

  disclaimer(b);
  return b.bytes();
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. PERSONAL PACKET — the homeowner's hearing-day playbook
// ─────────────────────────────────────────────────────────────────────────────

export async function generatePersonalPacket(result: AnalysisResult): Promise<Uint8Array> {
  const { subject } = result;
  const d = derive(result);
  const b = await createDoc();

  titleBand(
    b,
    'Your Hearing Playbook',
    `${subject.address}  |  Personal prep - do NOT submit this page to the ARB`
  );

  // ── Bottom line ──
  if (d.requested != null) {
    b.callout(
      [
        { text: 'YOUR BOTTOM LINE', size: 10, bold: true, color: EMERALD },
        { text: `Ask the board to set your value at: ${fmtUSD(d.requested)}`, size: 13, bold: true, color: NAVY },
        ...(d.opening
          ? [{ text: `Open the conversation at ${fmtUSD(d.opening)} - it gives you room to settle.`, size: 10 }]
          : []),
        ...(d.savings
          ? [{ text: `If you win the full reduction, you save roughly ${fmtUSD(d.savings)} per year.`, size: 10 }]
          : []),
      ],
      EMERALD_BG
    );
  } else {
    b.callout(
      [
        { text: 'HEADS UP', size: 10, bold: true, color: SLATE },
        { text: result.verdict.headline, size: 12, bold: true, color: NAVY },
        { text: 'The data does not clearly support a reduction this year - read the summary before filing.', size: 10 },
      ],
      AMBER_BG,
      rgb(0.85, 0.6, 0.1)
    );
  }

  // ── How it works ──
  b.heading('How the Protest Works (3 steps)');
  const fileStep =
    protestSeason().phase === 'filing'
      ? `1. FILE. Submit Comptroller Form ${COMPTROLLER_FORM} (Notice of Protest) to ${countyLabel(subject.county)} by ${PROTEST_DEADLINE}, or within 30 days of your appraisal notice - whichever is later. Check BOTH boxes: "over market value" and "unequal appraisal."`
      : `1. FILE. The regular ${PROTEST_DEADLINE} deadline has passed. If you have not filed, you may still submit Form ${COMPTROLLER_FORM} as a LATE protest for good cause (Tex. Tax Code 41.44(b)) until the ARB approves the records, or pursue a Sec. 25.25 correction motion. If you already filed, skip to step 2. Check BOTH boxes: "over market value" and "unequal appraisal."`;
  const steps = [
    fileStep,
    '2. INFORMAL MEETING. Most cases settle here. You meet one-on-one with a district appraiser, show your evidence, and they often make an offer on the spot. If the offer is close to your number, you can accept and you are done.',
    '3. FORMAL ARB HEARING. If you do not settle, you present to a 3-person Appraisal Review Board. It is informal - about 15 minutes. You speak, the district appraiser responds, the board decides that day.',
  ];
  for (const s of steps) {
    b.wrap(s);
    b.gap(3);
  }

  // ── Talking points ──
  b.heading('Your Strongest Arguments');
  if (d.points.length === 0) {
    b.wrap('No automated arguments were generated. Bring any evidence that your value is too high.');
  } else {
    for (const p of d.points) {
      b.wrap(`-  ${p}`);
      b.gap(2);
    }
  }

  // ── Script ──
  b.heading('What To Say');
  b.text('At the informal meeting:', { font: b.bold, color: SLATE });
  b.wrap(
    `"Hi, I'm protesting the value on ${subject.address}. I have two grounds: it's over market value, ` +
      `and it's unequally appraised compared to my neighbors. Based on comparable appraisals in my own ` +
      `neighborhood, the median indicates about ${d.requested != null ? fmtUSD(d.requested) : 'a lower value'}. ` +
      `Here's my evidence packet. I'd like the value reduced to ${d.requested != null ? fmtUSD(d.requested) : 'that figure'}."`,
  );
  b.gap(4);
  b.text('If they counter higher than your number:', { font: b.bold, color: SLATE });
  b.wrap(
    '"I appreciate that, but my comparables clearly support a lower figure. Can we meet closer to ' +
      `${d.requested != null ? fmtUSD(d.requested) : 'my requested value'}?" Stay calm, stay on the data, and ` +
      'do not feel pressured to accept the first offer.',
  );
  b.gap(4);
  b.text('At the formal ARB hearing:', { font: b.bold, color: SLATE });
  b.wrap(
    'Hand each board member a copy of the BOARD packet. Walk through your strongest argument first ' +
      '(usually the unequal-appraisal table), state your requested value, and stop. Answer their ' +
      'questions briefly and factually. Then thank them.',
  );

  // ── Checklist ──
  b.heading('Bring This To Your Hearing');
  const checklist = [
    'The BOARD evidence packet (printed - one copy for you, three for the ARB).',
    'Closing disclosure / settlement statement, if you bought recently (strongest market proof).',
    'Any independent fee appraisal you have.',
    'Contractor bids / repair estimates: foundation, roof, HVAC, plumbing (these reduce value).',
    'Dated photos of defects, damage, or deferred maintenance.',
    'Notes on negative location factors: backs to highway/commercial, power lines, flood plain, easements.',
    'Your appraisal notice and a photo ID.',
  ];
  for (const c of checklist) b.wrap(`[ ]  ${c}`, { size: 9.5 });

  // ── Do / Don't ──
  b.heading('Do / Don\'t');
  const dos = [
    'DO be polite and concise - the board hears dozens of cases a day.',
    'DO lead with your single best piece of evidence.',
    'DO write down any offer before accepting it.',
    "DON'T mention what you paid if you bought years ago and the value rose - it can hurt you.",
    "DON'T argue your taxes are too high - argue your VALUE is too high. Only value is in scope.",
    "DON'T accept a lowball informal offer if your comps clearly support more of a reduction.",
  ];
  for (const line of dos) b.wrap(line, { size: 9.5 });

  disclaimer(b);
  return b.bytes();
}

// ─────────────────────────────────────────────────────────────────────────────

/** Trigger a browser download of generated PDF bytes. */
export function downloadPacket(bytes: Uint8Array, filename: string) {
  const ab = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(ab).set(bytes);
  const blob = new Blob([ab], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  // Safari (especially iOS) can cancel the download if the URL is revoked
  // before the save sheet finishes with it.
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 10_000);
}
