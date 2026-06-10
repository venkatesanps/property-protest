# Texas Property Tax Protest Helper

A free, fully client-side web app that helps homeowners in **Collin** and **Denton**
counties (the Frisco, TX area) decide whether to protest their property tax appraisal —
and generates a printable evidence packet to attach to Comptroller **Form 50-132**.

Everything runs in the browser. No backend, no database, no paid services. It deploys
as a static site to **GitHub Pages** for free.

## What it does

1. **Looks up your property** from the public appraisal roll by address.
2. **Checks the homestead 10% cap.** A protest only lowers your bill if your argued
   value falls below the capped *taxable* value — the app flags when the cap already
   shields you (so you don't waste time protesting).
3. **Runs an unequal-appraisal (equity) analysis** per Tex. Tax Code §41.43(b)(3):
   compares your $/sqft against the median of comparable homes in your CAD neighborhood.
4. **(Optional) Estimates market value** from RentCast (50 free calls/month, your own
   key) or from comparable sales you enter manually.
5. **Generates a PDF evidence packet** with your subject card, the cap check, the
   comp table, market evidence, and filing instructions.

## Data sources (all free, no auth)

| County | Source | Notes |
|--------|--------|-------|
| Collin | [data.texas.gov](https://data.texas.gov) Socrata API (resource `vffy-snc6`) | CORS-enabled. Does **not** expose the homestead-capped value. |
| Denton | Denton County ArcGIS REST (`Parcels_FC` layer) | CORS-enabled. Exposes net appraised (capped) value. |
| County detection | US Census geocoder | Often **blocked by browser CORS** — app falls back to manual county selection. |
| Market value (optional) | [RentCast](https://www.rentcast.io) AVM | User-supplied API key, stored only in your browser. May be CORS-blocked. |

## Run locally

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production build into dist/
```

## Deploy to your own GitHub account

1. Create a new GitHub repo and push this code to the `main` branch.
2. **Rename the base path** in [vite.config.ts](vite.config.ts) to match your repo name:
   ```ts
   base: '/<your-repo-name>/',
   ```
3. In your repo: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
4. The included workflow ([.github/workflows/deploy.yml](.github/workflows/deploy.yml))
   builds and publishes automatically on every push to `main`.

Your site will be live at `https://<your-username>.github.io/<your-repo-name>/`.

## Known limitations / caveats

- **Census geocoder CORS:** automatic county detection usually fails from a browser.
  The app detects this and asks you to pick Collin or Denton manually — no loss of function.
- **RentCast CORS:** the market API may not allow browser calls. If it fails, the app
  silently falls back to your manually-entered comps.
- **Appraisal rolls are annual.** Update `COLLIN_RESOURCE_ID` in
  [src/adapters/collin.ts](src/adapters/collin.ts) when the new year's roll is published.
- Only Collin and Denton counties are supported today; the architecture is a county
  router plus per-county adapters, so adding a county means adding one adapter.

## Disclaimer

Estimates only — **not legal or tax advice.** The Appraisal Review Board makes the
final decision on any protest.
