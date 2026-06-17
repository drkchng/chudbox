import { useState } from 'react'
import type { FormEvent } from 'react'
import { Plus, Trash2, Wrench, Pencil, Check, X, ExternalLink, ClipboardList } from 'lucide-react'
import useGarageStore from '../../store/useGarageStore'
import { CURRENCIES } from '../../utils/units'
import DateInput from '../DateInput'
import ConfirmModal from '../ConfirmModal'
import { CATEGORIES } from '../../utils/categories'
import type { Car, Mod, FieldChangeEvent } from '../../types'

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

// Defined outside ModsTab so React never unmounts it on re-render
function LogToMaintenanceModal({ mod, carId, onClose }: LogToMaintenanceModalProps) {
  const addMaintenance = useGarageStore((s) => s.addMaintenance)
  const currency = useGarageStore((s) => s.currency)
  const sym      = CURRENCIES[currency]?.symbol ?? '$'
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

  const handleConfirm = () => {
    addMaintenance(carId, { ...form, cost: form.cost ? parseFloat(form.cost) : null, mileage: form.mileage || null })
    onClose()
  }

  return (
    <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80">
      <div className="modal-content bg-surface border border-border rounded-2xl w-full max-w-md shadow-2xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div>
            <h2 className="text-base font-semibold text-white">Log to Maintenance</h2>
            <p className="text-xs text-gray-500 mt-0.5">Creates a maintenance record for this mod</p>
          </div>
          <button onClick={onClose} className="btn-ghost"><X size={18} /></button>
        </div>

        <div className="overflow-y-auto px-5 py-4 space-y-3">
          <div>
            <label className="label">Service</label>
            <input className="input" value={form.service} onChange={set('service')} placeholder="e.g. Oil Filter Replacement" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Date</label>
              <DateInput value={form.date} onChange={set('date')} />
            </div>
            <div>
              <label className="label">Mileage</label>
              <input className="input" type="number" placeholder="45000" value={form.mileage} onChange={set('mileage')} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Cost ({sym})</label>
              <input className="input" type="number" step="0.01" value={form.cost} onChange={set('cost')} />
            </div>
            <div>
              <label className="label">Shop / Installer</label>
              <input className="input" value={form.shop} onChange={set('shop')} placeholder="Self / Shop name" />
            </div>
          </div>
          <div>
            <label className="label">Notes</label>
            <textarea className="input resize-none" rows={2} value={form.notes} onChange={set('notes')} />
          </div>
          <div className="border-t border-border pt-3">
            <p className="text-xs text-gray-500 mb-2">Next service due (optional)</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Next Due Date</label>
                <DateInput value={form.nextDueDate} onChange={set('nextDueDate')} />
              </div>
              <div>
                <label className="label">Next Due Mileage</label>
                <input className="input" type="number" placeholder="50000" value={form.nextDueMileage} onChange={set('nextDueMileage')} />
              </div>
            </div>
          </div>
        </div>

        <div className="flex gap-3 px-5 py-4 border-t border-border shrink-0">
          <button onClick={onClose} className="btn-outline flex-1 justify-center">Cancel</button>
          <button onClick={handleConfirm} className="btn-primary flex-1 justify-center">
            <ClipboardList size={14} /> Add to Maintenance
          </button>
        </div>
      </div>
    </div>
  )
}

interface LinkFieldProps {
  value: string
  onChange: (eOrVal: string | FieldChangeEvent) => void
}

function LinkField({ value, onChange }: LinkFieldProps) {
  return (
    <div>
      <label className="label">Link (optional)</label>
      <input className="input" type="url" placeholder="https://…" value={value} onChange={onChange} />
    </div>
  )
}

interface ModsTabProps {
  car: Car
}

