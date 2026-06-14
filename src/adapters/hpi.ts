/**
 * FHFA House Price Index — purchase-price "what you paid -> today" adjuster.
 *
 * Texas is a sale-price non-disclosure state, so there is no free firehose of
 * individual sale prices. What IS free and public is the FHFA House Price Index:
 * a quarterly index of how home values have moved for a whole metro area. It
 * can't price a single house, but it can age a KNOWN number (your purchase
 * price) forward to today's market.
 *
 * Two FHFA all-transactions metro-division series are bundled, one per metro
 * that our counties fall in:
 *   • Dallas-Plano-Irving, TX (CBSA 19124) — Collin and Denton counties.
 *   • Fort Worth-Arlington-Grapevine, TX (CBSA 23104) — Tarrant county.
 * Aging a Tarrant purchase against the Dallas series (or vice-versa) overstates
 * or understates the move, so the right metro is selected by county.
 *
 * Source (public domain): FHFA HPI quarterly dataset,
 * https://www.fhfa.gov/data/hpi/datasets (file: hpi_at_metro.csv).
 *
 * Kept up to date automatically by scripts/refresh-hpi.mjs, run monthly via
 * .github/workflows/refresh-hpi.yml. The index is unitless; only the RATIO
 * between two quarters matters.
 */

import type { HpiAdjustment } from '../types';

interface Metro {
  /** Human label, e.g. "Dallas-Plano-Irving, TX". */
  area: string;
  /** Source label with the CBSA code. */
  source: string;
  /** Quarterly index keyed "YYYYQn", all transactions. */
  data: Record<string, number>;
}

