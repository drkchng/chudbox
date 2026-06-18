import { useEffect } from 'react'
import { authClient } from '../auth/client'
import { photoSync, syncController, useSyncStatus } from '../store/useGarageStore'
import SyncMergeModal from './SyncMergeModal'

/**
 * Mounted once at the App level. Probes the session (M2: sync must know on
 * boot whether an account is present — a failed/absent probe just leaves the
 * controller idle, so the logged-out app is unchanged) and drives the sync
 * controller: session present → negotiate + attach; signed out → detach,
 * keeping all local data. Renders the merge-choice modal when sign-in finds
 * data on both sides.
 */
export default function SyncGate() {
  const { data: session } = authClient.useSession()
  const status = useSyncStatus()
  const userId = session?.user.id

  useEffect(() => {
    photoSync.setUser(userId ?? null)
    if (userId) syncController.start(userId)
    else syncController.stop()
  }, [userId])

  // Post-sign-in base64 → R2 backlog sweep. Runs once sync has attached
  // ('syncing'); photos are not part of the #268 path, so after-attach is fine.
  // Idempotent + sentinel-gated, so re-running on status changes is cheap.
  useEffect(() => {
    if (userId && status === 'syncing') void photoSync.migrate()
  }, [userId, status])

  return status === 'awaiting-choice' ? <SyncMergeModal /> : null
}