export default function ModsTab({ car }: ModsTabProps) {
  const addMod    = useGarageStore((s) => s.addMod)
  const updateMod = useGarageStore((s) => s.updateMod)
  const deleteMod = useGarageStore((s) => s.deleteMod)
  const currency  = useGarageStore((s) => s.currency)
  const sym       = CURRENCIES[currency]?.symbol ?? '$'
  const [showForm, setShowForm]   = useState(false)
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
  const grouped   = car.mods.reduce<Record<string, Mod[]>>((acc, mod) => {
    const key = mod.category || 'Other'
    if (!acc[key]) acc[key] = []
    acc[key].push(mod)
    return acc
  }, {})

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h3 className="text-white font-semibold">Modifications</h3>
          {car.mods.length > 0 && (
            <p className="text-xs text-gray-500 mt-0.5">{car.mods.length} mods · Total invested: {sym}{totalCost.toFixed(2)}</p>
          )}
        </div>
        <button onClick={() => setShowForm((v) => !v)} className="btn-primary"><Plus size={14} /> Add Mod</button>
      </div>

      {showForm && (
        <form onSubmit={handleAdd} className="card mb-5 space-y-3 border-accent/30">
          <h4 className="text-sm font-semibold text-white">New Modification</h4>
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="label">Name *</label>
              <input className="input" placeholder="Coilover Kit" value={form.name} onChange={set('name')} required />
            </div>
            <div>
              <label className="label">Category</label>
              <select className="input" value={form.category} onChange={set('category')}>
                <option value="">Select…</option>
                {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="label">Description</label>
            <textarea className="input resize-none" rows={2} value={form.description} onChange={set('description')} placeholder="Details about the mod…" />
          </div>
          <LinkField value={form.link} onChange={set('link')} />
          <div className="grid sm:grid-cols-3 gap-3">
            <div>
              <label className="label">Cost ({sym})</label>
              <input className="input" type="number" step="0.01" placeholder="0.00" value={form.cost} onChange={set('cost')} />
            </div>
            <div>
              <label className="label">Date Installed</label>
              <DateInput value={form.installedDate} onChange={set('installedDate')} />
            </div>
            <div>
              <label className="label">Shop / Installer</label>
              <input className="input" placeholder="Self / Shop name" value={form.shop} onChange={set('shop')} />
            </div>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => setShowForm(false)} className="btn-outline">Cancel</button>
            <button type="submit" className="btn-primary">Add Mod</button>
          </div>
        </form>
      )}

      {car.mods.length === 0 ? (
        <div className="text-center py-16 text-gray-600">
          <Wrench size={36} className="mx-auto mb-3 opacity-40" />
          <p>No modifications logged yet.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(grouped).map(([category, mods]) => (
            <div key={category}>
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-2">{category}</h4>
              <div className="space-y-2">
                {mods.map((mod) => editId === mod.id ? (
                  <div key={mod.id} className="card border-accent/30 space-y-3">
                    <div className="grid sm:grid-cols-2 gap-3">
                      <div><label className="label">Name</label><input className="input" value={editForm.name} onChange={setEdit('name')} /></div>
                      <div>
                        <label className="label">Category</label>
                        <select className="input" value={editForm.category} onChange={setEdit('category')}>
                          <option value="">Select…</option>
                          {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                        </select>
                      </div>
                    </div>
                    <div><label className="label">Description</label><textarea className="input resize-none" rows={2} value={editForm.description} onChange={setEdit('description')} /></div>
                    <LinkField value={editForm.link} onChange={setEdit('link')} />
                    <div className="grid sm:grid-cols-3 gap-3">
                      <div><label className="label">Cost ({sym})</label><input className="input" type="number" step="0.01" value={editForm.cost} onChange={setEdit('cost')} /></div>
                      <div>
                        <label className="label">Date Installed</label>
                        <DateInput value={editForm.installedDate} onChange={setEdit('installedDate')} />
                      </div>
                      <div><label className="label">Shop</label><input className="input" value={editForm.shop} onChange={setEdit('shop')} /></div>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => setEditId(null)} className="btn-ghost"><X size={14} /> Cancel</button>
                      <button onClick={saveEdit} className="btn-primary"><Check size={14} /> Save</button>
                    </div>
                  </div>
                ) : (
                  <div key={mod.id} className="card flex gap-4 items-start hover:border-accent/20">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-white">{mod.name}</span>
                        {mod.cost && <span className="text-xs text-accent font-semibold">{sym}{Number(mod.cost).toFixed(2)}</span>}
                      </div>
                      {mod.description && <p className="text-xs text-gray-400 mt-1">{mod.description}</p>}
                      <div className="flex gap-3 mt-1.5 text-xs text-gray-600 flex-wrap items-center">
                        {mod.installedDate && <span>{new Date(mod.installedDate + 'T12:00:00').toLocaleDateString()}</span>}
                        {mod.shop && <span>by {mod.shop}</span>}
                        {mod.link && (
                          <a href={mod.link} target="_blank" rel="noreferrer"
                            className="flex items-center gap-1 text-blue-400 hover:text-blue-300 transition-colors">
                            <ExternalLink size={11} /> View Link
                          </a>
                        )}
                        <button
                          onClick={() => setLogMod(mod)}
                          className="flex items-center gap-1 text-accent hover:text-accent-dim font-medium transition-colors ml-auto"
                          title="Log to Maintenance"
                        >
                          <ClipboardList size={11} /> Log to Maintenance
                        </button>
                      </div>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <button onClick={() => startEdit(mod)} className="btn-ghost"><Pencil size={14} /></button>
                      <button onClick={() => setConfirmMod(mod)} className="btn-ghost text-red-500 hover:text-red-400"><Trash2 size={14} /></button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
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
