import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { Plus, Trash2, Wrench, Pencil, Check, X, ExternalLink, ClipboardList } from 'lucide-react'
import { tokens } from '@chudbox/shared'
import useGarageStore from '../../store/useGarageStore'
import { CURRENCIES, DISTANCE_UNITS, formatMoney } from '../../utils/units'
import DateInput from '../DateInput'
import ConfirmModal from '../ConfirmModal'
import Modal from '../ui/Modal'
import Button from '../ui/Button'
import IconButton from '../ui/IconButton'
import SortControls from '../SortControls'
import { CATEGORIES } from '../../utils/categories'
import { isSafeHref } from '../../utils/safeLink'
import { groupSort } from '../../utils/groupSort'
import ItemPhotos from '../photos/ItemPhotos'
import type { Car, Mod, FieldChangeEvent } from '../../types'
import type { ItemSortBy } from '../../store/adapter'

interface ModForm {
  name: string
  category: string
  description: string
  cost: string
  installedDate: string
  shop: string
  link: string
}

const emptyForm: ModForm = { name: '', category: '', description: '', cost: '', installedDate: '', shop: '', link: '' }

const today = (): string => new Date().toISOString().slice(0, 10)

const fmtDate = (iso: string): string => new Date(iso + 'T12:00:00').toLocaleDateString()

interface LogMaintenanceForm {
  service: string
  date: string
  mileage: string
  cost: string
  shop: string
  notes: string
  nextDueDate: string
  nextDueMileage: string
}

interface LogToMaintenanceModalProps {
  mod: Mod
  carId: string
  onClose: () => void
}

const LOG_FORM_ID = 'log-to-maintenance-form'

// Defined outside ModsTab so React never unmounts it on re-render
function LogToMaintenanceModal({ mod, carId, onClose }: LogToMaintenanceModalProps) {
  const addMaintenance = useGarageStore((s) => s.addMaintenance)
  const currency = useGarageStore((s) => s.currency)
  const sym      = CURRENCIES[currency]?.symbol ?? '$'
  const distanceUnit = useGarageStore((s) => s.distanceUnit)
  const distShort = DISTANCE_UNITS[distanceUnit]?.short ?? 'mi'
  const [form, setForm] = useState<LogMaintenanceForm>({
    service:        mod.name        || '',
    date:           today(),
    mileage:        '',
    cost:           mod.cost != null ? String(mod.cost) : '',
    shop:           mod.shop        || '',
    notes:          mod.description || '',
    nextDueDate:    '',
    nextDueMileage: '',
  })

  const set =
    <K extends keyof LogMaintenanceForm>(key: K) =>
    (eOrVal: string | FieldChangeEvent): void =>
      setForm((f) => ({ ...f, [key]: typeof eOrVal === 'string' ? eOrVal : eOrVal.target.value }))

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    addMaintenance(carId, { ...form, cost: form.cost ? parseFloat(form.cost) : null, mileage: form.mileage || null })
    onClose()
  }

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title="Log to maintenance"
      description="Creates a maintenance record for this mod"
      size="md"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
          <Button type="submit" form={LOG_FORM_ID} size="sm">
            <ClipboardList size={tokens.iconSize.sm} /> Add to maintenance
          </Button>
        </>
      }
    >
      <form id={LOG_FORM_ID} onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label htmlFor="log-service" className="label">Service</label>
          <input id="log-service" className="input" value={form.service} onChange={set('service')} placeholder="e.g. Oil Filter Replacement" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div role="group" aria-labelledby="log-date-label">
            <span id="log-date-label" className="label">Date</span>
            <DateInput value={form.date} onChange={set('date')} />
          </div>
          <div>
            <label htmlFor="log-mileage" className="label">Mileage ({distShort})</label>
            <input id="log-mileage" className="input" type="number" placeholder="45000" value={form.mileage} onChange={set('mileage')} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="log-cost" className="label">Cost ({sym})</label>
            <input id="log-cost" className="input" type="number" step="0.01" value={form.cost} onChange={set('cost')} />
          </div>
          <div>
            <label htmlFor="log-shop" className="label">Shop / Installer</label>
            <input id="log-shop" className="input" value={form.shop} onChange={set('shop')} placeholder="Self / Shop name" />
          </div>
        </div>
        <div>
          <label htmlFor="log-notes" className="label">Notes</label>
          <textarea id="log-notes" className="input resize-none" rows={2} value={form.notes} onChange={set('notes')} />
        </div>
        <div className="border-t border-border pt-3">
          <p className="text-meta text-text-secondary mb-2">Next service due (optional)</p>
          <div className="grid grid-cols-2 gap-3">
            <div role="group" aria-labelledby="log-nextdate-label">
              <span id="log-nextdate-label" className="label">Next due date</span>
              <DateInput value={form.nextDueDate} onChange={set('nextDueDate')} />
            </div>
            <div>
              <label htmlFor="log-nextmileage" className="label">Next due mileage ({distShort})</label>
              <input id="log-nextmileage" className="input" type="number" placeholder="50000" value={form.nextDueMileage} onChange={set('nextDueMileage')} />
            </div>
          </div>
        </div>
      </form>
    </Modal>
  )
}

