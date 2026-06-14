# SKILL.md Enhancement Plan — Generalizing the 8-Module Protest Workflow to Collin / Denton / Tarrant

**Status:** Planning document only. No code changes proposed here are applied.
**Scope:** Make every module in [`SKILL.md`](../SKILL.md) work for ANY residential property in Collin, Denton, or Tarrant — within the app's static / browser-only / CORS constraints.
**Authoritative constraints:** browser-only static site (GitHub Pages, base `/property-protest/`), no backend, no DB, no paid services, no CORS proxy for user keys. See [`AGENTS.md`](../AGENTS.md) "Conventions".

---

## (a) Executive Summary — Module-by-Module Status

The app already implements the *strongest* parts of the SKILL.md methodology (unequal-appraisal / same-street / land+building split) far more rigorously than the SKILL.md prose describes. The gaps are concentrated in **Module 5 (beds/baths)** and parts of **Module 1 / Module 6 (lot size, stories, pool, prior-year %)** because the three CAD datasets don't all carry those fields, and in **Module 8 (per-county filing constants)** which is currently Collin-only.

| Module | SKILL.md goal | Current state | Gap | Feasibility |
|---|---|---|---|---|
| **1 — Property Record Extraction** | Pull account, legal desc, sqft, lot, year, beds/baths, pool, land/imprv split, prior-year % | **PARTIAL** — `SubjectProperty` carries account, address, sqft, yearBuilt, qualityClass, nbhd, land/imprv split, market & appraised. [`types.ts:6`](../src/types.ts), all three adapters' `toSubject()`. Collin also fetches `landsizesqft`/`landsizeacres`/`imprvpoolflag` but **drops them**. Prior-year value: Collin only. | No beds/baths anywhere. No lot size in `SubjectProperty`. Pool flag fetched but discarded (Collin). Prior-year % only Collin. Legal description not surfaced. | Automatable per-county where the field exists (lot size + pool: Collin via Socrata; Denton/Tarrant need field discovery). Beds/baths = **manual-input fallback** (not in any roll). |
| **2 — Same-Street / Neighbor Benchmarking** | §41.43(b)(1) unequal appraisal vs same-street comps | **DONE** — `computeEquity()` extracts street, filters same-street comps, ranks by similarity, takes best-5 median. [`equity.ts:16`](../src/engine/equity.ts), `extractStreet()` [`equity.ts:16`], same-street block [`equity.ts:34-73`]. Surfaced in verdict [`verdict.ts:43`] and packet talking points [`packet.ts:85`]. | None functionally. Could optionally widen the "±500 addresses" rule SKILL.md mentions, but current street-name match is more robust. | Fully automatable, all three counties (all expose nbhd code + address). |
| **3 — Market Value Sales Comps** | §41.43(a) actual closed sales, ±15% sqft, within appraisal year | **PARTIAL** — three market paths: RentCast AVM + comps (CORS-risk), manual comps (`buildManualMarket`), recent purchase aged via FHFA HPI. [`market.ts`](../src/adapters/market.ts), [`run.ts:162-198`]. Redfin ZIP median shown as context. | No *automatic* per-property closed-sales feed (TX non-disclosure + CORS). Relies on user/realtor input or a RentCast key. | Constrained by design. Automatable layer = Redfin ZIP median (already baked). Property-level comps = **manual / RentCast fallback**. This is a hard limit, not a bug. |
| **4 — Market Trend / Declining Value** | YoY decline, median $/sqft, DOM | **PARTIAL** — FHFA HPI (Dallas-Plano-Irving CBSA) embedded + auto-refreshed; Redfin ZIP median sale price + 12-mo % change embedded + auto-refreshed. [`hpi.ts`](../src/adapters/hpi.ts), [`redfin-zips.ts`](../src/adapters/redfin-zips.ts), workflows `refresh-hpi.yml` / `refresh-redfin.yml`. | HPI metro covers Collin/Denton only — **Tarrant is in the Fort Worth-Arlington CBSA (19124 ≠ Tarrant)**. No DOM metric. Redfin trend not woven into the verdict, only shown as context in packet [`packet.ts:382`]. | Automatable. Add Tarrant's FHFA CBSA. DOM not in Redfin ZIP feed (would need a different free field) — **defer / manual**. |
| **5 — Bedroom / Feature Adjustments** | Adjust for bed/bath/feature differences vs comps | **MISSING** — no bed/bath/stories field in `Comp`, `SubjectProperty`, or any adapter (grep-confirmed zero hits). The equity engine adjusts on **size, age, quality class** instead. | The specific bed/bath adjustment SKILL.md describes cannot run — the data isn't in any roll. | **Not automatable** from CADs. Quality-class + size adjustment already substitute for it. Beds/baths = **manual-input fallback** only, low ROI. |
| **6 — Land Value Reasonableness** | Land split vs identical lots; flag inflated land | **PARTIAL** — `indicatedValueSplit` compares comp improvement $/sqft + median comp land value, recombined. [`equity.ts:111-128`], packet [`packet.ts:284`]. All three adapters supply land + improvement for comps. | No **lot-size normalization** — split uses median comp land $ assuming uniform lots (true in PCR, not universally). No explicit "your land $ vs neighbor land $ on same-size lot" flag. Lot size absent from `Comp` entirely. | Land-split is automatable today (all counties carry land/imprv). Lot-size-normalized land check needs a lot-size field per county (Collin has it; Denton/Tarrant TBD) — **partial automatable**. |
| **7 — Evidence Package Assembly** | ARB-ready PDF: subject card, comps, market, trend, calc, form | **DONE (and exceeds SKILL.md)** — `generateBoardPacket()` + `generatePersonalPacket()` produce subject card, cap check, equity table, market evidence, HPI, Redfin ZIP, flood zone, condition, CAD discrepancies, talking points, script, checklist. [`packet.ts`](../src/pdf/packet.ts). Plus a CAD-evidence counter-strategy analyzer [`counter-strategy.ts`](../src/engine/counter-strategy.ts). | Module-2 *neighbor table* and Module-3 *sales table* present; no explicit weighted-average derivation table (SKILL.md's 40/60 weighting). CAD-evidence analyzer has Collin-example hardcoded strings. | Fully automatable. Quick polish items only. |
| **8 — Filing & Deadline Tracker** | Per-county deadlines, portal URLs, effective tax rate, checklist | **PARTIAL** — single global `PROTEST_DEADLINE='May 15'`, `TAX_RATE=0.0179`, `protestSeason()` phase logic, `COMPTROLLER_FORM`. [`constants.ts`](../src/constants.ts). Portal links scattered in `App.tsx` (Collin esearch, Denton CAD) [`App.tsx:1475`]. | No per-county constants table: portal URLs, online-protest URLs, effective tax rate, ARB contact all differ by county and are Collin-centric or missing for Tarrant. | Fully automatable — a static per-county constants map. **Recommended Phase 1 centerpiece.** |

**Bottom line:** Modules 2, 7 are **DONE**; Modules 1, 3, 4, 6 are **PARTIAL** (gaps mostly bounded by what each CAD roll publishes); Module 5 is **MISSING and largely infeasible** to automate; Module 8 is **PARTIAL and the cheapest high-value fix**.

---

## (b) Per-County Field-Availability Matrix

Verified from each adapter's field map and `toSubject`/`toComp`.

| Field (SKILL.md need) | Collin (`collin.ts`) | Denton (`denton.ts`) | Tarrant (`tarrant.ts`) | In `SubjectProperty`? | In `Comp`? |
|---|---|---|---|---|---|
| Account / ID | `propid` ✅ | `pid` ✅ | `pin` (padded) ✅ | ✅ | ✅ |
| Address (situs) | `situsconcat` ✅ | `situs_full_address` ✅ (no ZIP) | `situsaddress` ✅ (no ZIP) | ✅ | ✅ |
| Living area sqft | `imprvmainarea` ✅ | `imprvMainArea` ✅ | `actualarea` ✅ | ✅ | ✅ |
| Year built | `imprvyearbuilt` ✅ | `imprvActualYearBuilt` ✅ | `yearbuilt` ✅ | ✅ | ✅ |
| Quality class | `imprvclasscd` ✅ | `imprvClasses` ✅ | `applclasscd` ✅ | ✅ | ✅ |
| Neighborhood code | `nbhdcode` ✅ | `asCode` ✅ | `nbhdcd` (padded) ✅ | ✅ | ✅ (filter) |
| Appraised value | `currvalappraised` ✅ | `ownerAppraisedValue` ✅ | `totalmarketvalue` (proxy) ⚠️ | ✅ | ✅ |
| Market value | `currvalmarket` ✅ | `ownerMarketValue` ✅ | `totalmarketvalue` ✅ | ✅ | — |
| Land value | `currvalland` ✅ | `landHSValue`+`landNHSValue` ✅ | `landmarketvalue` ✅ | ✅ | ✅ |
| Improvement value | `currvalimprv` ✅ | `improvementValue` ✅ | `improvementmarketvalue` ✅ | ✅ | ✅ |
| Net appraised (cap) | ❌ not published | `ownerNetAppraisedValue` ✅ | ❌ not published | ✅ (Denton only) | — |
| Homestead cap amount | ❌ | `ownerHSTaxLimitationValue` ✅ | ❌ | ✅ (Denton only) | — |
| Prior-year value | `prevvalappraised` ✅ (fetched) | ❌ | ❌ | ✅ (Collin only) | — |
| **Lot size** | `landsizesqft` / `landsizeacres` ✅ **(fetched but dropped)** | ❓ field not requested (likely exists in ArcGIS) | ❓ field not requested (likely exists) | ❌ | ❌ |
| **Pool flag** | `imprvpoolflag` ✅ **(fetched but dropped)** | ❓ | ❓ | ❌ | ❌ |
| **Bedrooms** | ❌ not in dataset | ❌ | ❌ | ❌ | ❌ |
| **Bathrooms** | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Stories** | ❌ | ❌ | ❌ | ❌ | ❌ |
| Legal description | partial (`nbhdcode` only) | `abstractSubdivisionDescription` ✅ (fetched, dropped) | ❌ | ❌ | — |
| Exemptions | ❌ | `exemptions` ✅ | ❌ | ✅ (Denton only) | — |
| Lat/Lng centroid | ❌ (Census fallback) | `returnCentroid` ✅ | `returnCentroid` ✅ | ✅ | — |
| Roll vintage | probed `noticedate` ✅ | live roll | `taxyear` ✅ | ✅ | — |

**Key per-county differences:**
- **Cap floor only works on Denton.** Collin and Tarrant don't publish net appraised, so `computeCapFloor` returns `available:false` and the verdict treats any reduction below appraised as a win. [`cap.ts:9`], [`collin.ts:90`], [`tarrant.ts:104`].
- **Tarrant uses market value as the appraised proxy** (TADMap doesn't expose appraised). [`tarrant.ts:104`].
- **Lot size + pool are already fetched on Collin but never mapped** into the domain types — the easiest Module-1/6 win. [`collin.ts:133`].
- **Beds/baths/stories exist in NO roll** — Module 5's core inputs are simply not public CAD data in these counties.
- **Prior-year value (Module 1 "% change") is Collin-only.**
- **FHFA HPI metro mismatch:** `hpi.ts` is CBSA 19124 (Dallas-Plano-Irving) which covers Collin + Denton. Tarrant is in the **Fort Worth-Arlington-Grapevine** division — the HPI aging is currently *wrong for Tarrant purchases*.

---

## (c) Phased Enhancement Plan

Effort: **S** ≤0.5 day, **M** ~1–2 days, **L** >2 days. All respect static-only.

### Phase 1 — Quick wins reusing data already fetched (highest ROI)

#### 1.1 Per-county filing & deadline constants table (Module 8) — **S**
- **Build:** A `COUNTY_INFO` map (county → `{ cadName, propertySearchUrl, onlineProtestUrl, arbInfoUrl, effectiveTaxRate, noticesMailedTypical }`). Replace scattered links in `App.tsx` and the global `TAX_RATE` with per-county lookups; feed packet's "How the Protest Works" and tax-savings estimate from it.
- **Files:** new block in [`constants.ts`](../src/constants.ts) (or `src/county-info.ts`); consume in [`packet.ts`](../src/pdf/packet.ts) (`countyLabel`, fileStep, savings), [`verdict.ts:14`] (replace `TAX_RATE` import with per-county rate), [`App.tsx:1475`] (data-driven links).
- **Data source:** static constants (public CAD pages; effective rates from county tax-rate worksheets). County applicability: all three. **No fetch, no CORS.**
- **Risk:** Low — purely additive. Tax rates are estimates already (disclaimer covers it).
- **Acceptance:** Board/personal packets for a Tarrant and a Denton property show the correct CAD name, online-protest URL, and a county-specific tax-savings figure; no hardcoded `0.0179` remains in the savings path.

#### 1.2 Surface lot size + pool on Collin (Module 1 & 6) — **S**
- **Build:** Add `lotSizeSqft: number | null` and `hasPool: boolean | null` to `SubjectProperty` (and optionally `Comp`). Map them in Collin's `toSubject`/`toComp` from the already-fetched `landsizesqft` / `landsizeacres` / `imprvpoolflag`; leave `null` for Denton/Tarrant until 2.x adds them. Show lot size in the packet subject card; add a pool talking point.
- **Files:** [`types.ts:6`], [`collin.ts:78`] (`toSubject`) + [`collin.ts:104`] (`toComp`, add to `$select` [`collin.ts:289`]), [`packet.ts:229`] subject card.
- **Data source:** Collin Socrata (already in `SUBJECT_SELECT`). County applicability: Collin now; Denton/Tarrant null.
- **Risk:** Low. Null-safe everywhere.
- **Acceptance:** A Collin subject card prints lot size; a pool property shows a pool note; Denton/Tarrant render "n/a" without errors.

#### 1.3 Lot-size-normalized land check (Module 6) — **S/M** (depends on 1.2)
- **Build:** When `lotSizeSqft` is present for subject + ≥3 comps, compute land $/lot-sqft median and flag if subject's land $/lot-sqft exceeds the neighborhood median by >X%. Extends the existing split logic in `equity.ts`.
- **Files:** [`equity.ts:111`] (new optional fields on `EquityResult` in [`types.ts:52`]), packet land section [`packet.ts:284`].
- **Data source:** lot size from 1.2. County applicability: Collin now; others when lot size lands (Phase 2).
- **Risk:** Medium — only runs when lot size exists; degrade gracefully to current behavior.
- **Acceptance:** Collin property with non-uniform land values produces a "land over-valued vs same-size lots" flag; uniform-lot property does not.

#### 1.4 Fix FHFA HPI metro for Tarrant (Module 4) — **S**
- **Build:** Add the Fort Worth-Arlington-Grapevine FHFA division series alongside 19124; select by county in `adjustToToday`. Wire `scripts/refresh-hpi.mjs` to pull both CBSAs.
- **Files:** [`hpi.ts`](../src/adapters/hpi.ts) (second `HPI` table + county param), [`run.ts:191`] (pass county), `scripts/refresh-hpi.mjs`, workflow stays the same.
- **Data source:** FHFA `hpi_at_metro.csv` (already used). County applicability: corrects Tarrant; Collin/Denton unchanged.
- **Risk:** Low. Verify the correct CBSA code for Fort Worth-Arlington.
- **Acceptance:** A Tarrant purchase-price aging cites the Fort Worth-Arlington index, not Dallas-Plano-Irving.

#### 1.5 De-hardcode the CAD counter-strategy strings (Module 7) — **S**
- **Build:** The CAD-evidence analyzer embeds Collin-example literals ("VB2 class", "Rolling Thunder Rd", "$183k land"). [`counter-strategy.ts:106-128`]. Replace with values derived from the parsed evidence / `userEquity` so the narrative generalizes to any county/class.
- **Files:** [`counter-strategy.ts`](../src/engine/counter-strategy.ts) weakness builders.
- **Data source:** existing parsed evidence. County applicability: all three.
- **Risk:** Low — string templating only.
- **Acceptance:** A Tarrant CAD-evidence run never prints "VB2"/"Rolling Thunder" unless that's the actual data.

### Phase 2 — New per-county adapter fields

#### 2.1 Discover & add lot size / pool for Denton & Tarrant (Module 1 & 6) — **M**
- **Build:** Inspect the Denton ArcGIS `Parcels_FC/0` and Tarrant `TADMap/0` layer schemas for lot-size / land-area and pool/feature fields; add to `*_FIELDS`, map into `toSubject`/`toComp`, populating the `lotSizeSqft`/`hasPool` from 1.2.
- **Files:** [`denton.ts:51`], [`tarrant.ts:53`], adapters' `toComp`.
- **Data source:** ArcGIS layer metadata (query `?f=json` on the layer). County applicability: Denton, Tarrant.
- **Risk:** Medium — field names unknown until schema is inspected; some layers omit lot size. **Open question — needs field discovery.**
- **Acceptance:** Denton/Tarrant subject cards print lot size where the layer carries it; null otherwise.

#### 2.2 Surface legal description & prior-year change (Module 1) — **S/M**
- **Build:** Add `legalDescription` (Denton `abstractSubdivisionDescription`, already fetched-and-dropped) and generalize `priorYearValue` (Collin has it; investigate Denton/Tarrant prior-year fields). Show "prior → current (+X%)" in the subject card.
- **Files:** [`types.ts:6`], adapters, [`packet.ts:229`].
- **Data source:** Denton ArcGIS (have it), Collin (have it). County applicability: mixed.
- **Risk:** Low–medium (prior-year may not exist for Denton/Tarrant → null).
- **Acceptance:** Denton card shows subdivision legal description; Collin card shows YoY % change.

#### 2.3 Weave Redfin ZIP trend into the verdict narrative (Module 4) — **S**
- **Build:** Today the Redfin ZIP median + 12-mo change is shown only as packet context. Add a declining-market talking point and (optionally) a soft market-evidence candidate when the ZIP trend is sharply negative.
- **Files:** [`verdict.ts`](../src/engine/verdict.ts), [`packet.ts:69`] talking points, reuse `getZipTrend` [`redfinTrend.ts`].
- **Data source:** embedded Redfin ZIPs (already refreshed). County applicability: all three (ZIP coverage already spans the three counties per `ALLOWED_ZIPS`).
- **Risk:** Low — keep it a talking point, not a hard indicated value (ZIP median ≠ property value).
- **Acceptance:** A property in a ZIP down >5% YoY gets an explicit "market declining" argument line in the personal packet.

### Phase 3 — Manual-input-driven modules (the data CADs don't publish)

#### 3.1 Optional beds/baths manual entry + adjustment (Module 5) — **M**
- **Build:** Add optional `bedrooms`/`bathrooms` to the Advanced panel and to manual-comp entry. If supplied for subject and comps, apply the SKILL.md ±$15–25/sqft-per-bed style adjustment as an *additional* talking point (not a primary indicated value). If not supplied, behave exactly as today.
- **Files:** [`App.tsx`] advanced panel, [`types.ts`] (`ManualComp`, a `ProtestExtras` bed/bath field), [`equity.ts`]/[`packet.ts`] for the adjustment note.
- **Data source:** **manual input only** (no roll has beds/baths). County applicability: all three, but user-dependent.
- **Risk:** Medium — low adoption (users rarely know comp bed counts); keep it strictly optional and clearly secondary to the quality-class adjustment already in place.
- **Acceptance:** With beds entered, a "your home has fewer beds yet higher $/sqft" line appears; with none entered, output is unchanged. **Recommend gating behind product-owner sign-off — likely low ROI vs effort.**

#### 3.2 Sales-comp ingestion polish (Module 3) — **S**
- **Build:** Improve the manual-comp UX (paste-from-MLS helper, validation, ±15% sqft / 12-month-window hints), and make the deep-link to Redfin/Zillow sold-search county-aware.
- **Files:** [`App.tsx`] manual comps, [`market.ts`] `buildManualMarket`.
- **Data source:** manual / one-click external links (no scraping — TX non-disclosure + CORS make auto-pull infeasible). County applicability: all three.
- **Risk:** Low.
- **Acceptance:** Entering 3 comps yields a clean market-value candidate; sold-search link is prefilled with the subject's ZIP.

### Phase 4 — Filing/deadline tracker & packet upgrades

#### 4.1 Full filing tracker UI from the Phase-1 constants (Module 8) — **M**
- **Build:** A date-aware filing panel (uses `protestSeason()` + per-county `COUNTY_INFO` from 1.1): shows this county's deadline, online-protest button, "notices mailed" window, and a live checklist mirroring SKILL.md Module 8. Persist a per-property checklist in `localStorage`.
- **Files:** [`App.tsx`], [`constants.ts`], reuse `protestSeason()` [`constants.ts:27`].
- **Data source:** static constants + browser localStorage. County applicability: all three.
- **Risk:** Low–medium (state persistence only).
- **Acceptance:** Tarrant user sees Tarrant's portal + deadline and a checkable filing checklist that survives reload.

#### 4.2 Weighted-derivation summary table in the board packet (Module 7) — **S**
- **Build:** Add the SKILL.md-style derivation table (unequal-appraisal value, market value, weighted target, aggressive target) so the ARB sees the math, mirroring `derive()`'s candidate set. Already have all the numbers in `verdict`/`equity`.
- **Files:** [`packet.ts:198`] board packet.
- **Data source:** existing analysis. County applicability: all three.
- **Risk:** Low.
- **Acceptance:** Board packet shows a one-page "how we got the requested value" table.

---

## (d) Data-Source Feasibility Appendix — CORS-viable vs Manual

| SKILL.md data source | Viable from static browser? | What we use instead |
|---|---|---|
| Collin CAD `esearch.collincad.org` (scrape) | ❌ HTML scrape / CORS | **data.texas.gov Socrata** (`collin.ts`) — CORS-enabled JSON ✅ |
| Denton CAD `dcad.org` (scrape) | ❌ | **Denton ArcGIS REST** (`denton.ts`) — CORS ✅ |
| Tarrant CAD (scrape) | ❌ | **TADMap ArcGIS** (`tarrant.ts`) — CORS ✅ |
| HAR.com street pages | ❌ CORS + ToS | Same-street comps from the **CAD roll itself** (`equity.ts`) ✅ — better, it's the official record |
| Redfin / Zillow / Movoto property pages | ❌ CORS + anti-scrape | **Redfin Data Center ZIP TSV** baked at build time (`redfin-zips.ts`) ✅ for ZIP medians; property-level = manual/RentCast |
| Redfin/Movoto YoY trend charts | ❌ live | **Embedded Redfin ZIP % change + FHFA HPI**, refreshed by GitHub Actions ✅ |
| Days-on-market | ⚠️ not in baked feed | Defer or manual entry |
| Beds / baths / stories | ❌ not public CAD data in these counties | **Manual input only** (Phase 3.1) |
| Closed sale prices (Module 3) | ❌ TX non-disclosure + CORS | RentCast (user key, CORS-risk) OR manual comps OR HPI-aged purchase ✅ |
| Ownwell effective tax rate | ❌ scrape | **Static per-county constants** (Phase 1.1) ✅ |
| FEMA flood zone | ✅ already integrated (`flood.ts`) | — |
| US Census geocoder | ⚠️ usually CORS-blocked | Manual county select + ArcGIS centroids ✅ |

**Rule of thumb confirmed in code/comments:** anything property-specific that isn't on a CAD ArcGIS/Socrata endpoint (sale prices, beds/baths, DOM) is either **manual-input** or a **user-keyed API with a CORS fallback** — never a scrape, never a proxy for user keys ([`AGENTS.md`](../AGENTS.md) "No CORS proxies for user keys").

---

## (e) Open Questions / Decisions Needed from Product Owner

1. **Module 5 (beds/baths) — build or skip?** No CAD roll carries it; only manual entry is possible and adoption is likely low. Quality-class + size adjustment already substitute. Recommend **skip or Phase-3-optional only**. (Phase 3.1)
2. **Lot size for Denton/Tarrant** requires inspecting the ArcGIS layer schemas — field names unknown. Approve the discovery spike? (Phase 2.1)
3. **Effective tax rates per county** — use a single representative rate per county, or per-city/ISD breakdown? Single per-county is far simpler and matches the "estimate only" disclaimer. (Phase 1.1)
4. **Tarrant HPI division** — confirm we want the Fort Worth-Arlington FHFA division added (today Tarrant purchases are aged with the wrong metro). (Phase 1.4) Recommend **yes — it's a correctness bug**.
5. **CAD-evidence analyzer scope** — is the uploaded-evidence counter-strategy ([`counter-strategy.ts`](../src/engine/counter-strategy.ts)) meant for all three counties? It currently hardcodes a Collin example; generalizing is cheap (Phase 1.5) but confirm it's an active feature worth the polish.
6. **Days-on-market (Module 4)** — acceptable to omit (not in the baked Redfin feed) or worth sourcing a free DOM field? Recommend **omit for now**.

---

## Recommended Phase 1 (do these first)

A tightly-scoped, all-static, mostly-additive set that closes the widest gaps with the least risk:

1. **1.1 Per-county filing/deadline/tax-rate constants** — fixes Module 8 for Denton & Tarrant (currently Collin-centric). Highest leverage.
2. **1.4 Fix FHFA HPI metro for Tarrant** — a correctness bug for every Tarrant purchase aging.
3. **1.2 Surface Collin lot size + pool** (already fetched, just dropped) — closes part of Modules 1 & 6 for free.
4. **1.5 De-hardcode CAD counter-strategy strings** — makes Module 7's evidence analyzer county-neutral.

Then **1.3** (land-size-normalized check) and **2.3** (Redfin trend in verdict) as fast follows. Defer Module 5 pending the product decision above.
