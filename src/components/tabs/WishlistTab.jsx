import { useState } from 'react'
import { Plus, ExternalLink, Trash2, DollarSign, ShoppingCart, CheckCircle2, Package, Wrench, X } from 'lucide-react'
import useGarageStore from '../../store/useGarageStore'
import DateInput from '../DateInput'
import ConfirmModal from '../ConfirmModal'

const STATUS_STYLES = {
  wanted:    { label: 'Wanted',    class: 'bg-blue-900/50 text-blue-300 border-blue-700/40' },
  ordered:   { label: 'Ordered',   class: 'bg-yellow-900/50 text-yellow-300 border-yellow-700/40' },
  installed: { label: 'Installed', class: 'bg-green-900/50 text-green-300 border-green-700/40' },
}

const CATEGORIES = ['Engine', 'Exhaust', 'Suspension', 'Brakes', 'Wheels / Tires', 'Exterior', 'Interior', 'Audio', 'Lighting', 'Other']

const emptyForm = { name: '', link: '', price: '', category: '', notes: '' }

// Modal shown when moving an installed wishlist item to mods
function MoveToModsModal({ item, carId, onClose }) {
  const addMod             = useGarageStore((s) => s.addMod)
  const deleteWishlistItem = useGarageStore((s) => s.deleteWishlistItem)

  const [mod, setMod] = useState({
    name:          item.name        || '',
    category:      item.category    || '',
    description:   item.notes       || '',
    cost:          item.price != null ? String(item.price) : '',
    link:          item.link        || '',
    installedDate: new Date().toISOString().slice(0, 10),
    shop:          '',
  })
  const [removeFromWishlist, setRemoveFromWishlist] = useState(true)

  const set    = (k) => (eOrVal) => setMod((m) => ({ ...m, [k]: typeof eOrVal === 'string' ? eOrVal : eOrVal.target.value }))

  const handleConfirm = () => {
    addMod(carId, { ...mod, cost: mod.cost ? parseFloat(mod.cost) : null })
    if (removeFromWishlist) deleteWishlistItem(carId, item.id)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="bg-surface border border-border rounded-2xl w-full max-w-md shadow-2xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div>
            <h2 className="text-base font-semibold text-white">Move to Mods</h2>
            <p className="text-xs text-gray-500 mt-0.5">Confirm details before adding to your mods list</p>
          </div>
          <button onClick={onClose} className="btn-ghost"><X size={18} /></button>
        </div>

        <div className="overflow-y-auto px-5 py-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Part Name</label>
              <input className="input" value={mod.name} onChange={set('name')} />
            </div>
            <div>
              <label className="label">Category</label>
              <select className="input" value={mod.category} onChange={set('category')}>
                <option value="">Select…</option>
                {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="label">Description</label>
            <textarea className="input resize-none" rows={2} value={mod.description} onChange={set('description')} />
          </div>
          <div>
            <label className="label">Link</label>
            <input className="input" type="url" placeholder="https://…" value={mod.link} onChange={set('link')} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Cost ($)</label>
              <input className="input" type="number" step="0.01" value={mod.cost} onChange={set('cost')} />
            </div>
            <div>
              <label className="label">Date Installed</label>
              <DateInput value={mod.installedDate} onChange={set('installedDate')} />
            </div>
          </div>
          <div>
            <label className="label">Shop / Installer</label>
            <input className="input" placeholder="Self / Shop name" value={mod.shop} onChange={set('shop')} />
          </div>

          <label className="flex items-center gap-2.5 mt-1 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={removeFromWishlist}
              onChange={(e) => setRemoveFromWishlist(e.target.checked)}
              className="w-4 h-4 rounded accent-accent"
            />
            <span className="text-sm text-gray-300">Remove from wishlist after moving</span>
          </label>
        </div>

        <div className="flex gap-3 px-5 py-4 border-t border-border shrink-0">
          <button onClick={onClose} className="btn-outline flex-1 justify-center">Cancel</button>
          <button onClick={handleConfirm} className="btn-primary flex-1 justify-center">
            <Wrench size={14} /> Add to Mods
          </button>
        </div>
      </div>
    </div>
  )
}

export default function WishlistTab({ car }) {
  const addWishlistItem    = useGarageStore((s) => s.addWishlistItem)
  const updateWishlistItem = useGarageStore((s) => s.updateWishlistItem)
  const deleteWishlistItem = useGarageStore((s) => s.deleteWishlistItem)
  const [showForm, setShowForm]       = useState(false)
  const [form, setForm]               = useState(emptyForm)
  const [movingItem, setMovingItem]   = useState(null)
  const [confirmItem, setConfirmItem] = useState(null)

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const handleAdd = (e) => {
    e.preventDefault()
    if (!form.name) return
    addWishlistItem(car.id, { ...form, price: form.price ? parseFloat(form.price) : null })
    setForm(emptyForm)
    setShowForm(false)
  }

  const markInstalled = (item) => {
    updateWishlistItem(car.id, item.id, { status: 'installed' })
    setMovingItem(item)
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
                <div className="flex items-center gap-3 mt-2 flex-wrap">
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
                  {item.status === 'installed' && (
                    <button
                      onClick={() => setMovingItem(item)}
                      className="flex items-center gap-1 text-xs text-accent hover:text-accent-dim font-medium transition-colors"
                    >
                      <Wrench size={11} /> Move to Mods
                    </button>
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
                  <button onClick={() => markInstalled(item)}
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
                <button onClick={() => setConfirmItem(item)} className="btn-ghost text-red-500 hover:text-red-400">
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {confirmItem && (
        <ConfirmModal
          title="Delete part?"
          message={`"${confirmItem.name}" will be permanently deleted from your wishlist.`}
          onConfirm={() => deleteWishlistItem(car.id, confirmItem.id)}
          onClose={() => setConfirmItem(null)}
        />
      )}

      {movingItem && (
        <MoveToModsModal
          item={movingItem}
          carId={car.id}
          onClose={() => setMovingItem(null)}
        />
      )}
    </div>
  )
}
