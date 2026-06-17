// Switch-ready uid (BACKEND_PLAN.md, "Frontend adapter"): replaces the
// Math.random()+Date.now() uid in M2 so rowIds cannot collide across devices.
//
// RN-safe: uses the global WebCrypto object (browsers, Workers, Node ≥ 19,
// vitest). React Native needs a crypto polyfill (e.g. expo-crypto /
// react-native-get-random-values) installed before first use — tracked as an
// M5 concern in the plan.

type CryptoLike = { randomUUID?: () => string }

/** Collision-safe row/entity id: crypto.randomUUID(). */
export function newId(): string {
  const cryptoApi = (globalThis as unknown as { crypto?: CryptoLike }).crypto
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID()
  throw new Error(
    '@chudbox/shared newId(): crypto.randomUUID is unavailable in this runtime; install a WebCrypto polyfill before use.',
  )
}
