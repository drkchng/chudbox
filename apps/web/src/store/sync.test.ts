// Sync negotiation (M2 verification (e)): the pure decision matrix, and the
// step executor run against a SIMULATED Durable Object — a second, schema-less
// MergeableStore driven through the exact same shared seed/clear semantics as
// GarageDO (decodeSeedChunk → applyMergeableChanges; delRow/delValues clear;
// live-row meta). Ordering invariants under test:
// - attach is always LAST (the golden rule);
// - keep-local re-stamps local content AFTER the cloud clear, otherwise the
//   DO's clear tombstones out-stamp the seeds and silently win;
// - verify-seed aborts BEFORE attach when the cloud doesn't match (the
//   clock-skew guard), so a failed seed can never propagate deletes locally.
import { describe, expect, it } from 'vitest'
import { createMergeableStore, createStore } from 'tinybase'
import type { MergeableStore, Store } from 'tinybase'
import { createGarageStore, decodeSeedChunk } from '@chudbox/shared'
import type { SeedChunkRequest, SyncMetaResponse } from '@chudbox/shared'
import {
  SYNC_CLEAR_PATH,
  SYNC_META_PATH,
  SYNC_SEED_PATH,
} from '@chudbox/shared'
import { PHOTO_PAYLOADS_TABLE } from './adapter'
import { writeNestedCars } from './migrate'
import {
  SeedVerificationError,
  decideSyncPlan,
  runSyncSteps,
} from './sync'
import type { SyncEnv, SyncStep } from './sync'
import { plainCar, richCar } from './testFixtures'

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

describe('decideSyncPlan (matrix)', () => {
  it('empty/empty → attach only', () => {
    expect(
      decideSyncPlan({ cloudHasRows: false, cloudHasValues: false, localHasRows: false }),
    ).toEqual({ kind: 'plan', steps: ['attach'] })
  })

  it('local data / empty cloud → seed, verify, attach (in that order)', () => {
    expect(
      decideSyncPlan({ cloudHasRows: false, cloudHasValues: false, localHasRows: true }),
    ).toEqual({ kind: 'plan', steps: ['seed', 'verify-seed', 'attach'] })
  })

  it('empty local / cloud data → adopt cloud values, then attach (download)', () => {
    expect(
      decideSyncPlan({ cloudHasRows: true, cloudHasValues: true, localHasRows: false }),
    ).toEqual({ kind: 'plan', steps: ['apply-cloud-values', 'attach'] })
    expect(
      decideSyncPlan({ cloudHasRows: true, cloudHasValues: false, localHasRows: false }),
    ).toEqual({ kind: 'plan', steps: ['attach'] })
  })

  it('data on both sides without a choice → explicit user decision required', () => {
    expect(
      decideSyncPlan({ cloudHasRows: true, cloudHasValues: true, localHasRows: true }),
    ).toEqual({ kind: 'need-choice' })
  })

  it('merge → cloud values win deterministically, seed before attach', () => {
    expect(
      decideSyncPlan({
        cloudHasRows: true,
        cloudHasValues: true,
        localHasRows: true,
        choice: 'merge',
      }),
    ).toEqual({ kind: 'plan', steps: ['apply-cloud-values', 'seed', 'attach'] })
  })

  it('keep-cloud → local reset FIRST, then attach', () => {
    expect(
      decideSyncPlan({
        cloudHasRows: true,
        cloudHasValues: true,
        localHasRows: true,
        choice: 'keep-cloud',
      }),
    ).toEqual({ kind: 'plan', steps: ['reset-local', 'attach'] })
  })

  it('keep-local → clear, RE-STAMP, seed, verify, attach', () => {
    expect(
      decideSyncPlan({
        cloudHasRows: true,
        cloudHasValues: true,
        localHasRows: true,
        choice: 'keep-local',
      }),
    ).toEqual({
      kind: 'plan',
      steps: ['clear-cloud', 'restamp-local', 'seed', 'verify-seed', 'attach'],
    })
  })
})

// ── Simulated Durable Object (mirrors GarageDO semantics) ───
class FakeCloud {
  store: MergeableStore = createMergeableStore() // schema-less, like the DO
  seedCalls = 0
  clearCalls = 0

  seed(encodedChunk: string): void {
    this.seedCalls += 1
    this.store.applyMergeableChanges(decodeSeedChunk(encodedChunk))
  }

  clear(): void {
    this.clearCalls += 1
    for (const tableId of this.store.getTableIds()) {
      this.store.transaction(() => {
        for (const rowId of this.store.getRowIds(tableId)) this.store.delRow(tableId, rowId)
      })
    }
    if (this.store.hasValues()) {
      this.store.transaction(() => {
        this.store.delValues()
      })
    }
  }

  meta(): SyncMetaResponse {
    const rowCounts: Record<string, number> = {}
    for (const tableId of this.store.getTableIds()) {
      rowCounts[tableId] = this.store.getRowIds(tableId).length
    }
    const hasValues = this.store.getValueIds().length > 0
    const isEmpty = !hasValues && Object.values(rowCounts).every((count) => count === 0)
    return { isEmpty, rowCounts, hasValues }
  }
}

