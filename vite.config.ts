import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// IMPORTANT: Change 'tx-protest-helper' to your actual GitHub repo name before deploying.
// It must match the repository name exactly (case-sensitive).
// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/tx-protest-helper/',
})
