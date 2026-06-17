import { useEffect } from 'react'
import { authClient } from '../auth/client'
import { syncController, useSyncStatus } from '../store/useGarageStore'
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
    if (userId) syncController.start(userId)
    else syncController.stop()
  }, [userId])

  return status === 'awaiting-choice' ? <SyncMergeModal /> : null
}