interface Harness {
  cloud: FakeCloud
  env: SyncEnv
  callLog: string[]
  local: MergeableStore
  localSide: Store
}

function makeHarness(options?: { clearDelayMs?: number; metaOverride?: () => SyncMetaResponse }): Harness {
  const cloud = new FakeCloud()
  const local = createGarageStore()
  const localSide = createStore()
  const callLog: string[] = []
  const env: SyncEnv = {
    store: local,
    localStore: localSide,
    fetchJson: async (path, init) => {
      if (path === SYNC_SEED_PATH) {
        callLog.push('seed-chunk')
        const body = JSON.parse(init?.body ?? '') as SeedChunkRequest
        cloud.seed(body.chunk)
        return { applied: true }
      }
      if (path === SYNC_CLEAR_PATH) {
        callLog.push('clear')
        cloud.clear()
        // A real clear crosses a network round trip before the client can
        // re-stamp; emulate the wall-clock gap so HLC ordering is realistic.
        await sleep(options?.clearDelayMs ?? 5)
        return { cleared: true }
      }
      if (path === SYNC_META_PATH) {
        callLog.push('meta')
        return options?.metaOverride ? options.metaOverride() : cloud.meta()
      }
      throw new Error(`unexpected path ${path}`)
    },
    attach: async () => {
      callLog.push('attach')
      // A WsSynchronizer reconciles both replicas; merge() is the in-process
      // equivalent (mutual applyMergeableChanges).
      local.merge(cloud.store)
    },
  }
  return { cloud, env, callLog, local, localSide }
}

function seedLocal(harness: Harness, ids: string[]): void {
  writeNestedCars(
    harness.local,
    harness.localSide,
    ids.map((id, i) => richCar(id, i * 100)),
    { currency: 'USD', distanceUnit: 'mi' },
  )
}

function seedCloudDirect(cloud: FakeCloud, ids: string[]): void {
  // Another device's garage: write plain rows straight into the DO replica.
  for (const id of ids) {
    const car = plainCar(id, 500)
    cloud.store.setRow('cars', id, {
      year: car.year,
      make: 'CloudMake',
      model: car.model,
      trim: '',
      color: '',
      mileageRaw: '',
      nickname: '',
      purchaseDate: '',
      saleDate: '',
      status: 'current',
      salePrice: '',
      tradeFor: '',
      createdAt: car.createdAt,
    })
  }
}