// ── Dallas-Plano-Irving, TX Metropolitan Division (CBSA 19124) ──
const DALLAS_HPI: Record<string, number> = {
  '1975Q4': 40.88, '1976Q1': 39.81, '1976Q2': 45.45, '1976Q3': 42.32,
  '1976Q4': 42.27, '1977Q1': 44.74, '1977Q2': 51.57, '1977Q3': 47.15,
  '1977Q4': 49.31, '1978Q1': 51.73, '1978Q2': 56.89, '1978Q3': 57.94,
  '1978Q4': 59.88, '1979Q1': 62.23, '1979Q2': 67.78, '1979Q3': 69.15,
  '1979Q4': 71.83, '1980Q1': 74.69, '1980Q2': 75.93, '1980Q3': 78.02,
  '1980Q4': 79.77, '1981Q1': 81.92, '1981Q2': 83.63, '1981Q3': 84.82,
  '1981Q4': 77.56, '1982Q1': 87.63, '1982Q2': 81.86, '1982Q3': 85.03,
  '1982Q4': 87.35, '1983Q1': 91.16, '1983Q2': 93.11, '1983Q3': 94.61,
  '1983Q4': 96.93, '1984Q1': 97.34, '1984Q2': 99.40, '1984Q3': 101.82,
  '1984Q4': 101.90, '1985Q1': 102.46, '1985Q2': 104.83, '1985Q3': 105.77,
  '1985Q4': 106.19, '1986Q1': 106.63, '1986Q2': 109.16, '1986Q3': 107.97,
  '1986Q4': 107.41, '1987Q1': 107.04, '1987Q2': 102.47, '1987Q3': 102.07,
  '1987Q4': 99.10, '1988Q1': 98.67, '1988Q2': 98.36, '1988Q3': 95.82,
  '1988Q4': 94.26, '1989Q1': 93.61, '1989Q2': 93.87, '1989Q3': 95.49,
  '1989Q4': 95.02, '1990Q1': 94.50, '1990Q2': 94.95, '1990Q3': 95.13,
  '1990Q4': 94.40, '1991Q1': 95.58, '1991Q2': 96.21, '1991Q3': 95.60,
  '1991Q4': 97.23, '1992Q1': 98.44, '1992Q2': 97.56, '1992Q3': 99.16,
  '1992Q4': 99.25, '1993Q1': 99.09, '1993Q2': 99.95, '1993Q3': 100.51,
  '1993Q4': 101.20, '1994Q1': 101.40, '1994Q2': 100.81, '1994Q3': 100.51,
  '1994Q4': 100.11, '1995Q1': 100.00, '1995Q2': 101.50, '1995Q3': 103.19,
  '1995Q4': 104.03, '1996Q1': 105.02, '1996Q2': 104.87, '1996Q3': 105.73,
  '1996Q4': 106.14, '1997Q1': 106.95, '1997Q2': 107.75, '1997Q3': 108.87,
  '1997Q4': 110.41, '1998Q1': 112.18, '1998Q2': 112.95, '1998Q3': 115.31,
  '1998Q4': 116.74, '1999Q1': 117.75, '1999Q2': 120.26, '1999Q3': 121.93,
  '1999Q4': 123.51, '2000Q1': 125.80, '2000Q2': 127.70, '2000Q3': 129.41,
  '2000Q4': 131.06, '2001Q1': 134.55, '2001Q2': 136.61, '2001Q3': 137.81,
  '2001Q4': 139.57, '2002Q1': 140.18, '2002Q2': 141.32, '2002Q3': 143.46,
  '2002Q4': 144.52, '2003Q1': 145.14, '2003Q2': 145.92, '2003Q3': 146.52,
  '2003Q4': 147.09, '2004Q1': 147.95, '2004Q2': 148.93, '2004Q3': 149.53,
  '2004Q4': 151.04, '2005Q1': 151.71, '2005Q2': 153.28, '2005Q3': 154.96,
  '2005Q4': 155.82, '2006Q1': 156.94, '2006Q2': 158.01, '2006Q3': 159.14,
  '2006Q4': 160.22, '2007Q1': 161.49, '2007Q2': 164.26, '2007Q3': 163.02,
  '2007Q4': 163.95, '2008Q1': 165.23, '2008Q2': 164.97, '2008Q3': 164.25,
  '2008Q4': 164.92, '2009Q1': 167.33, '2009Q2': 165.50, '2009Q3': 162.59,
  '2009Q4': 162.82, '2010Q1': 162.28, '2010Q2': 162.31, '2010Q3': 163.40,
  '2010Q4': 162.28, '2011Q1': 159.37, '2011Q2': 157.87, '2011Q3': 160.19,
  '2011Q4': 159.70, '2012Q1': 159.38, '2012Q2': 160.06, '2012Q3': 161.64,
  '2012Q4': 163.27, '2013Q1': 164.44, '2013Q2': 168.47, '2013Q3': 171.92,
  '2013Q4': 174.12, '2014Q1': 177.88, '2014Q2': 183.54, '2014Q3': 187.30,
  '2014Q4': 189.45, '2015Q1': 194.09, '2015Q2': 200.78, '2015Q3': 206.35,
  '2015Q4': 209.17, '2016Q1': 213.57, '2016Q2': 221.57, '2016Q3': 226.36,
  '2016Q4': 230.32, '2017Q1': 235.31, '2017Q2': 244.52, '2017Q3': 248.89,
  '2017Q4': 251.40, '2018Q1': 255.47, '2018Q2': 260.53, '2018Q3': 263.67,
  '2018Q4': 264.06, '2019Q1': 266.44, '2019Q2': 271.04, '2019Q3': 273.72,
  '2019Q4': 275.32, '2020Q1': 277.27, '2020Q2': 278.58, '2020Q3': 283.10,
  '2020Q4': 288.93, '2021Q1': 295.77, '2021Q2': 314.87, '2021Q3': 336.10,
  '2021Q4': 350.76, '2022Q1': 370.66, '2022Q2': 402.15, '2022Q3': 411.57,
  '2022Q4': 402.35, '2023Q1': 403.73, '2023Q2': 410.16, '2023Q3': 414.18,
  '2023Q4': 410.52, '2024Q1': 416.33, '2024Q2': 422.03, '2024Q3': 423.46,
  '2024Q4': 426.56, '2025Q1': 423.54, '2025Q2': 424.89, '2025Q3': 425.76,
  '2025Q4': 425.89, '2026Q1': 428.29,
};

