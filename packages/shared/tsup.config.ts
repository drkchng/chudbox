import { defineConfig } from 'tsup'

// ESM + .d.ts only, no Node/DOM polyfills — keeps @chudbox/shared RN-safe so
// Vite, Cloudflare Workers, and Metro can all consume the compiled output.
export default defineConfig({
  // index = the full domain layer; tokens = a lean standalone entry so the web
  // theme codegen can import the design SSOT without pulling in tinybase/zod.
  entry: ['src/index.ts', 'src/tokens.ts'],
  format: ['esm'],
  target: 'es2022',
  dts: true,
  sourcemap: true,
  clean: true,
})
