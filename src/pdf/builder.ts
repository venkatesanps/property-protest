/**
 * Tiny PDF layout helper shared by the board + personal packets.
 *
 * pdf-lib's StandardFonts can only render WinAnsi/ASCII, so every string is
 * sanitized (em-dashes -> '-', other non-ASCII -> space) before drawing.
 */

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { PDFFont, PDFPage } from 'pdf-lib';

export const MARGIN = 50;
export const PAGE_W = 612; // US Letter
export const PAGE_H = 792;
export const CONTENT_W = PAGE_W - 2 * MARGIN;

export const NAVY = rgb(0.09, 0.16, 0.31);
export const SLATE = rgb(0.2, 0.25, 0.33);
export const GRAY = rgb(0.4, 0.42, 0.46);
export const EMERALD = rgb(0.02, 0.47, 0.34);
export const BLACK = rgb(0, 0, 0);
export const WHITE = rgb(1, 1, 1);
export const LIGHT = rgb(0.93, 0.95, 0.97);

type Color = ReturnType<typeof rgb>;

const ascii = (s: string): string =>
  (s ?? '').replace(/[^\x20-\x7E]/g, (c) => (c === '–' || c === '—' ? '-' : ' '));

export interface TextOpts {
  size?: number;
  font?: PDFFont;
  color?: Color;
  indent?: number;
}

export interface DocBuilder {
  readonly doc: PDFDocument;
  readonly font: PDFFont;
  readonly bold: PDFFont;
  /** Draw one line of text and advance the cursor. */
  text(s: string, opts?: TextOpts): void;
  /** Word-wrap a paragraph to the content width. */
  wrap(s: string, opts?: TextOpts): void;
  /** Section heading with an underline rule. */
  heading(s: string): void;
  /** Bold key + value on one row. */
  kv(k: string, v: string, valColor?: Color): void;
  /** A filled callout box containing the supplied lines. */
  callout(lines: { text: string; size?: number; bold?: boolean; color?: Color }[], bg?: Color, accent?: Color): void;
  /** Add vertical space. */
  gap(n: number): void;
  /** Force a new page if fewer than `need` points remain. */
  ensure(need: number): void;
  /** Current cursor y. */
  y(): number;
  page(): PDFPage;
  bytes(): Promise<Uint8Array>;
}

export async function createDoc(): Promise<DocBuilder> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  let page = doc.addPage([PAGE_W, PAGE_H]);
  let cy = PAGE_H - MARGIN;

  const ensure = (need: number) => {
    if (cy - need < MARGIN) {
      page = doc.addPage([PAGE_W, PAGE_H]);
      cy = PAGE_H - MARGIN;
    }
  };

  const text = (s: string, opts: TextOpts = {}) => {
    const size = opts.size ?? 10;
    ensure(size + 4);
    page.drawText(ascii(s), {
      x: MARGIN + (opts.indent ?? 0),
      y: cy,
      size,
      font: opts.font ?? font,
      color: opts.color ?? BLACK,
    });
    cy -= size + 5;
  };

  const wrap = (s: string, opts: TextOpts = {}) => {
    const size = opts.size ?? 10;
    const f = opts.font ?? font;
    const maxW = CONTENT_W - (opts.indent ?? 0);
    const words = ascii(s).split(' ');
    let line = '';
    for (const w of words) {
      const next = line ? line + ' ' + w : w;
      if (f.widthOfTextAtSize(next, size) > maxW && line) {
        text(line, opts);
        line = w;
      } else {
        line = next;
      }
    }
    if (line) text(line, opts);
  };

  const heading = (s: string) => {
    cy -= 10;
    ensure(22);
    page.drawText(ascii(s), { x: MARGIN, y: cy, size: 13, font: bold, color: NAVY });
    cy -= 6;
    page.drawLine({
      start: { x: MARGIN, y: cy },
      end: { x: PAGE_W - MARGIN, y: cy },
      thickness: 1,
      color: EMERALD,
    });
    cy -= 13;
  };

  const kv = (k: string, v: string, valColor: Color = BLACK) => {
    ensure(15);
    page.drawText(ascii(k), { x: MARGIN, y: cy, size: 10, font: bold, color: SLATE });
    page.drawText(ascii(v), { x: MARGIN + 210, y: cy, size: 10, font, color: valColor });
    cy -= 15;
  };

  const callout = (
    lines: { text: string; size?: number; bold?: boolean; color?: Color }[],
    bg: Color = LIGHT,
    accent: Color = EMERALD
  ) => {
    const pad = 10;
    const lineH = (l: { size?: number }) => (l.size ?? 11) + 6;
    const boxH = pad * 2 + lines.reduce((a, l) => a + lineH(l), 0);
    ensure(boxH + 6);
    const top = cy;
    page.drawRectangle({
      x: MARGIN,
      y: top - boxH,
      width: CONTENT_W,
      height: boxH,
      color: bg,
    });
    page.drawRectangle({ x: MARGIN, y: top - boxH, width: 4, height: boxH, color: accent });
    let ty = top - pad - 11;
    for (const l of lines) {
      page.drawText(ascii(l.text), {
        x: MARGIN + pad + 6,
        y: ty,
        size: l.size ?? 11,
        font: l.bold ? bold : font,
        color: l.color ?? SLATE,
      });
      ty -= lineH(l);
    }
    cy = top - boxH - 12;
  };

  return {
    doc,
    font,
    bold,
    text,
    wrap,
    heading,
    kv,
    callout,
    gap: (n: number) => {
      cy -= n;
    },
    ensure,
    y: () => cy,
    page: () => page,
    bytes: () => doc.save(),
  };
}

/** Draw a simple text table given column x-offsets. Returns nothing; advances cursor. */
export function drawTable(
  b: DocBuilder,
  headers: string[],
  rows: string[][],
  xs: number[],
  maxRows = 25
) {
  b.ensure(18);
  const headerY = b.y();
  const pg = b.page();
  headers.forEach((h, i) => {
    pg.drawText(ascii(h), { x: xs[i], y: headerY, size: 8, font: b.bold, color: SLATE });
  });
  b.gap(13);
  for (const r of rows.slice(0, maxRows)) {
    b.ensure(11);
    const ry = b.y();
    const p = b.page();
    r.forEach((cell, i) => {
      p.drawText(ascii(cell), { x: xs[i], y: ry, size: 8, font: b.font, color: BLACK });
    });
    b.gap(11);
  }
}
