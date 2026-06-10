// ─── Display formatting helpers ───────────────────────────────────────────────

export const fmtUSD = (n: number): string => '$' + Math.round(n).toLocaleString('en-US');

export const fmtNum = (n: number): string => Math.round(n).toLocaleString('en-US');

export const fmtPsf = (n: number): string => '$' + n.toFixed(2);
