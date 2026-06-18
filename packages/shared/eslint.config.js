import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import { globalIgnores } from 'eslint/config'

export default tseslint.config([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
    },
  },
  {
    // RN-safety lockdown (M5): this package must run unchanged under Vite,
    // Cloudflare Workers, and Metro/React Native, so NO DOM/Node global or
    // platform-specific module may leak into the shipped sources. The glob
    // covers every non-test module under src/ (see docs/MOBILE.md); persisters,
    // synchronizers and UI bindings are platform concerns the CONSUMER injects
    // (store.ts createGarageStore), never imported here.
    files: ['src/**/*.ts'],
    ignores: ['src/**/*.test.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'window', message: 'RN-safe package: no DOM globals.' },
        { name: 'document', message: 'RN-safe package: no DOM globals.' },
        { name: 'localStorage', message: 'RN-safe package: no DOM globals.' },
        { name: 'sessionStorage', message: 'RN-safe package: no DOM globals.' },
        { name: 'navigator', message: 'RN-safe package: no DOM globals.' },
        { name: 'location', message: 'RN-safe package: no DOM globals.' },
        { name: 'process', message: 'RN-safe package: no Node globals.' },
        { name: 'Buffer', message: 'RN-safe package: no Node globals.' },
        { name: '__dirname', message: 'RN-safe package: no Node globals.' },
        { name: '__filename', message: 'RN-safe package: no Node globals.' },
        { name: 'require', message: 'RN-safe package: ESM only.' },
      ],
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'react', message: 'RN-safe core: no UI framework — keep this package framework-free.' },
            { name: 'react-dom', message: 'RN-safe core: no DOM renderer.' },
            { name: 'react-native', message: 'RN-safe core: no platform packages — inject platform bits from the consumer.' },
            { name: 'fs', message: 'RN-safe core: no Node builtins (use injected persisters).' },
            { name: 'path', message: 'RN-safe core: no Node builtins.' },
            { name: 'crypto', message: 'RN-safe core: use globalThis.crypto (see id.ts), not the Node module.' },
          ],
          patterns: [
            {
              group: ['node:*'],
              message: 'RN-safe core: no Node builtins — Metro/RN cannot resolve node:* specifiers.',
            },
            {
              group: [
                'tinybase/persisters',
                'tinybase/persisters/*',
                'tinybase/synchronizers',
                'tinybase/synchronizers/*',
                'tinybase/ui-react',
                'tinybase/ui-react/*',
              ],
              message:
                'Persisters/synchronizers/UI are platform-specific — inject them via createGarageStore() callers (web: indexed-db + ws; DO: durable-object-sql-storage; RN: expo-sqlite), never import them in @chudbox/shared.',
            },
          ],
        },
      ],
    },
  },
])
