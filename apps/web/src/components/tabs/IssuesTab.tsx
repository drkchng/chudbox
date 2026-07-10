import { useState } from 'react'
import type { FormEvent } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Plus, Trash2, AlertTriangle, Clock, CheckCircle2, RotateCcw, Pencil } from 'lucide-react'
import { tokens, ISSUE_SEVERITY_ORDER, ISSUE_SEVERITY_META } from '@chudbox/shared'
import useGarageStore from '../../store/useGarageStore'
import ConfirmModal from '../ConfirmModal'
import Badge from '../ui/Badge'
import Button from '../ui/Button'
import IconButton from '../ui/IconButton'
import SortControls from '../SortControls'
import ItemPhotos from '../photos/ItemPhotos'
import { dateComparator } from '../../utils/groupSort'
import type { Car, Issue, IssueStatus, StatusRole, FieldChangeEvent } from '../../types'
import type { IssuesSortBy } from '../../store/adapter'

// Status → status role + label. open = the active alert (danger, matching the
// CarCard open-issues alert), in-progress = info, resolved = success.
const STATUS: Record<IssueStatus, { label: string; role: StatusRole }> = {
  open:          { label: 'Open',        role: 'danger' },
  'in-progress': { label: 'In progress', role: 'info' },
  resolved:      { label: 'Resolved',    role: 'success' },
}

// The labeled "advance status" action for each state (replaces the old opaque
// icon-cycle): the button text says what it will do, so it's clear to keyboard
// + screen-reader users.
const ADVANCE: Record<IssueStatus, { to: IssueStatus; label: string; icon: LucideIcon }> = {
  open:          { to: 'in-progress', label: 'Start',   icon: Clock },
  'in-progress': { to: 'resolved',    label: 'Resolve', icon: CheckCircle2 },
  resolved:      { to: 'open',        label: 'Reopen',  icon: RotateCcw },
}

type IssueForm = Pick<Issue, 'title' | 'description' | 'severity'>

const emptyForm: IssueForm = { title: '', description: '', severity: 'moderate' }

const ADD_FORM_ID = 'issue-add-form'

interface IssuesTabProps {
  car: Car
}

