import { AlertTriangle } from 'lucide-react'

export default function ConfirmModal({ title, message, onConfirm, onClose, confirmLabel = 'Delete' }) {
  const handleConfirm = () => { onConfirm(); onClose() }

  return (
    <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="modal-content bg-surface border border-border rounded-2xl w-full max-w-sm shadow-2xl p-6 space-y-4">
        <div className="flex items-start gap-3">
          <AlertTriangle size={20} className="text-red-400 mt-0.5 shrink-0" />
          <div>
            <h3 className="font-semibold text-white">{title}</h3>
            {message && <p className="text-sm text-gray-400 mt-1">{message}</p>}
          </div>
        </div>
        <div className="flex gap-3">
          <button onClick={onClose} className="btn-outline flex-1 justify-center">Cancel</button>
          <button onClick={handleConfirm} className="btn-danger flex-1 justify-center">
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
