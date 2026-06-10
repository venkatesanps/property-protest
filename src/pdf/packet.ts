/**
 * Evidence packet generator (pdf-lib, fully client-side)
 *
 * Produces a printable PDF the homeowner can attach to a Comptroller Form 50-132
 * Notice of Protest. ASCII-only text (pdf-lib's StandardFonts can't render the
 * '$' is fine, but em-dashes / smart quotes are not — keep everything ASCII).
 */

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { PDFFont, PDFPage } from 'pdf-lib';
import type { AnalysisResult } from '../engine/run';
import { COMPTROLLER_FORM, PROTEST_DEADLINE, DISCLAIMER, TAX_RATE } from '../constants';
import { fmtUSD, fmtNum, fmtPsf } from '../format';

const MARGIN = 50;
const PAGE_W = 612; // US Letter
const PAGE_H = 792;
const NAVY = rgb(0.09, 0.16, 0.31);
const GRAY = rgb(0.35, 0.35, 0.35);
const BLACK = rgb(0, 0, 0);

// Strip anything outside the WinAnsi/ASCII range so pdf-lib never throws.
const ascii = (s: string): string =>
  (s ?? '').replace(/[^\x20-\x7E]/g, (c) => (c === '–' || c === '—' ? '-' : ' '));

interface Cursor {
  page: PDFPage;
  y: number;
}

