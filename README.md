# ProtestIQ — Texas Property Tax Protest Helper

**Live site:** <https://venkatesanps.github.io/property-protest/>

A free, fully browser-side web app that helps homeowners in **Collin** and **Denton** counties (the Frisco, TX area) decide whether to protest their property tax appraisal — and generates printable evidence packets for the Appraisal Review Board.

No backend. No database. No account. Deploys as a static site to GitHub Pages.

---

## What it does

1. **Looks up your property** from the public appraisal roll by address (Collin CAD or Denton CAD).
2. **Checks your homestead 10% cap.** A protest only lowers your tax bill if your argued value falls *below* the capped taxable value. The app flags when the cap already protects you so you don't waste a hearing.
3. **Runs an unequal-appraisal (equity) analysis** under Tex. Tax Code §41.43(b)(3): compares your $/sqft against the median of comparable homes in your CAD neighborhood — filtered to the same quality class and ±40% of your living area.
4. **Computes a land + building split** when both values are available: compares improvement value per sqft and land value separately, then recombines into an alternate indicated value.
5. **Optionally layers in market evidence:**
   - Your recent purchase price, aged to today's market with the public FHFA House Price Index (Dallas-Plano-Irving CBSA, 2005–2026).
   - Comparable sales you enter manually (a realtor friend can pull these from MLS).
   - RentCast automated valuation (50 free calls/month, your own key — stored only in your browser).
6. **Generates two PDF documents:**
   - *Board evidence packet* — formatted for filing with or presenting to the ARB: subject card, cap check, comp table, indicated value, market evidence, and Tex. Tax Code citations.
   - *Personal hearing playbook* — talking points, what to bring, and what to say at the hearing.

---

## The legal basis

Texas property tax protests have two independent grounds. ProtestIQ focuses on the stronger one:

### Unequal appraisal — Tex. Tax Code §41.43(b)(3)

> *"The appraisal of the property is unequal … [if it] exceeds the median appraised value of a reasonable number of comparable properties appropriately adjusted."*

In practice: if your home is appraised at $280/sqft and comparable homes in your appraisal neighborhood average $240/sqft, you are legally entitled to a reduction to $240 × your sqft — regardless of what your home would sell for. No sale-price evidence is required.

This is the most winnable protest argument in Texas because:

- The data (CAD appraisal records) is fully public and free.
- The standard is the *median* of comparables — a statistical test, not an appraisal opinion.
- The ARB must accept the argument if the math is right.

### Over market value — Tex. Tax Code §41.43(a)

A separate ground: your appraised value exceeds what your home would sell for. ProtestIQ supports this argument when you have actual sale evidence — a recent purchase price or manual comps from MLS. Texas is a non-disclosure state (deed prices are hidden), so this argument is harder to support without a realtor connection.

---

## How the engine works

```text
Address input
    │
    ▼
Census geocoder (county detection)
    │  [CORS often fails → falls back to manual county selection]
    ▼
County adapter  ──────────────────────────────────────────────────────┐
  Collin: data.texas.gov Socrata API (resource vffy-snc6)             │
  Denton: Denton County ArcGIS REST (Parcels_FC layer)                │
    │                                                                  │
    ├─ fetchSubject()  →  SubjectProperty                              │
    └─ fetchComps()    →  Comp[]  (all A-category homes in nbhd)      │
                                                                       │
    ▼                                                                  │
computeCapFloor()     src/engine/cap.ts                                │
  Collin: market vs appraised (net not published)                      │
  Denton: ownerNetAppraisedValue vs ownerAppraisedValue                │
    → CapFloorResult { isCapped, floor }                               │
                                                                       │
    ▼                                                                  │
computeEquity()       src/engine/equity.ts                             │
  1. Filter comps: same qualityClass, sqft within ±40%                │
  2. Refined comps: further narrow to ±20% sqft (min 5)               │
  3. Class-matched comps: same class only                              │
  4. Compute median $/sqft for each group                              │
  5. Indicated values: refined / class-matched / size-adjusted         │
  6. Land+building split (when both values available, min 3 comps)     │
    → EquityResult { subjectPsf, neighborhoodMedianPsf,                │
                     indicatedValueRefined, ..., indicatedValueSplit } │
                                                                       │
    ▼                                                                  │
Market evidence (optional)                                             │
  fetchRentcastMarket()   src/adapters/market.ts                       │
  buildManualMarket()     src/adapters/market.ts                       │
  adjustToToday()         src/adapters/hpi.ts  (FHFA HPI aging)        │
    → MarketValueResult | null                                         │
    → PurchaseEvidence | null                                          │
                                                                       │
    ▼                                                                  │
computeVerdict()      src/engine/verdict.ts                            │
  Ranks all indicated values (equity methods + market + purchase)      │
  Picks the strongest argument that beats the cap floor                │
  Returns: code (protest / dont_protest / borderline / incomplete)     │
           targetValue, equityReduction, talkingPoints                 │
                                                                       │
    ▼                                                                  │
generateBoardPacket()   src/pdf/packet.ts  (pdf-lib, ASCII/WinAnsi)    │
generatePersonalPacket()                                               │
```