// ── Fort Worth-Arlington-Grapevine, TX Metropolitan Division (CBSA 23104) ──
const FORT_WORTH_HPI: Record<string, number> = {
  '1977Q2': 50.05, '1977Q3': 49.43, '1977Q4': 53.26, '1978Q1': 56.09,
  '1978Q2': 56.63, '1978Q3': 60.45, '1978Q4': 61.57, '1979Q1': 64.95,
  '1979Q2': 68.74, '1979Q3': 71.35, '1979Q4': 73.22, '1980Q1': 74.79,
  '1980Q2': 79.03, '1980Q3': 81.33, '1980Q4': 80.71, '1981Q1': 81.22,
  '1981Q2': 85.21, '1981Q3': 83.85, '1981Q4': 76.51, '1982Q1': 84.73,
  '1982Q2': 79.05, '1982Q3': 82.86, '1982Q4': 76.40, '1983Q1': 89.06,
  '1983Q2': 91.67, '1983Q3': 92.15, '1983Q4': 93.52, '1984Q1': 95.75,
  '1984Q2': 96.33, '1984Q3': 98.50, '1984Q4': 99.08, '1985Q1': 98.75,
  '1985Q2': 99.83, '1985Q3': 101.66, '1985Q4': 100.69, '1986Q1': 103.27,
  '1986Q2': 104.63, '1986Q3': 102.94, '1986Q4': 102.70, '1987Q1': 104.27,
  '1987Q2': 102.60, '1987Q3': 99.76, '1987Q4': 96.96, '1988Q1': 97.76,
  '1988Q2': 96.64, '1988Q3': 93.76, '1988Q4': 92.62, '1989Q1': 93.20,
  '1989Q2': 93.42, '1989Q3': 93.83, '1989Q4': 93.43, '1990Q1': 93.67,
  '1990Q2': 94.15, '1990Q3': 94.20, '1990Q4': 93.55, '1991Q1': 94.24,
  '1991Q2': 94.78, '1991Q3': 94.24, '1991Q4': 95.40, '1992Q1': 95.72,
  '1992Q2': 95.35, '1992Q3': 96.46, '1992Q4': 97.38, '1993Q1': 97.11,
  '1993Q2': 97.77, '1993Q3': 98.98, '1993Q4': 99.56, '1994Q1': 100.42,
  '1994Q2': 99.73, '1994Q3': 99.55, '1994Q4': 99.79, '1995Q1': 100.00,
  '1995Q2': 101.54, '1995Q3': 102.94, '1995Q4': 103.11, '1996Q1': 104.73,
  '1996Q2': 104.49, '1996Q3': 105.28, '1996Q4': 104.99, '1997Q1': 106.20,
  '1997Q2': 106.80, '1997Q3': 107.95, '1997Q4': 109.36, '1998Q1': 110.48,
  '1998Q2': 111.61, '1998Q3': 113.06, '1998Q4': 113.95, '1999Q1': 114.62,
  '1999Q2': 116.70, '1999Q3': 118.62, '1999Q4': 119.43, '2000Q1': 121.31,
  '2000Q2': 122.79, '2000Q3': 124.41, '2000Q4': 126.20, '2001Q1': 128.76,
  '2001Q2': 130.58, '2001Q3': 131.87, '2001Q4': 133.47, '2002Q1': 133.71,
  '2002Q2': 135.28, '2002Q3': 137.17, '2002Q4': 138.30, '2003Q1': 139.16,
  '2003Q2': 140.39, '2003Q3': 141.30, '2003Q4': 141.70, '2004Q1': 141.56,
  '2004Q2': 143.38, '2004Q3': 143.94, '2004Q4': 145.35, '2005Q1': 146.06,
  '2005Q2': 147.37, '2005Q3': 149.53, '2005Q4': 149.76, '2006Q1': 151.17,
  '2006Q2': 152.06, '2006Q3': 153.82, '2006Q4': 155.70, '2007Q1': 156.37,
  '2007Q2': 157.25, '2007Q3': 157.85, '2007Q4': 158.81, '2008Q1': 158.36,
  '2008Q2': 159.08, '2008Q3': 158.38, '2008Q4': 158.97, '2009Q1': 162.03,
  '2009Q2': 160.83, '2009Q3': 158.19, '2009Q4': 158.38, '2010Q1': 157.24,
  '2010Q2': 157.49, '2010Q3': 158.09, '2010Q4': 157.36, '2011Q1': 155.48,
  '2011Q2': 153.42, '2011Q3': 154.49, '2011Q4': 154.57, '2012Q1': 154.33,
  '2012Q2': 155.35, '2012Q3': 156.33, '2012Q4': 157.46, '2013Q1': 157.87,
  '2013Q2': 160.59, '2013Q3': 163.66, '2013Q4': 165.30, '2014Q1': 167.99,
  '2014Q2': 172.04, '2014Q3': 174.87, '2014Q4': 176.48, '2015Q1': 178.87,
  '2015Q2': 184.15, '2015Q3': 190.48, '2015Q4': 192.86, '2016Q1': 195.88,
  '2016Q2': 201.30, '2016Q3': 207.04, '2016Q4': 209.92, '2017Q1': 215.20,
  '2017Q2': 222.82, '2017Q3': 227.69, '2017Q4': 230.98, '2018Q1': 235.85,
  '2018Q2': 241.86, '2018Q3': 245.96, '2018Q4': 246.79, '2019Q1': 249.17,
  '2019Q2': 254.53, '2019Q3': 257.00, '2019Q4': 260.08, '2020Q1': 262.03,
  '2020Q2': 263.64, '2020Q3': 267.31, '2020Q4': 274.10, '2021Q1': 281.55,
  '2021Q2': 297.74, '2021Q3': 319.44, '2021Q4': 332.84, '2022Q1': 350.68,
  '2022Q2': 379.45, '2022Q3': 388.21, '2022Q4': 379.30, '2023Q1': 381.56,
  '2023Q2': 384.40, '2023Q3': 388.06, '2023Q4': 382.17, '2024Q1': 390.26,
  '2024Q2': 392.83, '2024Q3': 393.57, '2024Q4': 397.82, '2025Q1': 396.88,
  '2025Q2': 399.12, '2025Q3': 397.98, '2025Q4': 398.15, '2026Q1': 400.36,
};

