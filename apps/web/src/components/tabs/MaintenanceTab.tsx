import { useState } from 'react'
import type { FormEvent } from 'react'
import { Plus, Trash2, ClipboardList, Pencil, Check, X, Calendar } from 'lucide-react'
import { tokens } from '@chudbox/shared'
import useGarageStore from '../../store/useGarageStore'
import { CURRENCIES, DISTANCE_UNITS, formatMileage, formatMoney, mileagePrefill } from '../../utils/units'
import { carDueMaintenance } from '../../utils/maintenanceDue'
import DateInput from '../DateInput'
import ConfirmModal from '../ConfirmModal'
import MileageText from '../MileageText'
import Button from '../ui/Button'
import IconButton from '../ui/IconButton'
import Badge from '../ui/Badge'
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

const fmtDate = (iso: string): string => new Date(iso + 'T12:00:00').toLocaleDateString()

type MaintenanceFieldSetter = <K extends keyof MaintenanceForm>(key: K) => (eOrVal: string | FieldChangeEvent) => void

interface FormFieldsProps {
  /** Namespaces field ids so the add-form and an open inline edit-form never
   *  collide on the same htmlFor/id (both can be mounted at once). */
  idPrefix: string
  vals: MaintenanceForm
  onChange: MaintenanceFieldSetter
  sym?: string
  distShort?: string
}

