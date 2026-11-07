/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Para GitHub Pages: cambia 'base' por '/nombre-de-tu-repo/'
  // Para Netlify/Vercel/Cloudflare Pages: déjalo como '/'
  base: '/visualizador-arbol-aconcagua/',
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: [],
  },
})
