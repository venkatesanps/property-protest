# Agent Instructions for tx-protest-helper

## Project summary
- Client-side React + TypeScript + Vite app.
- Builds a static site for Texas property tax protest analysis in Collin and Denton counties.
- No backend server, no database, no paid services.
- The app is designed to run entirely in the browser and may be deployed to GitHub Pages.

## Local commands
- `npm install`
- `npm run dev` — start local Vite development server
- `npm run build` — production build
- `npm run lint` — run ESLint over the workspace

## Architecture and key areas
- `src/main.tsx` — app entry point
- `src/App.tsx` — primary application shell and routing
- `src/adapters/` — county-specific data adapters and external API integration
- `src/components/engine/` — core analysis logic for cap checks, equity comparison, and verdicts
- `src/pdf/packet.ts` — PDF evidence-packet generation
- `src/constants.ts` — shared constants and resource IDs
- `src/types.ts` — domain types used across the app

## Conventions and important behavior
- This is a browser-only static application. Do not add a server or backend API unless the repo is explicitly extended for that purpose.
- The app supports only Collin and Denton counties today; adding another county should follow the adapter pattern in `src/adapters/`.
- The project depends on browser CORS behavior for public data sources. Key known cases:
  - US Census geocoder often fails due to CORS, and the UI falls back to manual county selection.
  - RentCast may be CORS-blocked, and the app should gracefully fall back to manual comps.
- If modifying deployment behavior, update `vite.config.ts` base path for GitHub Pages.

## Useful docs and references
- `README.md` — user-facing project description, deployment notes, and limitations
- `vite.config.ts` — static site base path configuration for GitHub Pages
- `package.json` — scripts and dependency set

## Agent guidance
- Prefer minimal changes that keep the app browser-only and static.
- Preserve the existing county adapter pattern when adding new sources or counties.
- Keep user-facing messaging aligned with the app's disclaimer: this is not legal or tax advice.
- When editing data source logic, preserve the distinction between Collin (`src/adapters/collin.ts`) and Denton (`src/adapters/denton.ts`).
