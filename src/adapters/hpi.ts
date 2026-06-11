/**
 * FHFA House Price Index — purchase-price "what you paid -> today" adjuster.
 *
 * Texas is a sale-price non-disclosure state, so there is no free firehose of
 * individual sale prices. What IS free and public is the FHFA House Price Index:
 * a quarterly index of how home values have moved for a whole metro area. It
 * can't price a single house, but it can age a KNOWN number (your purchase
 * price) forward to today's market.
 *
 * Data below is the FHFA all-transactions index for the Dallas-Plano-Irving, TX
 * Metropolitan Division (CBSA 19124) — the division that contains Collin and
 * Denton counties. Source (public domain): FHFA HPI quarterly dataset,
 * https://www.fhfa.gov/data/hpi/datasets (file: hpi_at_metro.csv).
 *
 * To refresh: re-download the CSV, grep CBSA 19124, and paste the new quarters
 * below. The index is unitless; only the RATIO between two quarters matters.
 */

import type { HpiAdjustment } from '../types';

export const HPI_AREA = 'Dallas-Plano-Irving, TX';
export const HPI_SOURCE = 'FHFA House Price Index (CBSA 19124)';

/** Quarterly index keyed "YYYYQn". Dallas-Plano-Irving MSAD, all transactions. */
const HPI: Record<string, number> = {
  '2005Q1': 151.71, '2005Q2': 153.28, '2005Q3': 154.96, '2005Q4': 155.82,
  '2006Q1': 156.94, '2006Q2': 158.01, '2006Q3': 159.14, '2006Q4': 160.22,
  '2007Q1': 161.49, '2007Q2': 164.26, '2007Q3': 163.02, '2007Q4': 163.95,
  '2008Q1': 165.23, '2008Q2': 164.97, '2008Q3': 164.25, '2008Q4': 164.92,
  '2009Q1': 167.33, '2009Q2': 165.50, '2009Q3': 162.59, '2009Q4': 162.82,
  '2010Q1': 162.28, '2010Q2': 162.31, '2010Q3': 163.40, '2010Q4': 162.28,
  '2011Q1': 159.37, '2011Q2': 157.87, '2011Q3': 160.19, '2011Q4': 159.70,
  '2012Q1': 159.38, '2012Q2': 160.06, '2012Q3': 161.64, '2012Q4': 163.27,
  '2013Q1': 164.44, '2013Q2': 168.47, '2013Q3': 171.92, '2013Q4': 174.12,
  '2014Q1': 177.88, '2014Q2': 183.54, '2014Q3': 187.30, '2014Q4': 189.45,
  '2015Q1': 194.09, '2015Q2': 200.78, '2015Q3': 206.35, '2015Q4': 209.17,
  '2016Q1': 213.57, '2016Q2': 221.57, '2016Q3': 226.36, '2016Q4': 230.32,
  '2017Q1': 235.31, '2017Q2': 244.52, '2017Q3': 248.89, '2017Q4': 251.40,
  '2018Q1': 255.47, '2018Q2': 260.53, '2018Q3': 263.67, '2018Q4': 264.06,
  '2019Q1': 266.44, '2019Q2': 271.04, '2019Q3': 273.72, '2019Q4': 275.32,
  '2020Q1': 277.27, '2020Q2': 278.58, '2020Q3': 283.10, '2020Q4': 288.93,
  '2021Q1': 295.77, '2021Q2': 314.87, '2021Q3': 336.10, '2021Q4': 350.76,
  '2022Q1': 370.66, '2022Q2': 402.15, '2022Q3': 411.57, '2022Q4': 402.35,
  '2023Q1': 403.73, '2023Q2': 410.16, '2023Q3': 414.18, '2023Q4': 410.52,
  '2024Q1': 416.33, '2024Q2': 422.03, '2024Q3': 423.46, '2024Q4': 426.56,
  '2025Q1': 423.54, '2025Q2': 424.89, '2025Q3': 425.76, '2025Q4': 425.89,
  '2026Q1': 428.29,
};

const KEYS = Object.keys(HPI).sort();
const FIRST_KEY = KEYS[0];
export const HPI_LATEST_KEY = KEYS[KEYS.length - 1];
export const HPI_LATEST_INDEX = HPI[HPI_LATEST_KEY];

/** "2021Q2" -> "2021 Q2" for display. */
function pretty(key: string): string {
  return key.replace('Q', ' Q');
}

/** Map a calendar date to its FHFA quarter key, clamped to the data range. */
function keyForDate(dateStr: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(dateStr.trim());
  if (!m) return HPI_LATEST_KEY;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const q = Math.min(4, Math.max(1, Math.floor((month - 1) / 3) + 1));
  const key = `${year}Q${q}`;
  if (key < FIRST_KEY) return FIRST_KEY;
  if (key > HPI_LATEST_KEY) return HPI_LATEST_KEY;
  // Exact quarter may be missing (e.g. clamped year present but gap) — fall back
  // to the nearest available key at or before it.
  if (HPI[key] != null) return key;
  let best = FIRST_KEY;
  for (const k of KEYS) {
    if (k <= key) best = k;
    else break;
  }
  return best;
}

/**
 * Age a known purchase price forward to the latest available quarter using the
 * area House Price Index. Returns null only if the price is non-positive.
 */
export function adjustToToday(price: number, dateStr: string | undefined | null): HpiAdjustment | null {
  if (!price || price <= 0 || !dateStr) return null;
  const fromKey = keyForDate(dateStr);
  const fromIndex = HPI[fromKey];
  const toIndex = HPI_LATEST_INDEX;
  const adjustedValue = Math.round((price * toIndex) / fromIndex);
  return {
    rawValue: Math.round(price),
    adjustedValue,
    fromLabel: pretty(fromKey),
    toLabel: pretty(HPI_LATEST_KEY),
    fromIndex,
    toIndex,
    pctChange: (toIndex / fromIndex - 1) * 100,
    area: HPI_AREA,
  };
}