// Defined outside MaintenanceTab so React never unmounts/remounts it on re-render
function FormFields({ idPrefix, vals, onChange, sym = '$', distShort = 'mi' }: FormFieldsProps) {
  const id = (suffix: string) => `${idPrefix}-${suffix}`
  return (
    <>
      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <label htmlFor={id('service')} className="label">Service *</label>
          <input id={id('service')} className="input" list={id('service-list')} placeholder="Oil Change" value={vals.service} onChange={onChange('service')} required />
          <datalist id={id('service-list')}>{SERVICES.map((s) => <option key={s} value={s} />)}</datalist>
        </div>
        <div role="group" aria-labelledby={id('date-label')}>
          <span id={id('date-label')} className="label">Date</span>
          <DateInput value={vals.date} onChange={onChange('date')} />
        </div>
      </div>
      <div className="grid sm:grid-cols-3 gap-3">
        <div>
          <label htmlFor={id('mileage')} className="label">Mileage ({distShort})</label>
          <input id={id('mileage')} className="input" type="number" placeholder="45000" value={vals.mileage} onChange={onChange('mileage')} />
        </div>
        <div>
          <label htmlFor={id('cost')} className="label">Cost ({sym})</label>
          <input id={id('cost')} className="input" type="number" step="0.01" placeholder="0.00" value={vals.cost} onChange={onChange('cost')} />
        </div>
        <div>
          <label htmlFor={id('shop')} className="label">Shop</label>
          <input id={id('shop')} className="input" placeholder="Self / Shop name" value={vals.shop} onChange={onChange('shop')} />
        </div>
      </div>
      <div>
        <label htmlFor={id('notes')} className="label">Notes</label>
        <textarea id={id('notes')} className="input resize-none" rows={2} value={vals.notes} onChange={onChange('notes')} />
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <div role="group" aria-labelledby={id('nextdate-label')}>
          <span id={id('nextdate-label')} className="label">Next due date</span>
          <DateInput value={vals.nextDueDate} onChange={onChange('nextDueDate')} />
        </div>
        <div>
          <label htmlFor={id('nextmileage')} className="label">Next due mileage ({distShort})</label>
          <input id={id('nextmileage')} className="input" type="number" placeholder="50000" value={vals.nextDueMileage} onChange={onChange('nextDueMileage')} />
        </div>
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
  // DEC-16 / U2: due/overdue computed by date AND by current mileage (latest
  // check-in) vs each record's next-due mileage — maintenance feeds the timeline
  // by COMPUTATION (§13.4), never a copy. `byId` flags individual rows.
  const due       = carDueMaintenance(car)

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-5">
        <div className="min-w-0">
          <h3 className="text-subhead font-semibold text-text-primary">Maintenance log</h3>
          {car.maintenance.length > 0 && (
            <p className="mt-0.5 text-meta text-text-secondary">
              {car.maintenance.length} records · Total spent:{' '}
              <span className="text-text-primary font-semibold">{formatMoney(totalCost, currency)}</span>
            </p>
          )}
        </div>
        <Button size="sm" onClick={() => setShowForm((v) => !v)}>
          <Plus size={tokens.iconSize.sm} /> Log Service
        </Button>
      </div>

      {showForm && (
        <form onSubmit={handleAdd} className="card mb-5 space-y-3 border-accent/30">
          <h4 className="text-body font-semibold text-text-primary">New service record</h4>
          <FormFields idPrefix="maint-add" vals={form} onChange={set} sym={sym} distShort={distShort} />
          <div className="flex gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button type="submit" size="sm">Save Record</Button>
          </div>
        </form>
      )}

      {car.maintenance.length === 0 ? (
        <div className="text-center py-16">
          <ClipboardList size={tokens.iconSize.xl} className="mx-auto mb-3 text-text-disabled" />
          <p className="text-text-secondary">No maintenance records yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {sorted.map((rec) => editId === rec.id ? (
            <div key={rec.id} className="card border-accent/30 space-y-3">
              <FormFields idPrefix="maint-edit" vals={editForm} onChange={setEdit} sym={sym} distShort={distShort} />
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
            <div key={rec.id} className={`card-row flex gap-4 items-start ${due.byId[rec.id] === 'overdue' ? 'border-danger-border' : due.byId[rec.id] === 'due-soon' ? 'border-warning-border' : ''}`}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-text-primary">{rec.service}</span>
                  {/* V5: price = data → text-primary weight, not orange. */}
                  {rec.cost ? (
                    <span className="text-meta font-semibold text-text-primary">{formatMoney(Number(rec.cost), currency)}</span>
                  ) : null}
                  {/* U2: overdue (danger) / due-soon (warning) by date OR mileage. */}
                  {due.byId[rec.id] === 'overdue' && <Badge status="danger">Overdue</Badge>}
                  {due.byId[rec.id] === 'due-soon' && <Badge status="warning">Due soon</Badge>}
                </div>
                {rec.notes && <p className="mt-1 text-meta text-text-secondary">{rec.notes}</p>}
                <div className="mt-1.5 flex flex-wrap gap-3 text-meta text-text-secondary">
                  {rec.date && (
                    <span className="flex items-center gap-1">
                      <Calendar size={tokens.iconSize.xs} className="text-text-tertiary" />
                      {fmtDate(rec.date)}
                    </span>
                  )}
                  <MileageText raw={rec.mileage} miles={rec.mileageMiles} unit={distanceUnit} />
                  {rec.shop && <span>at {rec.shop}</span>}
                </div>
                {(rec.nextDueDate || rec.nextDueMileage) && (
                  <p className="mt-1 text-meta text-text-secondary">
                    Next:{' '}
                    {rec.nextDueDate ? fmtDate(rec.nextDueDate) : ''}
                    {rec.nextDueDate && rec.nextDueMileage ? ' / ' : ''}
                    {formatMileage(rec.nextDueMileage, rec.nextDueMileageMiles, distanceUnit) ?? ''}
                  </p>
                )}
              </div>
              <div className="flex gap-1 shrink-0">
                <IconButton aria-label={`Edit "${rec.service}"`} title="Edit" onClick={() => startEdit(rec)}>
                  <Pencil size={tokens.iconSize.sm} />
                </IconButton>
                <IconButton aria-label={`Delete "${rec.service}"`} title="Delete" onClick={() => setConfirmRec(rec)}>
                  <Trash2 size={tokens.iconSize.sm} />
                </IconButton>
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
