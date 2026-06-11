import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Deployed to GitHub Pages at https://venkatesanps.github.io/property-protest/
// `base` MUST match the repository name exactly (case-sensitive) or assets 404.
// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/property-protest/',
})
