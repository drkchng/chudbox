import { useState } from 'react'
import { Plus, Trash2, ClipboardList, Pencil, Check, X, Calendar } from 'lucide-react'
import useGarageStore from '../../store/useGarageStore'

const SERVICES = ['Oil Change', 'Tire Rotation', 'Brake Pads', 'Brake Fluid', 'Coolant Flush', 'Transmission Fluid', 'Spark Plugs', 'Air Filter', 'Cabin Filter', 'Belt / Chain', 'Battery', 'Alignment', 'Tires', 'Inspection', 'Other']

const emptyForm = { service: '', date: '', mileage: '', cost: '', shop: '', notes: '', nextDueDate: '', nextDueMileage: '' }

export default function MaintenanceTab({ car }) {
  const addMaintenance    = useGarageStore((s) => s.addMaintenance)
  const updateMaintenance = useGarageStore((s) => s.updateMaintenance)
  const deleteMaintenance = useGarageStore((s) => s.deleteMaintenance)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [editId, setEditId] = useState(null)
  const [editForm, setEditForm] = useState({})

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const setEdit = (k) => (e) => setEditForm((f) => ({ ...f, [k]: e.target.value }))

  const handleAdd = (e) => {
    e.preventDefault()
    if (!form.service) return
    addMaintenance(car.id, { ...form, cost: form.cost ? parseFloat(form.cost) : null, mileage: form.mileage || null })
    setForm(emptyForm)
    setShowForm(false)
  }

  const startEdit = (rec) => { setEditId(rec.id); setEditForm({ ...rec }) }
  const saveEdit = () => {
    updateMaintenance(car.id, editId, { ...editForm, cost: editForm.cost ? parseFloat(editForm.cost) : null })
    setEditId(null)
  }

  const sorted = [...car.maintenance].sort((a, b) => new Date(b.date) - new Date(a.date))
  const totalCost = car.maintenance.reduce((s, r) => s + (r.cost || 0), 0)

  const isOverdue = (rec) => {
    if (rec.nextDueDate && new Date(rec.nextDueDate) < new Date()) return true
    return false
  }

  const FormFields = ({ vals, onChange }) => (
    <>
      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <label className="label">Service *</label>
          <input className="input" list="service-list" placeholder="Oil Change" value={vals.service} onChange={onChange('service')} required />
          <datalist id="service-list">{SERVICES.map((s) => <option key={s} value={s} />)}</datalist>
        </div>
        <div>
          <label className="label">Date</label>
          <input className="input" type="date" value={vals.date} onChange={onChange('date')} />
        </div>
      </div>
      <div className="grid sm:grid-cols-3 gap-3">
        <div><label className="label">Mileage</label><input className="input" type="number" placeholder="45000" value={vals.mileage} onChange={onChange('mileage')} /></div>
        <div><label className="label">Cost</label><input className="input" type="number" step="0.01" placeholder="0.00" value={vals.cost} onChange={onChange('cost')} /></div>
        <div><label className="label">Shop</label><input className="input" placeholder="Self / Shop name" value={vals.shop} onChange={onChange('shop')} /></div>
      </div>
      <div><label className="label">Notes</label><textarea className="input resize-none" rows={2} value={vals.notes} onChange={onChange('notes')} /></div>
      <div className="grid sm:grid-cols-2 gap-3">
        <div><label className="label">Next Due Date</label><input className="input" type="date" value={vals.nextDueDate} onChange={onChange('nextDueDate')} /></div>
        <div><label className="label">Next Due Mileage</label><input className="input" type="number" placeholder="50000" value={vals.nextDueMileage} onChange={onChange('nextDueMileage')} /></div>
      </div>
    </>
  )

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h3 className="text-white font-semibold">Maintenance Log</h3>
          {car.maintenance.length > 0 && (
            <p className="text-xs text-gray-500 mt-0.5">{car.maintenance.length} records · Total spent: ${totalCost.toFixed(2)}</p>
          )}
        </div>
        <button onClick={() => setShowForm((v) => !v)} className="btn-primary"><Plus size={14} /> Log Service</button>
      </div>

      {showForm && (
        <form onSubmit={handleAdd} className="card mb-5 space-y-3 border-accent/30">
          <h4 className="text-sm font-semibold text-white">New Service Record</h4>
          <FormFields vals={form} onChange={set} />
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
              <FormFields vals={editForm} onChange={setEdit} />
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
                  {rec.cost && <span className="text-xs text-accent font-semibold">${Number(rec.cost).toFixed(2)}</span>}
                  {isOverdue(rec) && <span className="badge bg-red-900/50 text-red-300 border border-red-700/40">Overdue</span>}
                </div>
                {rec.notes && <p className="text-xs text-gray-400 mt-1">{rec.notes}</p>}
                <div className="flex gap-3 mt-1.5 text-xs text-gray-500 flex-wrap">
                  {rec.date && <span className="flex items-center gap-1"><Calendar size={10} />{new Date(rec.date).toLocaleDateString()}</span>}
                  {rec.mileage && <span>{Number(rec.mileage).toLocaleString()} mi</span>}
                  {rec.shop && <span>at {rec.shop}</span>}
                </div>
                {(rec.nextDueDate || rec.nextDueMileage) && (
                  <p className="text-xs text-gray-600 mt-1">
                    Next: {rec.nextDueDate ? new Date(rec.nextDueDate).toLocaleDateString() : ''}{rec.nextDueDate && rec.nextDueMileage ? ' / ' : ''}{rec.nextDueMileage ? `${Number(rec.nextDueMileage).toLocaleString()} mi` : ''}
                  </p>
                )}
              </div>
              <div className="flex gap-1 shrink-0">
                <button onClick={() => startEdit(rec)} className="btn-ghost"><Pencil size={14} /></button>
                <button onClick={() => deleteMaintenance(car.id, rec.id)} className="btn-ghost text-red-500 hover:text-red-400"><Trash2 size={14} /></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
