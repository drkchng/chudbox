// Switch-ready uid (BACKEND_PLAN.md, "Frontend adapter"): replaces the
// Math.random()+Date.now() uid in M2 so rowIds cannot collide across devices.
//
// RN-safe: resolves crypto off `globalThis` (never `window`/`require`), so it
// runs unchanged under browsers, Cloudflare Workers, Node >= 19 and vitest —
// all of which expose a global WebCrypto with randomUUID().
//
// REACT NATIVE / EXPO (future apps/mobile — see docs/MOBILE.md): the Hermes/JSC
// runtime has NO global crypto, so `import 'react-native-get-random-values'`
// MUST run once at app entry (before the first newId() call) to install
// globalThis.crypto. Without it newId() throws the explicit message below
// rather than minting a weak id. No runtime change here — only the polyfill the
// consumer adds; this module imports nothing platform-specific.

type CryptoLike = { randomUUID?: () => string }

/** Collision-safe row/entity id: crypto.randomUUID(). */
export function newId(): string {
  const cryptoApi = (globalThis as unknown as { crypto?: CryptoLike }).crypto
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID()
  throw new Error(
    '@chudbox/shared newId(): crypto.randomUUID is unavailable in this runtime; install a WebCrypto polyfill before use.',
  )
}
