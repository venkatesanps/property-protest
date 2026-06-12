# Agent Instructions for ProtestIQ (tx-protest-helper)

## Project summary

Client-side React 19 + TypeScript + Vite app. Builds a static site for Texas property
tax protest analysis in Collin and Denton counties (Frisco area). No backend, no
database, no paid services required. Deploys to GitHub Pages via GitHub Actions.

## Local commands

```bash
npm install
npm run dev        # Vite dev server at http://localhost:5173
npm run build      # production build into dist/
npm run lint       # ESLint over src/
npx tsx scripts/gen-sample.ts  # regenerate sample PDFs from live Collin data
```

## Architecture

The app is a **county router + per-county adapters** pattern:

```text
Address input → Census geocoder (county detection, often CORS-fails)
    → County adapter (Collin: Socrata; Denton: ArcGIS)
        → fetchSubject()  →  SubjectProperty
        → fetchComps()    →  Comp[]  (all residential homes in appraisal neighborhood)
    → computeCapFloor()   src/engine/cap.ts
    → computeEquity()     src/engine/equity.ts  (§41.43(b)(3) median $/sqft)
    → market evidence     src/adapters/market.ts + hpi.ts  (optional)
    → computeVerdict()    src/engine/verdict.ts
    → generateBoardPacket() / generatePersonalPacket()  src/pdf/packet.ts
```

## Key source files

| File | Responsibility |
| ---- | -------------- |
| `src/types.ts` | All domain interfaces: `SubjectProperty`, `Comp`, `EquityResult`, `CapFloorResult`, `MarketValueResult`, `Verdict`, `ManualComp`, `HpiAdjustment`, `PurchaseEvidence` |
| `src/engine/cap.ts` | Homestead 10% cap floor: compares netAppraisedValue vs appraisedValue |
| `src/engine/equity.ts` | Unequal-appraisal engine: filters comps (±40% sqft, same class), computes median $/sqft, indicated values (refined / class-matched / size-adjusted / land+building split). Exports `median()` helper. |
| `src/engine/verdict.ts` | Ranks all indicated values + market + purchase evidence; picks the best argument that beats the cap floor; generates talking points |
| `src/engine/run.ts` | Orchestrator: ties geocode → fetch → cap → equity → market → purchase → verdict into `runAnalysis()`. Returns `AnalysisResult`. |
| `src/adapters/collin.ts` | Collin CAD via data.texas.gov Socrata API (`vffy-snc6`). Fields: `currvalland`, `currvalimprv`, `imprvmainarea`, `nbhdcode`. CORS-enabled. |
| `src/adapters/denton.ts` | Denton CAD via ArcGIS REST (`Parcels_FC/MapServer/0`). Fields: `improvementValue`, `landHSValue`, `landNHSValue`, `ownerNetAppraisedValue`. CORS-enabled. Paginates at 500 records. |
| `src/adapters/hpi.ts` | Embedded FHFA Dallas-Plano-Irving HPI (CBSA 19124), 2005 Q1–2026 Q1. `adjustToToday(price, dateStr)` ages a purchase price to today. Update `HPI` map and `HPI_LATEST_KEY` / `HPI_LATEST_INDEX` each quarter. |
| `src/adapters/market.ts` | `fetchRentcastMarket()` (user-supplied key, CORS may fail), `buildManualMarket()` (user-entered comps). Never route requests through a public CORS proxy — that would leak the user's API key. |
| `src/adapters/suggest.ts` | Address autocomplete: queries both Collin and Denton APIs in parallel for typeahead. |
| `src/adapters/census.ts` | US Census geocoder for county detection. CORS-blocked in most browsers; app falls back to manual selection. |
| `src/adapters/address.ts` | Address parsing and `sqlEscape()` used by adapters. |
| `src/pdf/builder.ts` | Low-level pdf-lib helpers (page layout, text blocks, tables, KV rows). pdf-lib supports ASCII/WinAnsi only — no Unicode. |
| `src/pdf/packet.ts` | `generateBoardPacket()` and `generatePersonalPacket()`. Both consume `AnalysisResult`. Purchase evidence and RentCast error are handled here. |
| `src/App.tsx` | Main UI: address input, advanced panel (manual comps, purchase price, RentCast key), results dashboard, `HowItWorks` + `RealExamples` landing sections. |
| `src/constants.ts` | `PROTEST_DEADLINE`, `COMPTROLLER_FORM`, `DISCLAIMER`. Update deadline each year. |
| `src/format.ts` | `fmtUSD`, `fmtPsf`, `fmtNum`. |

