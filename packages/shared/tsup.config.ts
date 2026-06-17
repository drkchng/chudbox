import { defineConfig } from 'tsup'

// ESM + .d.ts only, no Node/DOM polyfills — keeps @chudbox/shared RN-safe so
// Vite, Cloudflare Workers, and Metro can all consume the compiled output.
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'es2022',
  dts: true,
  sourcemap: true,
  clean: true,
})
