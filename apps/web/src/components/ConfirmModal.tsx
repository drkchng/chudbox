import { AlertTriangle } from 'lucide-react'
import { tokens } from '@chudbox/shared'
import Modal from './ui/Modal'
import Button from './ui/Button'

interface ConfirmModalProps {
  title: string
  message?: string
  onConfirm: () => void
  onClose: () => void
  confirmLabel?: string
}

/**
 * ConfirmModal — the app-wide destructive-confirm primitive. Built on the shared
 * <Modal> (focus trap / Esc / outside-press / dialog ARIA come free) and <Button>
 * primitives. The destructive intent is carried by BOTH the danger-token warning
 * icon and the danger-variant confirm button (never colour alone) — orange stays
 * reserved for action/alert elsewhere.
 */
export default function ConfirmModal({ title, message, onConfirm, onClose, confirmLabel = 'Delete' }: ConfirmModalProps) {
  const handleConfirm = () => { onConfirm(); onClose() }

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="danger" onClick={handleConfirm}>{confirmLabel}</Button>
        </>
      }
    >
      {message && (
        <div className="flex items-start gap-3">
          <AlertTriangle size={tokens.iconSize.lg} aria-hidden className="mt-0.5 shrink-0 text-danger-fg" />
          <p className="text-body text-text-secondary">{message}</p>
        </div>
      )}
    </Modal>
  )
}
