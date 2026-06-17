import { useState } from 'react'
import type { FormEvent } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Plus, Trash2, AlertTriangle, CheckCircle2, Clock, Pencil, Check, X } from 'lucide-react'
import useGarageStore from '../../store/useGarageStore'
import ConfirmModal from '../ConfirmModal'
import type { Car, Issue, IssueSeverity, IssueStatus, FieldChangeEvent } from '../../types'

const SEVERITY: Record<IssueSeverity, { label: string; class: string }> = {
  minor:    { label: 'Minor',    class: 'bg-gray-800 text-gray-300 border-gray-700' },
  moderate: { label: 'Moderate', class: 'bg-yellow-900/50 text-yellow-300 border-yellow-700/40' },
  critical: { label: 'Critical', class: 'bg-red-900/50 text-red-300 border-red-700/40' },
}

const STATUS_ICON: Record<IssueStatus, { icon: LucideIcon; class: string }> = {
  open:          { icon: AlertTriangle, class: 'text-red-400' },
  'in-progress': { icon: Clock,         class: 'text-yellow-400' },
  resolved:      { icon: CheckCircle2,  class: 'text-green-400' },
}

type IssueForm = Pick<Issue, 'title' | 'description' | 'severity'>

const emptyForm: IssueForm = { title: '', description: '', severity: 'moderate' }

interface IssuesTabProps {
  car: Car
}

