import { AlertTriangle, Download, GitMerge, Upload } from 'lucide-react'
import { syncController } from '../store/useGarageStore'
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
 */
export default function SyncMergeModal() {
  return (
    <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80">
      <div className="modal-content bg-surface border border-border rounded-2xl w-full max-w-md shadow-2xl p-6 space-y-4">
        <div className="flex items-start gap-3">
          <AlertTriangle size={20} className="text-yellow-400 mt-0.5 shrink-0" />
          <div>
            <h3 className="font-semibold text-white">Two garages found</h3>
            <p className="text-sm text-gray-400 mt-1">
              This device and your cloud account both contain cars. Choose how to combine them
              before sync starts — this cannot be undone.
            </p>
          </div>
        </div>
        <div className="space-y-2">
          {CHOICES.map(({ choice, label, description, icon: Icon, primary }) => (
            <button
              key={choice}
              onClick={() => syncController.choose(choice)}
              className={`w-full flex items-start gap-3 px-4 py-3 rounded-xl border text-left transition-[border-color,background-color] ${
                primary
                  ? 'border-accent/60 bg-accent/10 hover:bg-accent/20'
                  : 'border-border hover:border-accent/30 hover:bg-surface-2'
              }`}
            >
              <Icon size={16} className={`mt-0.5 shrink-0 ${primary ? 'text-accent' : 'text-gray-400'}`} />
              <span>
                <span className={`block text-sm font-medium ${primary ? 'text-accent' : 'text-gray-200'}`}>
                  {label}
                  {primary ? ' (recommended)' : ''}
                </span>
                <span className="block text-xs text-gray-500 mt-0.5 leading-relaxed">{description}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
