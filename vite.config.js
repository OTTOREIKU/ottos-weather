import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base './' so the built app works on GitHub Pages under any repo name
export default defineConfig({
  base: './',
  plugins: [react()],
  server: { port: 5175, strictPort: true },
})
