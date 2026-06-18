/**
 * TanStack Query client — DEC-11 / DEC-15.
 *
 * SCOPE GUARDRAIL: this client owns the network refetch/staleness lifecycle for
 * the share/follow READ surface ONLY (the Watching list's `?view=card` refetch).
 * The garage's durable local+sync state stays entirely on TinyBase — do NOT
 * route any garage query/mutation through this client (DATA_MODEL §12.8 #5).
 *
 * Defaults are tuned for a soft, non-critical background freshness pass: a
 * 60s stale window, no refetch-on-focus storm, and a single retry. The card
 * fetch (fetchShareCard) never throws — it maps every failure to a CardResult —
 * so retries here are belt-and-suspenders, never a way to surface errors.
 */
import { QueryClient } from '@tanstack/react-query'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: 5 * 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})