export default function IssuesTab({ car }: IssuesTabProps) {
  const addIssue    = useGarageStore((s) => s.addIssue)
  const updateIssue = useGarageStore((s) => s.updateIssue)
  const deleteIssue = useGarageStore((s) => s.deleteIssue)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<IssueForm>(emptyForm)
  const [editId, setEditId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<Partial<Issue>>({})
  const [filter, setFilter]         = useState<'open' | 'resolved'>('open')
  const [confirmIssue, setConfirmIssue] = useState<Issue | null>(null)

  const set =
    <K extends keyof IssueForm>(key: K) =>
    (e: FieldChangeEvent): void =>
      setForm((f) => ({ ...f, [key]: e.target.value as IssueForm[K] }))

  const setEdit =
    <K extends keyof Issue>(key: K) =>
    (e: FieldChangeEvent): void =>
      setEditForm((f) => ({ ...f, [key]: e.target.value as Issue[K] }))

  const handleAdd = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!form.title) return
    addIssue(car.id, form)
    setForm(emptyForm)
    setShowForm(false)
  }

  const startEdit = (issue: Issue) => { setEditId(issue.id); setEditForm({ ...issue }) }
  const saveEdit = () => {
    if (editId) updateIssue(car.id, editId, editForm)
    setEditId(null)
  }

  const cycleStatus = (issue: Issue) => {
    const next: Record<IssueStatus, IssueStatus> = { open: 'in-progress', 'in-progress': 'resolved', resolved: 'open' }
    const nextStatus = next[issue.status]
    updateIssue(car.id, issue.id, { status: nextStatus, resolvedAt: nextStatus === 'resolved' ? new Date().toISOString() : null })
  }

  const open = car.issues.filter((i) => i.status !== 'resolved')
  const resolved = car.issues.filter((i) => i.status === 'resolved')
  const displayed = filter === 'resolved' ? resolved : open

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h3 className="text-white font-semibold">Issues</h3>
          <p className="text-xs text-gray-500 mt-0.5">{open.length} open · {resolved.length} resolved</p>
        </div>
        <button onClick={() => setShowForm((v) => !v)} className="btn-primary"><Plus size={14} /> Log Issue</button>
      </div>

      {/* Filter */}
      <div className="flex gap-2 mb-4">
        <button onClick={() => setFilter('open')} className={`tab-btn ${filter === 'open' ? 'tab-active' : 'tab-inactive'}`}>Open ({open.length})</button>
        <button onClick={() => setFilter('resolved')} className={`tab-btn ${filter === 'resolved' ? 'tab-active' : 'tab-inactive'}`}>Resolved ({resolved.length})</button>
      </div>

      {showForm && (
        <form onSubmit={handleAdd} className="card mb-5 space-y-3 border-red-800/40">
          <h4 className="text-sm font-semibold text-white">New Issue</h4>
          <div>
            <label className="label">Title *</label>
            <input className="input" placeholder="Check engine light on" value={form.title} onChange={set('title')} required />
          </div>
          <div>
            <label className="label">Description</label>
            <textarea className="input resize-none" rows={3} value={form.description} onChange={set('description')} placeholder="Describe the issue in detail…" />
          </div>
          <div className="w-40">
            <label className="label">Severity</label>
            <select className="input" value={form.severity} onChange={set('severity')}>
              <option value="minor">Minor</option>
              <option value="moderate">Moderate</option>
              <option value="critical">Critical</option>
            </select>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => setShowForm(false)} className="btn-outline">Cancel</button>
            <button type="submit" className="btn-primary">Log Issue</button>
          </div>
        </form>
      )}

      {displayed.length === 0 ? (
        <div className="text-center py-16 text-gray-600">
          <AlertTriangle size={36} className="mx-auto mb-3 opacity-40" />
          <p>{filter === 'resolved' ? 'No resolved issues.' : 'No open issues — all clear!'}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {displayed.map((issue) => {
            const { icon: StatusIcon, class: statusClass } = STATUS_ICON[issue.status]
            return editId === issue.id ? (
              <div key={issue.id} className="card border-accent/30 space-y-3">
                <div><label className="label">Title</label><input className="input" value={editForm.title ?? ''} onChange={setEdit('title')} /></div>
                <div><label className="label">Description</label><textarea className="input resize-none" rows={3} value={editForm.description ?? ''} onChange={setEdit('description')} /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="label">Severity</label>
                    <select className="input" value={editForm.severity} onChange={setEdit('severity')}>
                      <option value="minor">Minor</option>
                      <option value="moderate">Moderate</option>
                      <option value="critical">Critical</option>
                    </select>
                  </div>
                  <div><label className="label">Status</label>
                    <select className="input" value={editForm.status} onChange={setEdit('status')}>
                      <option value="open">Open</option>
                      <option value="in-progress">In Progress</option>
                      <option value="resolved">Resolved</option>
                    </select>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setEditId(null)} className="btn-ghost"><X size={14} /> Cancel</button>
                  <button onClick={saveEdit} className="btn-primary"><Check size={14} /> Save</button>
                </div>
              </div>
            ) : (
              <div key={issue.id} className="card flex gap-4 items-start hover:border-accent/20">
                <button onClick={() => cycleStatus(issue)} title="Cycle status" className={`mt-0.5 shrink-0 ${statusClass} hover:opacity-70 transition-opacity`}>
                  <StatusIcon size={18} />
                </button>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`font-medium ${issue.status === 'resolved' ? 'text-gray-500 line-through' : 'text-white'}`}>{issue.title}</span>
                    <span className={`badge border ${SEVERITY[issue.severity].class}`}>{SEVERITY[issue.severity].label}</span>
                    <span className="text-xs text-gray-600 capitalize">{issue.status.replace('-', ' ')}</span>
                  </div>
                  {issue.description && <p className="text-xs text-gray-400 mt-1">{issue.description}</p>}
                  <p className="text-xs text-gray-600 mt-1">{new Date(issue.createdAt).toLocaleDateString()}{issue.resolvedAt ? ` · Resolved ${new Date(issue.resolvedAt).toLocaleDateString()}` : ''}</p>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button onClick={() => startEdit(issue)} className="btn-ghost"><Pencil size={14} /></button>
                  <button onClick={() => setConfirmIssue(issue)} className="btn-ghost text-red-500 hover:text-red-400"><Trash2 size={14} /></button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {confirmIssue && (
        <ConfirmModal
          title="Delete issue?"
          message={`"${confirmIssue.title}" will be permanently deleted.`}
          onConfirm={() => deleteIssue(car.id, confirmIssue.id)}
          onClose={() => setConfirmIssue(null)}
        />
      )}
    </div>
  )
}
