import { useState } from 'react'
import { Plus, Trash2, Wrench, Pencil, Check, X } from 'lucide-react'
import useGarageStore from '../../store/useGarageStore'
import DateInput from '../DateInput'

const CATEGORIES = ['Engine', 'Exhaust', 'Intake', 'Suspension', 'Brakes', 'Wheels / Tires', 'Exterior', 'Interior', 'Audio', 'Lighting', 'Tuning', 'Other']

const emptyForm = { name: '', category: '', description: '', cost: '', installedDate: '', shop: '' }

export default function ModsTab({ car }) {
  const addMod    = useGarageStore((s) => s.addMod)
  const updateMod = useGarageStore((s) => s.updateMod)
  const deleteMod = useGarageStore((s) => s.deleteMod)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm]         = useState(emptyForm)
  const [editId, setEditId]     = useState(null)
  const [editForm, setEditForm] = useState({})

  // Accepts either a plain value (from DateInput) or a change event (from regular inputs)
  const set     = (k) => (eOrVal) => setForm((f)     => ({ ...f, [k]: typeof eOrVal === 'string' ? eOrVal : eOrVal.target.value }))
  const setEdit = (k) => (eOrVal) => setEditForm((f) => ({ ...f, [k]: typeof eOrVal === 'string' ? eOrVal : eOrVal.target.value }))

  const handleAdd = (e) => {
    e.preventDefault()
    if (!form.name) return
    addMod(car.id, { ...form, cost: form.cost ? parseFloat(form.cost) : null })
    setForm(emptyForm)
    setShowForm(false)
  }

  const startEdit = (mod) => { setEditId(mod.id); setEditForm({ ...mod }) }
  const saveEdit  = () => {
    updateMod(car.id, editId, { ...editForm, cost: editForm.cost ? parseFloat(editForm.cost) : null })
    setEditId(null)
  }

  const totalCost = car.mods.reduce((s, m) => s + (m.cost || 0), 0)

  const grouped = car.mods.reduce((acc, mod) => {
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
            <p className="text-xs text-gray-500 mt-0.5">{car.mods.length} mods · Total invested: ${totalCost.toFixed(2)}</p>
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
          <div className="grid sm:grid-cols-3 gap-3">
            <div>
              <label className="label">Cost ($)</label>
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
                    <div className="grid sm:grid-cols-3 gap-3">
                      <div><label className="label">Cost ($)</label><input className="input" type="number" step="0.01" value={editForm.cost} onChange={setEdit('cost')} /></div>
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
                        {mod.cost && <span className="text-xs text-accent font-semibold">${Number(mod.cost).toFixed(2)}</span>}
                      </div>
                      {mod.description && <p className="text-xs text-gray-400 mt-1">{mod.description}</p>}
                      <div className="flex gap-3 mt-1 text-xs text-gray-600 flex-wrap">
                        {mod.installedDate && <span>{new Date(mod.installedDate + 'T12:00:00').toLocaleDateString()}</span>}
                        {mod.shop && <span>by {mod.shop}</span>}
                      </div>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <button onClick={() => startEdit(mod)} className="btn-ghost"><Pencil size={14} /></button>
                      <button onClick={() => deleteMod(car.id, mod.id)} className="btn-ghost text-red-500 hover:text-red-400"><Trash2 size={14} /></button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