interface LinkFieldProps {
  id: string
  value: string
  onChange: (eOrVal: string | FieldChangeEvent) => void
}

function LinkField({ id, value, onChange }: LinkFieldProps) {
  return (
    <div>
      <label htmlFor={id} className="label">Link (optional)</label>
      <input id={id} className="input" type="url" placeholder="https://…" value={value} onChange={onChange} />
    </div>
  )
}

interface ModsTabProps {
  car: Car
  /** DEC-4 (U1) log-first: open the add-mod form and focus its first field on
   *  mount — set when the user just created this car and landed here. */
  autoFocusAdd?: boolean
}

export default function ModsTab({ car, autoFocusAdd = false }: ModsTabProps) {
  const addMod    = useGarageStore((s) => s.addMod)
  const updateMod = useGarageStore((s) => s.updateMod)
  const deleteMod = useGarageStore((s) => s.deleteMod)
  const currency  = useGarageStore((s) => s.currency)
  const sym       = CURRENCIES[currency]?.symbol ?? '$'
  const sortBy    = useGarageStore((s) => s.modsSortBy)
  const sortDir   = useGarageStore((s) => s.modsSortDir)
  const setSortBy  = useGarageStore((s) => s.setModsSortBy)
  const setSortDir = useGarageStore((s) => s.setModsSortDir)
  const [showForm, setShowForm]   = useState(autoFocusAdd)
  const [form, setForm]           = useState<ModForm>(emptyForm)
  const [editId, setEditId]       = useState<string | null>(null)
  const [editForm, setEditForm]   = useState<ModForm>(emptyForm)
  const [logMod, setLogMod]       = useState<Mod | null>(null)
  const [confirmMod, setConfirmMod] = useState<Mod | null>(null)

  const set =
    <K extends keyof ModForm>(key: K) =>
    (eOrVal: string | FieldChangeEvent): void =>
      setForm((f) => ({ ...f, [key]: typeof eOrVal === 'string' ? eOrVal : eOrVal.target.value }))
  const setEdit =
    <K extends keyof ModForm>(key: K) =>
    (eOrVal: string | FieldChangeEvent): void =>
      setEditForm((f) => ({ ...f, [key]: typeof eOrVal === 'string' ? eOrVal : eOrVal.target.value }))

  const handleAdd = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!form.name) return
    addMod(car.id, { ...form, cost: form.cost ? parseFloat(form.cost) : null })
    setForm(emptyForm)
    setShowForm(false)
  }

  const startEdit = (mod: Mod) => {
    setEditId(mod.id)
    setEditForm({
      name: mod.name,
      category: mod.category,
      description: mod.description,
      cost: mod.cost != null ? String(mod.cost) : '',
      installedDate: mod.installedDate,
      shop: mod.shop,
      link: mod.link,
    })
  }
  const saveEdit = () => {
    if (!editId) return
    updateMod(car.id, editId, { ...editForm, cost: editForm.cost ? parseFloat(editForm.cost) : null })
    setEditId(null)
  }

  const totalCost = car.mods.reduce((s, m) => s + (m.cost || 0), 0)
  const groups = useMemo(
    () => groupSort(car.mods, (m) => m.category, (m) => m.installedDate, sortBy, sortDir),
    [car.mods, sortBy, sortDir],
  )

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-5">
        <div className="min-w-0">
          <h3 className="text-subhead font-semibold text-text-primary">Modifications</h3>
          {car.mods.length > 0 && (
            <p className="mt-0.5 text-meta text-text-secondary">
              {car.mods.length} mods · Total invested:{' '}
              <span className="text-text-primary font-semibold">{formatMoney(totalCost, currency)}</span>
            </p>
          )}
        </div>
        <Button size="sm" onClick={() => setShowForm((v) => !v)}>
          <Plus size={tokens.iconSize.sm} /> Add Mod
        </Button>
      </div>

      {showForm && (
        <form onSubmit={handleAdd} className="card mb-5 space-y-3 border-accent/30">
          <h4 className="text-body font-semibold text-text-primary">New modification</h4>
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="mod-add-name" className="label">Name *</label>
              {/* autoFocus fires on mount — the log-first focus target (U1). */}
              <input id="mod-add-name" className="input" placeholder="Coilover Kit" value={form.name} onChange={set('name')} required autoFocus={autoFocusAdd} />
            </div>
            <div>
              <label htmlFor="mod-add-category" className="label">Category</label>
              <select id="mod-add-category" className="input" value={form.category} onChange={set('category')}>
                <option value="">Select…</option>
                {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label htmlFor="mod-add-description" className="label">Description</label>
            <textarea id="mod-add-description" className="input resize-none" rows={2} value={form.description} onChange={set('description')} placeholder="Details about the mod…" />
          </div>
          <LinkField id="mod-add-link" value={form.link} onChange={set('link')} />
          <div className="grid sm:grid-cols-3 gap-3">
            <div>
              <label htmlFor="mod-add-cost" className="label">Cost ({sym})</label>
              <input id="mod-add-cost" className="input" type="number" step="0.01" placeholder="0.00" value={form.cost} onChange={set('cost')} />
            </div>
            <div role="group" aria-labelledby="mod-add-date-label">
              <span id="mod-add-date-label" className="label">Date installed</span>
              <DateInput value={form.installedDate} onChange={set('installedDate')} />
            </div>
            <div>
              <label htmlFor="mod-add-shop" className="label">Shop / Installer</label>
              <input id="mod-add-shop" className="input" placeholder="Self / Shop name" value={form.shop} onChange={set('shop')} />
            </div>
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button type="submit" size="sm">Add Mod</Button>
          </div>
        </form>
      )}

      {car.mods.length === 0 ? (
        <div className="text-center py-16">
          <Wrench size={tokens.iconSize.xl} className="mx-auto mb-3 text-text-disabled" />
          <p className="text-text-secondary">No modifications logged yet.</p>
        </div>
      ) : (
        <>
          <SortControls<ItemSortBy>
            sortBy={sortBy}
            sortByOptions={[
              { value: 'category', label: 'Category' },
              { value: 'date', label: 'Install date' },
            ]}
            onSortByChange={setSortBy}
            dir={sortDir}
            dirLabels={{ desc: 'Newest first', asc: 'Oldest first' }}
            onDirChange={setSortDir}
          />
          <div className="space-y-6">
          {groups.map(({ key, label, items: mods }) => (
            <div key={key}>
              <h4 className="mb-2 text-meta font-semibold uppercase tracking-widest text-text-tertiary">{label}</h4>
              <div className="space-y-2">
                {mods.map((mod) => editId === mod.id ? (
                  <div key={mod.id} className="card border-accent/30 space-y-3">
                    <div className="grid sm:grid-cols-2 gap-3">
                      <div>
                        <label htmlFor="mod-edit-name" className="label">Name</label>
                        <input id="mod-edit-name" className="input" value={editForm.name} onChange={setEdit('name')} />
                      </div>
                      <div>
                        <label htmlFor="mod-edit-category" className="label">Category</label>
                        <select id="mod-edit-category" className="input" value={editForm.category} onChange={setEdit('category')}>
                          <option value="">Select…</option>
                          {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                        </select>
                      </div>
                    </div>
                    <div>
                      <label htmlFor="mod-edit-description" className="label">Description</label>
                      <textarea id="mod-edit-description" className="input resize-none" rows={2} value={editForm.description} onChange={setEdit('description')} />
                    </div>
                    <LinkField id="mod-edit-link" value={editForm.link} onChange={setEdit('link')} />
                    <div className="grid sm:grid-cols-3 gap-3">
                      <div>
                        <label htmlFor="mod-edit-cost" className="label">Cost ({sym})</label>
                        <input id="mod-edit-cost" className="input" type="number" step="0.01" value={editForm.cost} onChange={setEdit('cost')} />
                      </div>
                      <div role="group" aria-labelledby="mod-edit-date-label">
                        <span id="mod-edit-date-label" className="label">Date installed</span>
                        <DateInput value={editForm.installedDate} onChange={setEdit('installedDate')} />
                      </div>
                      <div>
                        <label htmlFor="mod-edit-shop" className="label">Shop</label>
                        <input id="mod-edit-shop" className="input" value={editForm.shop} onChange={setEdit('shop')} />
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="secondary" size="sm" onClick={() => setEditId(null)}>
                        <X size={tokens.iconSize.sm} /> Cancel
                      </Button>
                      <Button size="sm" onClick={saveEdit}>
                        <Check size={tokens.iconSize.sm} /> Save
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div key={mod.id} className="card-row flex gap-4 items-start">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-text-primary">{mod.name}</span>
                        {/* V5: price = data → text-primary weight, not orange. */}
                        {mod.cost ? (
                          <span className="text-meta font-semibold text-text-primary">{formatMoney(Number(mod.cost), currency)}</span>
                        ) : null}
                      </div>
                      {mod.description && <p className="mt-1 text-meta text-text-secondary">{mod.description}</p>}
                      <div className="mt-1.5 flex flex-wrap items-center gap-3 text-meta text-text-secondary">
                        {mod.installedDate && <span>{fmtDate(mod.installedDate)}</span>}
                        {mod.shop && <span>by {mod.shop}</span>}
                        {mod.link && isSafeHref(mod.link) && (
                          <a
                            href={mod.link}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 underline decoration-border underline-offset-2 transition-colors hover:text-accent focus-visible:text-accent rounded-sm"
                          >
                            <ExternalLink size={tokens.iconSize.xs} /> View link
                          </a>
                        )}
                      </div>
                      <ItemPhotos carId={car.id} source="mod" itemId={mod.id} photos={car.photos} itemLabel={mod.name || 'this mod'} />
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <IconButton aria-label={`Log "${mod.name}" to maintenance`} title="Log to maintenance" onClick={() => setLogMod(mod)}>
                        <ClipboardList size={tokens.iconSize.sm} />
                      </IconButton>
                      <IconButton aria-label={`Edit "${mod.name}"`} title="Edit" onClick={() => startEdit(mod)}>
                        <Pencil size={tokens.iconSize.sm} />
                      </IconButton>
                      <IconButton aria-label={`Delete "${mod.name}"`} title="Delete" onClick={() => setConfirmMod(mod)}>
                        <Trash2 size={tokens.iconSize.sm} />
                      </IconButton>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
          </div>
        </>
      )}

      {confirmMod && (
        <ConfirmModal
          title="Delete mod?"
          message={`"${confirmMod.name}" will be permanently deleted from your mods list.`}
          onConfirm={() => deleteMod(car.id, confirmMod.id)}
          onClose={() => setConfirmMod(null)}
        />
      )}

      {logMod && (
        <LogToMaintenanceModal
          mod={logMod}
          carId={car.id}
          onClose={() => setLogMod(null)}
        />
      )}
    </div>
  )
}