## Data sources

- **Collin CAD** — data.texas.gov Socrata SODA. The adapter probes `COLLIN_SOURCES`
  (newest-first: `nne4-8riu` "Preliminary", then `vffy-snc6` "2025 certified") at runtime
  and uses the first resource that answers its full subject field set; the resolved
  vintage is exposed as `SubjectProperty.rollYear` / `rollLabel` and shown in UI + PDFs.
  - Does **not** publish the homestead-capped value. Cap check infers from prior-year value + 10%.
  - When a new certified roll is published, add its resource ID to the top of `COLLIN_SOURCES`.
- **Denton CAD** — `https://gis.dentoncounty.gov/arcgis/rest/services/Parcels_FC/MapServer/0/query`
  - Publishes `ownerNetAppraisedValue` (homestead-capped value). Updates in place (no ID change).
  - Max 500 records per page; adapter paginates automatically.
- **FHFA HPI** — embedded in `src/adapters/hpi.ts`. Source CSV: `https://www.fhfa.gov/hpi/download/quarterly_datasets/hpi_at_metro.csv`. CBSA 19124 (Dallas-Plano-Irving MSAD). Refreshed by `.github/workflows/refresh-hpi.yml` (monthly cron + manual dispatch).
- **Redfin ZIP median sale price** — embedded in `src/adapters/redfin-zips.ts` (auto-generated, ships empty). Source: `https://redfin-public-data.s3.us-west-2.amazonaws.com/redfin_market_tracker/zip_code_market_tracker.tsv000.gz`. Filtered to TX + supported ZIPs + single-family. Refreshed by `.github/workflows/refresh-redfin.yml` (monthly cron + manual dispatch). **To add ZIPs for a new county:** add to `ALLOWED_ZIPS` in `scripts/refresh-redfin.mjs` AND to `countyFromZip()` in `src/adapters/census.ts`.
- **RentCast AVM + listings** — `https://api.rentcast.io/v1/avm/value` and `/v1/listings/sale`. User-supplied key, browser fetch. May be CORS-blocked (explicit error surfaced; falls back to manual comps). Never proxy through a public CORS relay.

## Conventions

- **Browser-only static app.** Do not add a server or backend unless the repo is explicitly extended for that purpose.
- **County adapter pattern.** Adding a new county means: new `src/adapters/<county>.ts` + register in `src/engine/run.ts` + add to `County` union in `src/types.ts` + badge color in `App.tsx`.
- **No CORS proxies for user keys.** If RentCast is CORS-blocked, surface a clear message and fall back — never route through a public proxy.
- **pdf-lib encoding.** ASCII/WinAnsi only. No Unicode arrows or special characters in PDF text.
- **Equity engine comp filters.** Refined comps: ±20% sqft, same class, minimum 5. Falls back to ±40% if fewer than 5 refined. Land+split requires ≥3 comps with both `landValue > 0` and `improvementValue > 0`.
- **Homestead cap logic.** Collin doesn't publish net appraised — `computeCapFloor` infers from prior-year value + 10%. Denton publishes `ownerNetAppraisedValue` directly.
- **Vite base path.** Must match repo name for GitHub Pages asset resolution. Set in `vite.config.ts`.
- **Keep user-facing messaging aligned with the disclaimer:** this is not legal or tax advice.

## Deployment

Every push to `main` triggers `.github/workflows/deploy.yml` (build → `upload-pages-artifact` → `deploy-pages`). Pages source must be set to "GitHub Actions" in repo settings — the `configure-pages` step 404s otherwise.

Live site: <https://venkatesanps.github.io/property-protest/>

## Annual maintenance checklist

- Add the new Collin certified roll's resource ID to the top of `COLLIN_SOURCES` in `src/adapters/collin.ts`.
- `protestSeason()` in `src/constants.ts` drives the date-aware "What to do now" guidance
  (filing → hearing → planning); verify the phase boundaries still match the statute each year.
- Update `HPI` table, `HPI_LATEST_KEY`, and `HPI_LATEST_INDEX` in `src/adapters/hpi.ts` each quarter (FHFA releases ~2 months after quarter end) — or let the `refresh-hpi` workflow handle it.
- After adding a new county, add its ZIPs to `ALLOWED_ZIPS` in `scripts/refresh-redfin.mjs` and trigger the `Refresh Redfin ZIP sale data` workflow from the Actions tab.
- Refresh `EXAMPLE_PROPERTIES` in `App.tsx` (the Real Examples landing section) if values shift significantly.
