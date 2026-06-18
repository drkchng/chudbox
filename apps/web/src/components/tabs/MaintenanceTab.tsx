import { useState } from 'react'
import type { FormEvent } from 'react'
import { Plus, Trash2, ClipboardList, Pencil, Check, X, Calendar } from 'lucide-react'
import useGarageStore from '../../store/useGarageStore'
import { CURRENCIES, DISTANCE_UNITS, formatMileage, mileagePrefill } from '../../utils/units'
import DateInput from '../DateInput'
import ConfirmModal from '../ConfirmModal'
import MileageText from '../MileageText'
import type { MaintenanceRecord, StoredCar, StoredMaintenance, FieldChangeEvent } from '../../types'

const SERVICES = ['Oil Change', 'Tire Rotation', 'Brake Pads', 'Brake Fluid', 'Coolant Flush', 'Transmission Fluid', 'Spark Plugs', 'Air Filter', 'Cabin Filter', 'Belt / Chain', 'Battery', 'Alignment', 'Tires', 'Inspection', 'Other']

interface MaintenanceForm {
  service: string
  date: string
  mileage: string
  cost: string
  shop: string
  notes: string
  nextDueDate: string
  nextDueMileage: string
}

const emptyForm: MaintenanceForm = { service: '', date: '', mileage: '', cost: '', shop: '', notes: '', nextDueDate: '', nextDueMileage: '' }

type MaintenanceFieldSetter = <K extends keyof MaintenanceForm>(key: K) => (eOrVal: string | FieldChangeEvent) => void

interface FormFieldsProps {
  vals: MaintenanceForm
  onChange: MaintenanceFieldSetter
  sym?: string
  distShort?: string
}

// Defined outside MaintenanceTab so React never unmounts/remounts it on re-render
function FormFields({ vals, onChange, sym = '$', distShort = 'mi' }: FormFieldsProps) {
  return (
    <>
      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <label className="label">Service *</label>
          <input className="input" list="service-list" placeholder="Oil Change" value={vals.service} onChange={onChange('service')} required />
          <datalist id="service-list">{SERVICES.map((s) => <option key={s} value={s} />)}</datalist>
        </div>
        <div>
          <label className="label">Date</label>
          <DateInput value={vals.date} onChange={onChange('date')} />
        </div>
      </div>
      <div className="grid sm:grid-cols-3 gap-3">
        <div><label className="label">Mileage ({distShort})</label><input className="input" type="number" placeholder="45000" value={vals.mileage} onChange={onChange('mileage')} /></div>
        <div><label className="label">Cost ({sym})</label><input className="input" type="number" step="0.01" placeholder="0.00" value={vals.cost} onChange={onChange('cost')} /></div>
        <div><label className="label">Shop</label><input className="input" placeholder="Self / Shop name" value={vals.shop} onChange={onChange('shop')} /></div>
      </div>
      <div><label className="label">Notes</label><textarea className="input resize-none" rows={2} value={vals.notes} onChange={onChange('notes')} /></div>
      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <label className="label">Next Due Date</label>
          <DateInput value={vals.nextDueDate} onChange={onChange('nextDueDate')} />
        </div>
        <div><label className="label">Next Due Mileage</label><input className="input" type="number" placeholder="50000" value={vals.nextDueMileage} onChange={onChange('nextDueMileage')} /></div>
      </div>
    </>
  )
}

interface MaintenanceTabProps {
  car: StoredCar
}