export default function IssuesTab({ car }: IssuesTabProps) {
  const addIssue    = useGarageStore((s) => s.addIssue)
  const updateIssue = useGarageStore((s) => s.updateIssue)
  const deleteIssue = useGarageStore((s) => s.deleteIssue)
  const sortBy    = useGarageStore((s) => s.issuesSortBy)
  const sortDir   = useGarageStore((s) => s.issuesSortDir)
  const setSortBy  = useGarageStore((s) => s.setIssuesSortBy)
  const setSortDir = useGarageStore((s) => s.setIssuesSortDir)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<IssueForm>(emptyForm)
  const [editId, setEditId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<Partial<Issue>>({})
  const [filter, setFilter]         = useState<'open' | 'resolved'>('open')
  const [confirmIssue, setConfirmIssue] = useState<Issue | null>(null)
  // A12: status changes are announced politely to assistive tech.
  const [liveMsg, setLiveMsg] = useState('')

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
  const saveEdit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (editId) updateIssue(car.id, editId, editForm)
    setEditId(null)
  }

  const advanceStatus = (issue: Issue) => {
    const nextStatus = ADVANCE[issue.status].to
    updateIssue(car.id, issue.id, { status: nextStatus, resolvedAt: nextStatus === 'resolved' ? new Date().toISOString() : null })
    setLiveMsg(`"${issue.title}" marked ${STATUS[nextStatus].label.toLowerCase()}`)
  }

  const open = car.issues.filter((i) => i.status !== 'resolved')
  const resolved = car.issues.filter((i) => i.status === 'resolved')
  const filtered = filter === 'resolved' ? resolved : open
  const byCreatedAt = dateComparator((i: Issue) => i.createdAt, sortDir)
  const byCreatedAtDesc = dateComparator((i: Issue) => i.createdAt, 'desc')
  const dirSign = sortDir === 'asc' ? 1 : -1
  const displayed = [...filtered].sort((a, b) => {
    if (sortBy === 'severity') {
      const diff = ISSUE_SEVERITY_ORDER[a.severity] - ISSUE_SEVERITY_ORDER[b.severity]
      // Tie-break by newest first, regardless of the severity direction.
      return diff !== 0 ? dirSign * diff : byCreatedAtDesc(a, b)
    }
    return byCreatedAt(a, b)
  })

  return (
    <div>
      {/* A12: visually-hidden polite live region for status-change feedback. */}
      <p className="sr-only" role="status" aria-live="polite">{liveMsg}</p>

      <div className="flex items-center justify-between mb-5">
        <div>
          <h3 className="text-subhead font-semibold text-text-primary">Issues</h3>
          <p className="text-meta text-text-secondary mt-0.5">{open.length} open · {resolved.length} resolved</p>
        </div>
        <Button size="sm" onClick={() => setShowForm((v) => !v)}><Plus size={tokens.iconSize.sm} /> Log issue</Button>
      </div>

      {/* Filter */}
      <div className="flex gap-2 mb-4">
        <button type="button" onClick={() => setFilter('open')} className={`tab-btn ${filter === 'open' ? 'tab-active' : 'tab-inactive'}`}>Open ({open.length})</button>
        <button type="button" onClick={() => setFilter('resolved')} className={`tab-btn ${filter === 'resolved' ? 'tab-active' : 'tab-inactive'}`}>Resolved ({resolved.length})</button>
      </div>

      {filtered.length > 0 && (
        <SortControls<IssuesSortBy>
          sortBy={sortBy}
          sortByOptions={[
            { value: 'date', label: 'Date' },
            { value: 'severity', label: 'Severity' },
          ]}
          onSortByChange={setSortBy}
          dir={sortDir}
          dirLabels={sortBy === 'severity' ? { desc: 'Most severe first', asc: 'Least severe first' } : { desc: 'Newest first', asc: 'Oldest first' }}
          onDirChange={setSortDir}
        />
      )}

      {showForm && (
        <form id={ADD_FORM_ID} onSubmit={handleAdd} className="card mb-5 space-y-3">
          <h4 className="text-body font-semibold text-text-primary">New issue</h4>
          <div>
            <label htmlFor="issue-add-title" className="label">Title *</label>
            <input id="issue-add-title" className="input" placeholder="Check engine light on" value={form.title} onChange={set('title')} required />
          </div>
          <div>
            <label htmlFor="issue-add-desc" className="label">Description</label>
            <textarea id="issue-add-desc" className="input resize-none" rows={3} value={form.description} onChange={set('description')} placeholder="Describe the issue in detail…" />
          </div>
          <div className="w-40">
            <label htmlFor="issue-add-severity" className="label">Severity</label>
            <select id="issue-add-severity" className="input" value={form.severity} onChange={set('severity')}>
              <option value="minor">Minor</option>
              <option value="moderate">Moderate</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button type="submit" size="sm" form={ADD_FORM_ID}>Log issue</Button>
          </div>
        </form>
      )}

      {displayed.length === 0 ? (
        <div className="text-center py-16 text-text-secondary">
          <AlertTriangle size={tokens.iconSize.xl} className="mx-auto mb-3 opacity-40" aria-hidden />
          <p>{filter === 'resolved' ? 'No resolved issues.' : 'No open issues — all clear!'}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {displayed.map((issue) => {
            const advance = ADVANCE[issue.status]
            const AdvanceIcon = advance.icon
            return editId === issue.id ? (
              <form key={issue.id} onSubmit={saveEdit} className="card space-y-3">
                <div>
                  <label htmlFor={`issue-${issue.id}-title`} className="label">Title</label>
                  <input id={`issue-${issue.id}-title`} className="input" value={editForm.title ?? ''} onChange={setEdit('title')} />
                </div>
                <div>
                  <label htmlFor={`issue-${issue.id}-desc`} className="label">Description</label>
                  <textarea id={`issue-${issue.id}-desc`} className="input resize-none" rows={3} value={editForm.description ?? ''} onChange={setEdit('description')} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor={`issue-${issue.id}-severity`} className="label">Severity</label>
                    <select id={`issue-${issue.id}-severity`} className="input" value={editForm.severity} onChange={setEdit('severity')}>
                      <option value="minor">Minor</option>
                      <option value="moderate">Moderate</option>
                      <option value="high">High</option>
                      <option value="critical">Critical</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor={`issue-${issue.id}-status`} className="label">Status</label>
                    <select id={`issue-${issue.id}-status`} className="input" value={editForm.status} onChange={setEdit('status')}>
                      <option value="open">Open</option>
                      <option value="in-progress">In Progress</option>
                      <option value="resolved">Resolved</option>
                    </select>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button type="button" variant="secondary" size="sm" onClick={() => setEditId(null)}>Cancel</Button>
                  <Button type="submit" size="sm">Save</Button>
                </div>
              </form>
            ) : (
              <div key={issue.id} className="card flex gap-4 items-start">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`font-medium ${issue.status === 'resolved' ? 'text-text-secondary line-through' : 'text-text-primary'}`}>{issue.title}</span>
                    <Badge status={ISSUE_SEVERITY_META[issue.severity].role}>{ISSUE_SEVERITY_META[issue.severity].label}</Badge>
                    <Badge status={STATUS[issue.status].role}>{STATUS[issue.status].label}</Badge>
                  </div>
                  {issue.description && <p className="text-meta text-text-secondary mt-1">{issue.description}</p>}
                  <p className="text-meta text-text-secondary mt-1">{new Date(issue.createdAt).toLocaleDateString()}{issue.resolvedAt ? ` · Resolved ${new Date(issue.resolvedAt).toLocaleDateString()}` : ''}</p>
                  <ItemPhotos carId={car.id} source="issue" itemId={issue.id} photos={car.photos} itemLabel={issue.title || 'this issue'} />
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <IconButton
                    aria-label={`Mark issue "${issue.title}" as ${STATUS[advance.to].label.toLowerCase()}`}
                    title={`Mark as ${STATUS[advance.to].label.toLowerCase()}`}
                    onClick={() => advanceStatus(issue)}
                  >
                    <AdvanceIcon size={tokens.iconSize.sm} />
                  </IconButton>
                  <IconButton aria-label={`Edit issue: ${issue.title}`} onClick={() => startEdit(issue)}>
                    <Pencil size={tokens.iconSize.sm} />
                  </IconButton>
                  <IconButton aria-label={`Delete issue: ${issue.title}`} onClick={() => setConfirmIssue(issue)}>
                    <Trash2 size={tokens.iconSize.sm} />
                  </IconButton>
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