export async function generatePacket(result: AnalysisResult): Promise<Uint8Array> {
  const { subject, capFloor, equity, market, verdict } = result;
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  let page = doc.addPage([PAGE_W, PAGE_H]);
  const cur: Cursor = { page, y: PAGE_H - MARGIN };

  const newPageIfNeeded = (need: number) => {
    if (cur.y - need < MARGIN) {
      page = doc.addPage([PAGE_W, PAGE_H]);
      cur.page = page;
      cur.y = PAGE_H - MARGIN;
    }
  };

  const text = (
    s: string,
    opts: { size?: number; font?: PDFFont; color?: ReturnType<typeof rgb>; indent?: number } = {}
  ) => {
    const size = opts.size ?? 10;
    newPageIfNeeded(size + 4);
    cur.page.drawText(ascii(s), {
      x: MARGIN + (opts.indent ?? 0),
      y: cur.y,
      size,
      font: opts.font ?? font,
      color: opts.color ?? BLACK,
    });
    cur.y -= size + 5;
  };

  const heading = (s: string) => {
    cur.y -= 8;
    newPageIfNeeded(20);
    cur.page.drawText(ascii(s), { x: MARGIN, y: cur.y, size: 13, font: bold, color: NAVY });
    cur.y -= 6;
    cur.page.drawLine({
      start: { x: MARGIN, y: cur.y },
      end: { x: PAGE_W - MARGIN, y: cur.y },
      thickness: 0.75,
      color: NAVY,
    });
    cur.y -= 12;
  };

  const kv = (k: string, v: string) => {
    newPageIfNeeded(14);
    cur.page.drawText(ascii(k), { x: MARGIN, y: cur.y, size: 10, font: bold, color: BLACK });
    cur.page.drawText(ascii(v), { x: MARGIN + 200, y: cur.y, size: 10, font, color: BLACK });
    cur.y -= 15;
  };

  // ── Title ────────────────────────────────────────────────────────────────
  cur.page.drawText('Property Tax Protest Evidence Packet', {
    x: MARGIN,
    y: cur.y,
    size: 18,
    font: bold,
    color: NAVY,
  });
  cur.y -= 22;
  const countyName = subject.county === 'collin' ? 'Collin County (CCAD)' : 'Denton County (DCAD)';
  text(`${countyName}   -   Generated ${new Date().toLocaleDateString('en-US')}`, {
    size: 9,
    color: GRAY,
  });
  cur.y -= 6;

  // ── Subject property ──────────────────────────────────────────────────────
  heading('Subject Property');
  kv('Account / PID', subject.account);
  kv('Address', subject.address);
  kv('Living area (sqft)', fmtNum(subject.livingAreaSqft));
  kv('Year built', subject.yearBuilt ? String(subject.yearBuilt) : 'n/a');
  kv('Neighborhood code', subject.neighborhoodCode || 'n/a');
  kv('Appraised value', fmtUSD(subject.appraisedValue));
  kv('Market value', fmtUSD(subject.marketValue));
  if (capFloor.available && capFloor.netAppraisedValue != null) {
    kv('Net appraised (taxable)', fmtUSD(capFloor.netAppraisedValue));
  }

  // ── Recommendation ────────────────────────────────────────────────────────
  heading('Recommendation');
  text(verdict.headline, { size: 12, font: bold, color: NAVY });
  cur.y -= 2;
  wrap(verdict.summary, text);

  // ── Homestead cap ─────────────────────────────────────────────────────────
  heading('Homestead Cap (10%) Check');
  if (!capFloor.available) {
    wrap(
      'The taxable (net appraised) value is not published for this county dataset, so the ' +
        'homestead-cap floor could not be verified. If you have a homestead exemption, check your ' +
        'appraisal notice: a protest only lowers your bill if your argued value is below the ' +
        'capped TAXABLE value.',
      text
    );
  } else if (capFloor.isCapped) {
    kv('Appraised value', fmtUSD(capFloor.appraisedValue));
    kv('Taxable floor', fmtUSD(capFloor.floor ?? 0));
    wrap(
      'The 10% homestead cap already holds the taxable value below market. A protest helps only if ' +
        'comparable values come in BELOW this taxable floor.',
      text
    );
  } else {
    kv('Taxable floor', fmtUSD(capFloor.floor ?? 0));
    text('Not currently capped - appraised value equals taxable value.');
  }

  // ── Equity / unequal appraisal ────────────────────────────────────────────
  heading('Unequal Appraisal Analysis (Tex. Tax Code 41.43(b)(3))');
  if (!equity) {
    wrap('Not enough comparable properties were found in this neighborhood to run the equity analysis.', text);
  } else {
    kv('Subject $/sqft', fmtPsf(equity.subjectPsf));
    kv('Neighborhood median $/sqft', fmtPsf(equity.neighborhoodMedianPsf));
    kv('Refined comps median $/sqft', fmtPsf(equity.refinedMedianPsf));
    kv('Indicated value (all comps)', fmtUSD(equity.indicatedValueAll));
    kv('Indicated value (refined)', fmtUSD(equity.indicatedValueRefined));
    kv('Subject rank', `#${equity.subjectRankOf} of ${equity.neighborhoodCount} (1 = highest $/sqft)`);
    cur.y -= 4;
    text('Comparable properties (refined set, sorted by $/sqft):', { font: bold });
    compTable(equity.refinedComps.length >= 3 ? equity.refinedComps : equity.comps, cur, bold, font, newPageIfNeeded);
  }

  // ── Market value ──────────────────────────────────────────────────────────
  if (market) {
    heading('Market Value Evidence');
    kv('Source', market.source === 'rentcast' ? 'RentCast AVM' : 'Manually entered sales');
    kv('Estimated market value', fmtUSD(market.estimatedValue));
    if (market.lowRange != null && market.highRange != null) {
      kv('Estimate range', `${fmtUSD(market.lowRange)} - ${fmtUSD(market.highRange)}`);
    }
    if (market.comparables && market.comparables.length > 0) {
      cur.y -= 4;
      text('Comparable sales:', { font: bold });
      marketTable(market.comparables, cur, bold, font, newPageIfNeeded);
    }
  }

  // ── How to file ───────────────────────────────────────────────────────────
  heading('How to File Your Protest');
  const lines = [
    `1. File Comptroller Form ${COMPTROLLER_FORM} (Notice of Protest) with the ${countyName} appraisal district.`,
    `2. Deadline: ${PROTEST_DEADLINE}, or 30 days after your Notice of Appraised Value - whichever is later.`,
    '3. Check both grounds on the form: "Value is over market value" and "Value is unequal compared with other properties."',
    '4. Attach this packet as your evidence.',
    '5. You may settle informally with an appraiser, or present to the Appraisal Review Board (ARB).',
  ];
  for (const l of lines) wrap(l, text);

  if (verdict.targetValue != null) {
    cur.y -= 4;
    text(`Suggested value to request: ${fmtUSD(verdict.targetValue)}`, { font: bold, color: NAVY });
    if (verdict.equityReduction != null) {
      text(
        `Potential reduction ~${fmtUSD(verdict.equityReduction)}  (est. ~${fmtUSD(
          verdict.equityReduction * TAX_RATE
        )}/yr in taxes)`,
        { size: 9, color: GRAY }
      );
    }
  }

  // ── Disclaimer ────────────────────────────────────────────────────────────
  cur.y -= 10;
  wrap(DISCLAIMER, text, { size: 8, color: GRAY });

  return doc.save();
}

