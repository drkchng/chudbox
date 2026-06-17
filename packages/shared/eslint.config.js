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
    // RN-safety guard: this package must run under Vite, Workers, and Metro,
    // so no DOM/Node globals may leak into the shipped sources.
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
        { name: 'process', message: 'RN-safe package: no Node globals.' },
        { name: 'Buffer', message: 'RN-safe package: no Node globals.' },
        { name: '__dirname', message: 'RN-safe package: no Node globals.' },
        { name: 'require', message: 'RN-safe package: ESM only.' },
      ],
    },
  },
])
