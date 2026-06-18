import { useState } from 'react'
import { Bookmark, BookmarkCheck } from 'lucide-react'
import { buildShareCard, toCuratedSnapshot, tokens } from '@chudbox/shared'
import type {
  FullCarSnapshot,
  ListingCarSnapshot,
  PublicCarSnapshot,
  ShareScope,
} from '@chudbox/shared'
import { savedBuildsController, useSavedBuild } from '../../store/useGarageStore'
import Button from '../ui/Button'

/**
 * DEC-11 "Save / Watch this build" toggle for the public share viewer. Works for
 * a LOGGED-OUT visitor (it writes only to the local-first TinyBase stores; the
 * `savedBuilds` row syncs later if/when an account exists).
 *
 * On save it persists the follow row PLUS a CURATED card + snapshot derived from
 * whatever the page is showing: `toCuratedSnapshot` narrows a listing/full body
 * back to curated FIRST (deny-by-default), so the follower never caches another
 * owner's money / VIN / notes (§12.7). The token in the route is a bearer
 * credential — stored, never logged.
 */
interface SaveBuildButtonProps {
  token: string
  car: PublicCarSnapshot | ListingCarSnapshot | FullCarSnapshot
  /** The link's stored scope — the informational badge cached on the row. */
  scope: ShareScope
}

export default function SaveBuildButton({ token, car, scope }: SaveBuildButtonProps) {
  const saved = useSavedBuild(token)
  const isSaved = saved != null
  const [busy, setBusy] = useState(false)

  const onToggle = async () => {
    if (busy) return
    setBusy(true)
    try {
      if (isSaved) {
        await savedBuildsController.unsaveBuild(token)
      } else {
        // Narrow to curated FIRST (leak-safe), then derive the card + cache the
        // curated snapshot for the offline Watching detail (§12.3).
        const curated = toCuratedSnapshot(car)
        const card = buildShareCard(curated, scope)
        await savedBuildsController.saveBuild(token, { card, snapshot: curated })
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button
      variant={isSaved ? 'secondary' : 'primary'}
      size="sm"
      loading={busy}
      onClick={onToggle}
      aria-pressed={isSaved}
    >
      {isSaved ? (
        <>
          <BookmarkCheck size={tokens.iconSize.sm} aria-hidden /> Watching
        </>
      ) : (
        <>
          <Bookmark size={tokens.iconSize.sm} aria-hidden /> Save / Watch this build
        </>
      )}
    </Button>
  )
}