// ── helpers ──────────────────────────────────────────────────────────────────

type TextFn = (s: string, opts?: { size?: number; font?: PDFFont; color?: ReturnType<typeof rgb>; indent?: number }) => void;

function wrap(
  s: string,
  text: TextFn,
  opts: { size?: number; color?: ReturnType<typeof rgb> } = {}
) {
  const size = opts.size ?? 10;
  const maxChars = Math.floor((PAGE_W - 2 * MARGIN) / (size * 0.5));
  const words = ascii(s).split(' ');
  let line = '';
  for (const w of words) {
    if ((line + ' ' + w).trim().length > maxChars) {
      text(line, { size, color: opts.color });
      line = w;
    } else {
      line = (line + ' ' + w).trim();
    }
  }
  if (line) text(line, { size, color: opts.color });
}

function row(page: PDFPage, y: number, cols: string[], xs: number[], f: PDFFont, size: number) {
  cols.forEach((c, i) => {
    page.drawText(ascii(c), { x: xs[i], y, size, font: f, color: BLACK });
  });
}

function compTable(
  comps: import('../types').Comp[],
  cur: Cursor,
  bold: PDFFont,
  font: PDFFont,
  ensure: (n: number) => void
) {
  const xs = [MARGIN, MARGIN + 230, MARGIN + 300, MARGIN + 360, MARGIN + 430];
  ensure(16);
  row(cur.page, cur.y, ['Address', 'SqFt', 'Year', 'Apprsd', '$/sqft'], xs, bold, 8);
  cur.y -= 12;
  for (const c of comps.slice(0, 25)) {
    ensure(11);
    row(
      cur.page,
      cur.y,
      [
        c.address.slice(0, 40),
        fmtNum(c.livingAreaSqft),
        c.yearBuilt ? String(c.yearBuilt) : '-',
        fmtUSD(c.appraisedValue),
        fmtPsf(c.pricePerSqft),
      ],
      xs,
      font,
      8
    );
    cur.y -= 11;
  }
}

function marketTable(
  comps: import('../types').MarketComp[],
  cur: Cursor,
  bold: PDFFont,
  font: PDFFont,
  ensure: (n: number) => void
) {
  const xs = [MARGIN, MARGIN + 230, MARGIN + 310, MARGIN + 390, MARGIN + 460];
  ensure(16);
  row(cur.page, cur.y, ['Address', 'Sale', 'Date', 'SqFt', '$/sqft'], xs, bold, 8);
  cur.y -= 12;
  for (const c of comps.slice(0, 25)) {
    ensure(11);
    row(
      cur.page,
      cur.y,
      [
        c.address.slice(0, 40),
        fmtUSD(c.salePrice),
        c.saleDate ? c.saleDate.slice(0, 10) : '-',
        fmtNum(c.livingAreaSqft),
        fmtPsf(c.pricePerSqft),
      ],
      xs,
      font,
      8
    );
    cur.y -= 11;
  }
}

/** Trigger a browser download of the generated packet. */
export function downloadPacket(bytes: Uint8Array, filename: string) {
  const ab = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(ab).set(bytes);
  const blob = new Blob([ab], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