---

## Data sources

| Source | What it provides | Auth |
| ------ | ---------------- | ---- |
| [data.texas.gov](https://data.texas.gov/resource/vffy-snc6.json) Socrata API | Collin CAD full appraisal roll: living area, year built, quality class, neighborhood code, appraised value, land/improvement split | None — CORS-enabled public API |
| Denton County ArcGIS REST (`Parcels_FC/MapServer/0`) | Denton CAD full roll: same fields plus homestead-capped net value | None — CORS-enabled |
| US Census geocoder | County detection from address | None — often CORS-blocked; app falls back to manual selection |
| [FHFA House Price Index](https://www.fhfa.gov/hpi/download/quarterly_datasets/hpi_at_metro.csv) | Dallas-Plano-Irving CBSA quarterly index, 2005 Q1–2026 Q1 — embedded in `src/adapters/hpi.ts` | None — public domain |
| [RentCast AVM](https://www.rentcast.io) | Automated valuation + comparable sales | User-supplied key (50 free/month). May be CORS-blocked from browser. |
| Manual comps | User-entered sold prices from MLS or a realtor friend | N/A |

**Why no Zillow/Redfin/HAR?** Texas is a sale-price non-disclosure state. Deed records show "$10 and other consideration." Public AVM sites block scraping. RentCast and manual entry are the only free-tier options.

---

## File map

```text
src/
  adapters/
    address.ts       Address parsing and SQL-escape utilities
    census.ts        US Census geocoder (county detection)
    collin.ts        Collin CAD Socrata adapter
    denton.ts        Denton CAD ArcGIS adapter
    hpi.ts           FHFA HPI data + adjustToToday() function
    market.ts        RentCast AVM + manual-comp market builder
    suggest.ts       Address autocomplete (queries both county APIs)
  engine/
    cap.ts           Homestead 10% cap floor computation
    equity.ts        Unequal-appraisal (§41.43(b)(3)) engine
    run.ts           Orchestrator: geocode → fetch → engine → verdict
    verdict.ts       Picks best argument, generates talking points
  pdf/
    builder.ts       Low-level pdf-lib helpers (text, tables, layout)
    packet.ts        Board evidence packet + personal playbook PDFs
  App.tsx            UI shell, results dashboard, advanced panel
  types.ts           All domain interfaces
  format.ts          fmtUSD, fmtPsf, fmtNum helpers
  constants.ts       Protest deadline, form numbers, disclaimer text
```

---

## Run locally

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production build → dist/
npm run lint     # ESLint
```

To regenerate the sample PDF packets (fetches live Collin data):

```bash
npx tsx scripts/gen-sample.ts
# writes sample-whistler-board.pdf + sample-whistler-personal.pdf
```

---

## Deploy to your own GitHub account

1. Fork or clone this repo and push to a new GitHub repo.
2. Edit `vite.config.ts` — change `base` to match your repo name:
   ```ts
   base: '/<your-repo-name>/',
   ```
3. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
4. Every push to `main` auto-deploys via `.github/workflows/deploy.yml`.

Your site will be live at `https://<your-username>.github.io/<your-repo-name>/`.

---

## Adding a county

The app is a county router + per-county adapters. To add a new county:

1. Create `src/adapters/<county>.ts` implementing `fetchSubject()` and `fetchComps()`.
2. Register it in `src/engine/run.ts` (`fetchSubject` and `fetchComps` switches).
3. Add the county to the `County` union in `src/types.ts`.
4. Add a badge color to `COUNTY_BADGE` in `src/App.tsx`.

---

## Known caveats

- **Census geocoder CORS:** automatic county detection usually fails from a browser. The app detects this and asks you to pick a county manually — no loss of function.
- **RentCast CORS:** the market API may not send CORS headers. The app catches this, shows a clear amber message, and falls back to manual comps. The key is never routed through a proxy to avoid leaking it to a third party.
- **Appraisal rolls are annual.** The Collin adapter probes a newest-first list of data.texas.gov resources (`COLLIN_SOURCES` in `src/adapters/collin.ts`) at runtime — currently the year-less *Preliminary* dataset, falling back to the 2025 certified roll — and shows the resolved roll vintage in the UI and PDFs. Add the new certified roll's resource ID to the top of that list each year. Denton's ArcGIS service updates in place.
- **HPI data is embedded.** `src/adapters/hpi.ts` contains the FHFA index through 2026 Q1. Update `HPI` and `HPI_LATEST_KEY` / `HPI_LATEST_INDEX` each quarter.
- **Only Collin and Denton are supported.** The Frisco area spans both counties; ZIP 75036 in particular has homes in both.

---

## Disclaimer

Estimates only — **not legal or tax advice.** The Appraisal Review Board makes the final determination on any protest. Consult a licensed property tax consultant or attorney for advice specific to your situation.