export default function MaintenanceTab({ car }: MaintenanceTabProps) {
  const addMaintenance    = useGarageStore((s) => s.addMaintenance)
  const updateMaintenance = useGarageStore((s) => s.updateMaintenance)
  const deleteMaintenance = useGarageStore((s) => s.deleteMaintenance)
  const currency     = useGarageStore((s) => s.currency)
  const distanceUnit = useGarageStore((s) => s.distanceUnit)
  const sym       = CURRENCIES[currency]?.symbol ?? '$'
  const distShort = DISTANCE_UNITS[distanceUnit]?.short ?? 'mi'
  const [showForm, setShowForm]   = useState(false)
  const [form, setForm]           = useState<MaintenanceForm>(emptyForm)
  const [editId, setEditId]       = useState<string | null>(null)
  const [editForm, setEditForm]   = useState<MaintenanceForm>(emptyForm)
  const [confirmRec, setConfirmRec] = useState<MaintenanceRecord | null>(null)

  // Accepts either a plain string (from DateInput) or a change event (from regular inputs)
  const set: MaintenanceFieldSetter =
    (key) => (eOrVal) =>
      setForm((f) => ({ ...f, [key]: typeof eOrVal === 'string' ? eOrVal : eOrVal.target.value }))
  const setEdit: MaintenanceFieldSetter =
    (key) => (eOrVal) =>
      setEditForm((f) => ({ ...f, [key]: typeof eOrVal === 'string' ? eOrVal : eOrVal.target.value }))

  const handleAdd = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!form.service) return
    addMaintenance(car.id, { ...form, cost: form.cost ? parseFloat(form.cost) : null, mileage: form.mileage || null })
    setForm(emptyForm)
    setShowForm(false)
  }

  // Prefill mileage fields from the canonical miles converted to the ACTIVE
  // unit (not the raw string), so editing a record entered under a different
  // unit shows the right number and saving doesn't re-canonicalize the raw
  // under the wrong unit. Non-numeric raw is preserved verbatim.
  const startEdit = (rec: StoredMaintenance) => {
    setEditId(rec.id)
    setEditForm({
      service: rec.service,
      date: rec.date,
      mileage: mileagePrefill(rec.mileage, rec.mileageMiles, distanceUnit),
      cost: rec.cost != null ? String(rec.cost) : '',
      shop: rec.shop,
      notes: rec.notes,
      nextDueDate: rec.nextDueDate,
      nextDueMileage: mileagePrefill(rec.nextDueMileage, rec.nextDueMileageMiles, distanceUnit),
    })
  }
  const saveEdit = () => {
    if (!editId) return
    updateMaintenance(car.id, editId, { ...editForm, cost: editForm.cost ? parseFloat(editForm.cost) : null, mileage: editForm.mileage || null })
    setEditId(null)
  }

  const sorted    = [...car.maintenance].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
  const totalCost = car.maintenance.reduce((s, r) => s + (r.cost || 0), 0)
  const isOverdue = (rec: MaintenanceRecord): boolean => Boolean(rec.nextDueDate) && new Date(rec.nextDueDate) < new Date()

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h3 className="text-white font-semibold">Maintenance Log</h3>
          {car.maintenance.length > 0 && (
            <p className="text-xs text-gray-500 mt-0.5">{car.maintenance.length} records · Total spent: {sym}{totalCost.toFixed(2)}</p>
          )}
        </div>
        <button onClick={() => setShowForm((v) => !v)} className="btn-primary"><Plus size={14} /> Log Service</button>
      </div>

      {showForm && (
        <form onSubmit={handleAdd} className="card mb-5 space-y-3 border-accent/30">
          <h4 className="text-sm font-semibold text-white">New Service Record</h4>
          <FormFields vals={form} onChange={set} sym={sym} distShort={distShort} />
          <div className="flex gap-2">
            <button type="button" onClick={() => setShowForm(false)} className="btn-outline">Cancel</button>
            <button type="submit" className="btn-primary">Save Record</button>
          </div>
        </form>
      )}

      {car.maintenance.length === 0 ? (
        <div className="text-center py-16 text-gray-600">
          <ClipboardList size={36} className="mx-auto mb-3 opacity-40" />
          <p>No maintenance records yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {sorted.map((rec) => editId === rec.id ? (
            <div key={rec.id} className="card border-accent/30 space-y-3">
              <FormFields vals={editForm} onChange={setEdit} sym={sym} distShort={distShort} />
              <div className="flex gap-2">
                <button onClick={() => setEditId(null)} className="btn-ghost"><X size={14} /> Cancel</button>
                <button onClick={saveEdit} className="btn-primary"><Check size={14} /> Save</button>
              </div>
            </div>
          ) : (
            <div key={rec.id} className={`card flex gap-4 items-start hover:border-accent/20 ${isOverdue(rec) ? 'border-red-700/40' : ''}`}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-white">{rec.service}</span>
                  {rec.cost && <span className="text-xs text-accent font-semibold">{sym}{Number(rec.cost).toFixed(2)}</span>}
                  {isOverdue(rec) && <span className="badge bg-red-900/50 text-red-300 border border-red-700/40">Overdue</span>}
                </div>
                {rec.notes && <p className="text-xs text-gray-400 mt-1">{rec.notes}</p>}
                <div className="flex gap-3 mt-1.5 text-xs text-gray-500 flex-wrap">
                  {rec.date && <span className="flex items-center gap-1"><Calendar size={10} />{new Date(rec.date + 'T12:00:00').toLocaleDateString()}</span>}
                  <MileageText raw={rec.mileage} miles={rec.mileageMiles} unit={distanceUnit} />
                  {rec.shop && <span>at {rec.shop}</span>}
                </div>
                {(rec.nextDueDate || rec.nextDueMileage) && (
                  <p className="text-xs text-gray-600 mt-1">
                    Next:{' '}
                    {rec.nextDueDate ? new Date(rec.nextDueDate + 'T12:00:00').toLocaleDateString() : ''}
                    {rec.nextDueDate && rec.nextDueMileage ? ' / ' : ''}
                    {formatMileage(rec.nextDueMileage, rec.nextDueMileageMiles, distanceUnit) ?? ''}
                  </p>
                )}
              </div>
              <div className="flex gap-1 shrink-0">
                <button onClick={() => startEdit(rec)} className="btn-ghost"><Pencil size={14} /></button>
                <button onClick={() => setConfirmRec(rec)} className="btn-ghost text-red-500 hover:text-red-400"><Trash2 size={14} /></button>
              </div>
            </div>
          ))}
        </div>
      )}
      {confirmRec && (
        <ConfirmModal
          title="Delete record?"
          message={`"${confirmRec.service}" will be permanently deleted from your maintenance log.`}
          onConfirm={() => deleteMaintenance(car.id, confirmRec.id)}
          onClose={() => setConfirmRec(null)}
        />
      )}
    </div>
  )
}
