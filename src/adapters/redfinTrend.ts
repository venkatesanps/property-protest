import { REDFIN_ZIPS, type RedfinZipEntry } from './redfin-zips';

export type { RedfinZipEntry };

export function getZipTrend(zip: string | null | undefined): RedfinZipEntry | null {
  if (!zip) return null;
  return REDFIN_ZIPS[zip] ?? null;
}
