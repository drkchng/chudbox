import { Download, GitMerge, Upload } from 'lucide-react'
import { tokens } from '@chudbox/shared'
import { syncController } from '../store/useGarageStore'
import Modal from './ui/Modal'
import type { MergeChoice } from '../store/sync'

interface ChoiceDef {
  choice: MergeChoice
  label: string
  description: string
  icon: typeof GitMerge
  primary?: boolean
}

const CHOICES: ChoiceDef[] = [
  {
    choice: 'merge',
    label: 'Merge both',
    description:
      'Combine the cloud garage with this device. Cars added separately in both places are all kept — the same car added twice may appear as a duplicate.',
    icon: GitMerge,
    primary: true,
  },
  {
    choice: 'keep-cloud',
    label: 'Keep cloud',
    description: "Replace this device's garage with the cloud copy. Local-only cars are lost.",
    icon: Download,
  },
  {
    choice: 'keep-local',
    label: 'Keep this device',
    description: "Replace the cloud garage with this device's copy. Cloud-only cars are lost.",
    icon: Upload,
  },
]

/**
 * Shown when sign-in finds car data BOTH locally and in the cloud (plan:
 * never blind-merge — a CRDT cannot un-merge). The chosen resolution runs
 * fully BEFORE the synchronizer attaches.
 *
 * This is a FORCED choice: there is no cancel/dismiss path (no close button,
 * and Esc / outside-press are ignored via the no-op onOpenChange) — the user
 * must pick one resolution before sync can start.
 */
export default function SyncMergeModal() {
  return (
    <Modal
      open
      onOpenChange={() => {}}
      hideCloseButton
      title="Two garages found"
      description="This device and your cloud account both contain cars. Choose how to combine them before sync starts — this cannot be undone."
      size="md"
    >
      <div className="space-y-2" role="group" aria-label="Resolve the two garages">
        {CHOICES.map(({ choice, label, description, icon: Icon, primary }) => (
          <button
            key={choice}
            type="button"
            onClick={() => syncController.choose(choice)}
            className={`flex w-full items-start gap-3 rounded-lg border px-4 py-3 text-left outline-hidden transition-[border-color,background-color] focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface ${
              primary
                ? 'border-accent/60 bg-accent/10 hover:bg-accent/20'
                : 'border-border hover:border-accent/30 hover:bg-surface-2'
            }`}
          >
            <Icon
              size={tokens.iconSize.sm}
              aria-hidden
              className={`mt-0.5 shrink-0 ${primary ? 'text-accent' : 'text-text-tertiary'}`}
            />
            <span>
              <span className="block text-body font-medium text-text-primary">
                {label}
                {primary && <span className="font-normal text-accent"> (recommended)</span>}
              </span>
              <span className="mt-0.5 block text-meta leading-relaxed text-text-secondary">{description}</span>
            </span>
          </button>
        ))}
      </div>
    </Modal>
  )
}