const DALLAS: Metro = {
  area: 'Dallas-Plano-Irving, TX',
  source: 'FHFA House Price Index (CBSA 19124)',
  data: DALLAS_HPI,
};

const FORT_WORTH: Metro = {
  area: 'Fort Worth-Arlington-Grapevine, TX',
  source: 'FHFA House Price Index (CBSA 23104)',
  data: FORT_WORTH_HPI,
};

/** Which metro division each county sits in. */
const METRO_BY_COUNTY: Record<string, Metro> = {
  collin: DALLAS,
  denton: DALLAS,
  tarrant: FORT_WORTH,
};

/** Resolve the metro series for a county; defaults to Dallas when unknown. */
function metroFor(county?: string | null): Metro {
  return (county && METRO_BY_COUNTY[county]) || DALLAS;
}

/** Default-metro labels kept for backward compatibility. */
export const HPI_AREA = DALLAS.area;
export const HPI_SOURCE = DALLAS.source;

/** "2021Q2" -> "2021 Q2" for display. */
function pretty(key: string): string {
  return key.replace('Q', ' Q');
}

/** Map a calendar date to its FHFA quarter key, clamped to the metro's range. */
function keyForDate(dateStr: string, metro: Metro): string {
  const keys = Object.keys(metro.data).sort();
  const firstKey = keys[0];
  const latestKey = keys[keys.length - 1];
  const m = /^(\d{4})-(\d{2})/.exec(dateStr.trim());
  if (!m) return latestKey;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const q = Math.min(4, Math.max(1, Math.floor((month - 1) / 3) + 1));
  const key = `${year}Q${q}`;
  if (key < firstKey) return firstKey;
  if (key > latestKey) return latestKey;
  // Exact quarter may be missing — fall back to the nearest key at or before it.
  if (metro.data[key] != null) return key;
  let best = firstKey;
  for (const k of keys) {
    if (k <= key) best = k;
    else break;
  }
  return best;
}

/**
 * Age a known purchase price forward to the latest available quarter using the
 * House Price Index for the county's metro division. `county` selects the
 * Dallas (Collin/Denton) or Fort Worth (Tarrant) series; omit it (e.g. live
 * input preview before a property is loaded) to use Dallas. Returns null only
 * if the price is non-positive or no date is given.
 */
export function adjustToToday(
  price: number,
  dateStr: string | undefined | null,
  county?: string | null
): HpiAdjustment | null {
  if (!price || price <= 0 || !dateStr) return null;
  const metro = metroFor(county);
  const keys = Object.keys(metro.data).sort();
  const latestKey = keys[keys.length - 1];
  const fromKey = keyForDate(dateStr, metro);
  const fromIndex = metro.data[fromKey];
  const toIndex = metro.data[latestKey];
  const adjustedValue = Math.round((price * toIndex) / fromIndex);
  return {
    rawValue: Math.round(price),
    adjustedValue,
    fromLabel: pretty(fromKey),
    toLabel: pretty(latestKey),
    fromIndex,
    toIndex,
    pctChange: (toIndex / fromIndex - 1) * 100,
    area: metro.area,
  };
}