describe('runSyncSteps against a simulated DO', () => {
  it('first sync into an empty cloud: chunked seed lands everything, attach is delta-only', async () => {
    const harness = makeHarness()
    seedLocal(harness, ['a', 'b'])
    const plan = decideSyncPlan({ cloudHasRows: false, cloudHasValues: false, localHasRows: true })
    await runSyncSteps((plan as { steps: SyncStep[] }).steps, harness.env)

    expect(harness.callLog.at(-1)).toBe('attach')
    expect(harness.cloud.store.getRowIds('cars').sort()).toEqual(['a', 'b'])
    expect(harness.cloud.store.getRowIds('maintenance')).toHaveLength(6)
    // The schema'd local store stamps its Values DEFAULTS at creation; the
    // seed carries them (settings sync from day one).
    expect(harness.cloud.store.getValue('currency')).toBe('USD')
    // Post-seed attach found NOTHING left to reconcile: stores already equal.
    expect(harness.cloud.store.getMergeableContent()).toEqual(
      harness.local.getMergeableContent(),
    )
  })

  it('re-seeding is idempotent (per-cell LWW no-op on identical stamps)', async () => {
    const harness = makeHarness()
    seedLocal(harness, ['a'])
    await runSyncSteps(['seed'], harness.env)
    const after = JSON.parse(JSON.stringify(harness.cloud.store.getMergeableContent())) as unknown
    await runSyncSteps(['seed'], harness.env)
    expect(harness.cloud.store.getMergeableContent()).toEqual(after)
  })

  it('keep-local: clear → restamp → seed wins over the clear tombstones; cloud-only cars stay gone', async () => {
    const harness = makeHarness()
    seedLocal(harness, ['mine'])
    // The cloud holds a DIVERGED copy of the same car id (an earlier sync of
    // this garage) plus a cloud-only car — the worst case: the clear
    // tombstones cover rowIds the local store ALSO carries.
    seedCloudDirect(harness.cloud, ['mine', 'theirs'])
    const localCarsBefore = harness.local.getTables()
    await sleep(2) // clear tombstones are minted strictly later than any write

    const plan = decideSyncPlan({
      cloudHasRows: true,
      cloudHasValues: false,
      localHasRows: true,
      choice: 'keep-local',
    })
    await runSyncSteps((plan as { steps: SyncStep[] }).steps, harness.env)

    expect(harness.callLog[0]).toBe('clear')
    expect(harness.callLog.at(-1)).toBe('attach')
    // The seed out-stamped the tombstones (because of the re-stamp)...
    expect(harness.cloud.store.getRowIds('cars')).toEqual(['mine'])
    expect(harness.cloud.store.getCell('cars', 'mine', 'make')).toBe('Mazda') // local copy won
    // ...the cloud-only car is tombstoned everywhere...
    expect(harness.local.getRowIds('cars')).toEqual(['mine'])
    // ...and the local garage's DATA is byte-identical to before.
    expect(harness.local.getTables()).toEqual(localCarsBefore)
  })

  it('REGRESSION: without the re-stamp, clear tombstones swallow every shared-path cell (why the step exists)', async () => {
    const harness = makeHarness()
    seedLocal(harness, ['mine'])
    seedCloudDirect(harness.cloud, ['mine', 'theirs']) // shared rowId, as above
    await sleep(2)

    // Deliberately run keep-local WITHOUT restamp-local.
    await runSyncSteps(['clear-cloud', 'seed'], harness.env)

    // Cells on paths the DO previously held were silently rejected (its
    // tombstones are newer than the original local stamps)...
    expect(harness.cloud.store.getCell('cars', 'mine', 'make')).toBeUndefined()
    // ...while never-before-seen paths slipped through, leaving a partially
    // resurrected row — which is exactly why count-based verification alone
    // cannot replace the restamp step:
    expect(harness.cloud.store.getCell('cars', 'mine', 'mileageMiles')).toBe(120000)
    // Attaching from here would have propagated the tombstones and deleted
    // the matching LOCAL cells. The shipped keep-local plan always restamps
    // first (see the passing test above).
  })

  it('keep-cloud: local reset has no tombstones, attach downloads the cloud garage intact', async () => {
    const harness = makeHarness()
    seedLocal(harness, ['mine'])
    harness.localSide.setValue('idbMigrated', true) // sentinel must survive
    seedCloudDirect(harness.cloud, ['theirs'])

    const plan = decideSyncPlan({
      cloudHasRows: true,
      cloudHasValues: false,
      localHasRows: true,
      choice: 'keep-cloud',
    })
    await runSyncSteps((plan as { steps: SyncStep[] }).steps, harness.env)

    // Cloud untouched, local replaced by the download.
    expect(harness.cloud.store.getRowIds('cars')).toEqual(['theirs'])
    expect(harness.local.getRowIds('cars')).toEqual(['theirs'])
    expect(harness.local.getCell('cars', 'theirs', 'make')).toBe('CloudMake')
    // Local payloads were dropped with the local garage; sentinels survive.
    expect(harness.localSide.getRowIds(PHOTO_PAYLOADS_TABLE)).toHaveLength(0)
    expect(harness.localSide.getValue('idbMigrated')).toBe(true)
  })

  it('merge: union of distinct rows; cloud values win deterministically over local ones', async () => {
    const harness = makeHarness()
    seedLocal(harness, ['mine'])
    harness.local.setValue('themeId', 'local-theme') // set AFTER cloud's → newer HLC
    seedCloudDirect(harness.cloud, ['theirs'])
    harness.cloud.store.setValue('themeId', 'cloud-theme')

    const plan = decideSyncPlan({
      cloudHasRows: true,
      cloudHasValues: true,
      localHasRows: true,
      choice: 'merge',
    })
    await runSyncSteps((plan as { steps: SyncStep[] }).steps, harness.env)

    expect(harness.local.getRowIds('cars').sort()).toEqual(['mine', 'theirs'])
    expect(harness.cloud.store.getRowIds('cars').sort()).toEqual(['mine', 'theirs'])
    // Local stamp was wall-clock newer, but cloud wins by POLICY:
    expect(harness.local.getValue('themeId')).toBe('cloud-theme')
    expect(harness.cloud.store.getValue('themeId')).toBe('cloud-theme')
    // Table stamps were preserved verbatim by apply-cloud-values: the local
    // car's cells kept their original data.
    expect(harness.local.getCell('cars', 'mine', 'make')).toBe('Mazda')
  })

  it('empty local: adopt cloud values, attach downloads everything', async () => {
    const harness = makeHarness()
    harness.local.setValue('themeId', 'local-theme') // set before sign-in
    seedCloudDirect(harness.cloud, ['theirs'])
    harness.cloud.store.setValue('themeId', 'cloud-theme')

    const plan = decideSyncPlan({
      cloudHasRows: true,
      cloudHasValues: true,
      localHasRows: false,
    })
    await runSyncSteps((plan as { steps: SyncStep[] }).steps, harness.env)

    expect(harness.local.getRowIds('cars')).toEqual(['theirs'])
    expect(harness.local.getValue('themeId')).toBe('cloud-theme')
  })

  it('verify-seed throws (and never attaches) when the cloud counts mismatch', async () => {
    const harness = makeHarness({
      metaOverride: () => ({ isEmpty: true, rowCounts: {}, hasValues: false }),
    })
    seedLocal(harness, ['a'])
    await expect(runSyncSteps(['verify-seed', 'attach'], harness.env)).rejects.toThrow(
      SeedVerificationError,
    )
    expect(harness.callLog).not.toContain('attach')
  })
})
