import { useState } from 'react'
import { Plus, ExternalLink, Trash2, DollarSign, ShoppingCart, CheckCircle2, Package } from 'lucide-react'
import useGarageStore from '../../store/useGarageStore'

const STATUS_STYLES = {
  wanted:    { label: 'Wanted',    class: 'bg-blue-900/50 text-blue-300 border-blue-700/40' },
  ordered:   { label: 'Ordered',   class: 'bg-yellow-900/50 text-yellow-300 border-yellow-700/40' },
  installed: { label: 'Installed', class: 'bg-green-900/50 text-green-300 border-green-700/40' },
}

const CATEGORIES = ['Engine', 'Exhaust', 'Suspension', 'Brakes', 'Wheels / Tires', 'Exterior', 'Interior', 'Audio', 'Lighting', 'Other']

const emptyForm = { name: '', link: '', price: '', category: '', notes: '' }

export default function WishlistTab({ car }) {
  const addWishlistItem    = useGarageStore((s) => s.addWishlistItem)
  const updateWishlistItem = useGarageStore((s) => s.updateWishlistItem)
  const deleteWishlistItem = useGarageStore((s) => s.deleteWishlistItem)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(emptyForm)

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const handleAdd = (e) => {
    e.preventDefault()
    if (!form.name) return
    addWishlistItem(car.id, { ...form, price: form.price ? parseFloat(form.price) : null })
    setForm(emptyForm)
    setShowForm(false)
  }

  const totalWanted = car.wishlist.filter((i) => i.status !== 'installed').reduce((s, i) => s + (i.price || 0), 0)

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h3 className="text-white font-semibold">Parts Wishlist</h3>
          {car.wishlist.length > 0 && (
            <p className="text-xs text-gray-500 mt-0.5">
              {car.wishlist.length} items · Est. remaining: ${totalWanted.toFixed(2)}
            </p>
          )}
        </div>
        <button onClick={() => setShowForm((v) => !v)} className="btn-primary"><Plus size={14} /> Add Part</button>
      </div>

      {/* Add form */}
      {showForm && (
        <form onSubmit={handleAdd} className="card mb-5 space-y-3 border-accent/30">
          <h4 className="text-sm font-semibold text-white">New Part</h4>
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="label">Part Name *</label>
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
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="label">Link (optional)</label>
              <input className="input" placeholder="https://..." value={form.link} onChange={set('link')} type="url" />
            </div>
            <div>
              <label className="label">Price</label>
              <input className="input" placeholder="499.99" type="number" step="0.01" value={form.price} onChange={set('price')} />
            </div>
          </div>
          <div>
            <label className="label">Notes</label>
            <textarea className="input resize-none" rows={2} placeholder="Any notes…" value={form.notes} onChange={set('notes')} />
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => setShowForm(false)} className="btn-outline">Cancel</button>
            <button type="submit" className="btn-primary">Add Part</button>
          </div>
        </form>
      )}

      {/* List */}
      {car.wishlist.length === 0 ? (
        <div className="text-center py-16 text-gray-600">
          <ShoppingCart size={36} className="mx-auto mb-3 opacity-40" />
          <p>No parts on your wishlist yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {car.wishlist.map((item) => (
            <div key={item.id} className="card hover:border-accent/20 flex gap-4 items-start">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-white">{item.name}</span>
                  {item.category && <span className="text-xs text-gray-500 border border-border rounded px-1.5 py-0.5">{item.category}</span>}
                  <span className={`badge border ${STATUS_STYLES[item.status].class}`}>{STATUS_STYLES[item.status].label}</span>
                </div>
                {item.notes && <p className="text-xs text-gray-500 mt-1">{item.notes}</p>}
                <div className="flex items-center gap-3 mt-2">
                  {item.price && (
                    <span className="flex items-center gap-1 text-sm font-semibold text-accent">
                      <DollarSign size={12} />{item.price.toFixed(2)}
                    </span>
                  )}
                  {item.link && (
                    <a href={item.link} target="_blank" rel="noreferrer"
                      className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300">
                      <ExternalLink size={11} /> View Link
                    </a>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {item.status === 'wanted' && (
                  <button onClick={() => updateWishlistItem(car.id, item.id, { status: 'ordered' })}
                    title="Mark as Ordered" className="btn-ghost text-yellow-500 hover:text-yellow-400">
                    <Package size={15} />
                  </button>
                )}
                {item.status === 'ordered' && (
                  <button onClick={() => updateWishlistItem(car.id, item.id, { status: 'installed' })}
                    title="Mark as Installed" className="btn-ghost text-green-500 hover:text-green-400">
                    <CheckCircle2 size={15} />
                  </button>
                )}
                {item.status === 'installed' && (
                  <button onClick={() => updateWishlistItem(car.id, item.id, { status: 'wanted' })}
                    title="Move back to Wanted" className="btn-ghost text-gray-500">
                    <CheckCircle2 size={15} />
                  </button>
                )}
                <button onClick={() => deleteWishlistItem(car.id, item.id)} className="btn-ghost text-red-500 hover:text-red-400">
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
