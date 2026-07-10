import { useState } from 'react'
import type { FormEvent } from 'react'
import { Plus, ExternalLink, Trash2, ShoppingCart, CheckCircle2, Package, Wrench, Pencil, Check, X } from 'lucide-react'
import { tokens } from '@chudbox/shared'
import useGarageStore from '../../store/useGarageStore'
import { CURRENCIES, formatMoney } from '../../utils/units'
import DateInput from '../DateInput'
import ConfirmModal from '../ConfirmModal'
import Modal from '../ui/Modal'
import Button from '../ui/Button'
import IconButton from '../ui/IconButton'
import Badge from '../ui/Badge'
import { CATEGORIES } from '../../utils/categories'
import { isSafeHref } from '../../utils/safeLink'
import type { Car, WishlistItem, WishlistStatus, StatusRole, FieldChangeEvent } from '../../types'

// Wishlist status → status role: wanted = info (on the list), ordered = warning
// (in flight), installed = success (done). Color is always paired with the
// Badge's icon + text.
const STATUS: Record<WishlistStatus, { label: string; role: StatusRole }> = {
  wanted:    { label: 'Wanted',    role: 'info' },
  ordered:   { label: 'Ordered',   role: 'warning' },
  installed: { label: 'Installed', role: 'success' },
}

interface WishlistForm {
  name: string
  link: string
  price: string
  category: string
  notes: string
}

const emptyForm: WishlistForm = { name: '', link: '', price: '', category: '', notes: '' }

const MOVE_FORM_ID = 'move-to-mods-form'

interface MoveModForm {
  name: string
  category: string
  description: string
  cost: string
  link: string
  installedDate: string
  shop: string
}

interface MoveToModsModalProps {
  item: WishlistItem
  carId: string
  onClose: () => void
}

// Modal shown when moving an installed wishlist item to mods. Uses the Modal
// primitive (focus trap / Esc / outside-press / dialog ARIA come free).
function MoveToModsModal({ item, carId, onClose }: MoveToModsModalProps) {
  const addMod             = useGarageStore((s) => s.addMod)
  const deleteWishlistItem = useGarageStore((s) => s.deleteWishlistItem)
  const currency = useGarageStore((s) => s.currency)
  const sym      = CURRENCIES[currency]?.symbol ?? '$'

  const [mod, setMod] = useState<MoveModForm>({
    name:          item.name        || '',
    category:      item.category    || '',
    description:   item.notes       || '',
    cost:          item.price != null ? String(item.price) : '',
    link:          item.link        || '',
    installedDate: new Date().toISOString().slice(0, 10),
    shop:          '',
  })
  const [removeFromWishlist, setRemoveFromWishlist] = useState(true)

  const set =
    <K extends keyof MoveModForm>(key: K) =>
    (eOrVal: string | FieldChangeEvent): void =>
      setMod((m) => ({ ...m, [key]: typeof eOrVal === 'string' ? eOrVal : eOrVal.target.value }))

  const handleConfirm = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    addMod(carId, { ...mod, cost: mod.cost ? parseFloat(mod.cost) : null })
    if (removeFromWishlist) deleteWishlistItem(carId, item.id)
    onClose()
  }

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title="Move to mods"
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" form={MOVE_FORM_ID}><Wrench size={tokens.iconSize.sm} /> Add to mods</Button>
        </>
      }
    >
      <p className="text-meta text-text-secondary mb-4">Confirm details before adding to your mods list.</p>
      <form id={MOVE_FORM_ID} onSubmit={handleConfirm} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="move-name" className="label">Part name</label>
            <input id="move-name" className="input" value={mod.name} onChange={set('name')} />
          </div>
          <div>
            <label htmlFor="move-category" className="label">Category</label>
            <select id="move-category" className="input" value={mod.category} onChange={set('category')}>
              <option value="">Select…</option>
              {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label htmlFor="move-description" className="label">Description</label>
          <textarea id="move-description" className="input resize-none" rows={2} value={mod.description} onChange={set('description')} />
        </div>
        <div>
          <label htmlFor="move-link" className="label">Link</label>
          <input id="move-link" className="input" type="url" placeholder="https://…" value={mod.link} onChange={set('link')} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="move-cost" className="label">Cost ({sym})</label>
            <input id="move-cost" className="input" type="number" step="0.01" value={mod.cost} onChange={set('cost')} />
          </div>
          <div role="group" aria-labelledby="move-date-label">
            <span id="move-date-label" className="label">Date installed</span>
            <DateInput value={mod.installedDate} onChange={set('installedDate')} />
          </div>
        </div>
        <div>
          <label htmlFor="move-shop" className="label">Shop / installer</label>
          <input id="move-shop" className="input" placeholder="Self / Shop name" value={mod.shop} onChange={set('shop')} />
        </div>

        <label className="flex items-center gap-2.5 mt-1 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={removeFromWishlist}
            onChange={(e) => setRemoveFromWishlist(e.target.checked)}
            className="size-[18px] rounded-sm accent-accent"
          />
          <span className="text-body text-text-primary">Remove from wishlist after moving</span>
        </label>
      </form>
    </Modal>
  )
}

interface WishlistTabProps {
  car: Car
}

export default function WishlistTab({ car }: WishlistTabProps) {
  const addWishlistItem    = useGarageStore((s) => s.addWishlistItem)
  const updateWishlistItem = useGarageStore((s) => s.updateWishlistItem)
  const deleteWishlistItem = useGarageStore((s) => s.deleteWishlistItem)
  const currency = useGarageStore((s) => s.currency)
  const money    = (amount: number): string => formatMoney(amount, currency)
  const [showForm, setShowForm]       = useState(false)
  const [form, setForm]               = useState<WishlistForm>(emptyForm)
  const [editId, setEditId]           = useState<string | null>(null)
  const [editForm, setEditForm]       = useState<WishlistForm>(emptyForm)
  const [movingItem, setMovingItem]   = useState<WishlistItem | null>(null)
  const [confirmItem, setConfirmItem] = useState<WishlistItem | null>(null)

  const set =
    <K extends keyof WishlistForm>(key: K) =>
    (e: FieldChangeEvent): void =>
      setForm((f) => ({ ...f, [key]: e.target.value }))
  const setEdit =
    <K extends keyof WishlistForm>(key: K) =>
    (e: FieldChangeEvent): void =>
      setEditForm((f) => ({ ...f, [key]: e.target.value }))

  const handleAdd = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!form.name) return
    addWishlistItem(car.id, { ...form, price: form.price ? parseFloat(form.price) : null })
    setForm(emptyForm)
    setShowForm(false)
  }

  const startEdit = (item: WishlistItem) => {
    setEditId(item.id)
    setEditForm({
      name: item.name,
      link: item.link,
      price: item.price != null ? String(item.price) : '',
      category: item.category,
      notes: item.notes,
    })
  }
  const saveEdit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!editId || !editForm.name) return
    updateWishlistItem(car.id, editId, {
      ...editForm,
      price: editForm.price ? parseFloat(editForm.price) : null,
    })
    setEditId(null)
  }

  const markInstalled = (item: WishlistItem) => {
    updateWishlistItem(car.id, item.id, { status: 'installed' })
    setMovingItem(item)
  }

  const totalWanted = car.wishlist.filter((i) => i.status !== 'installed').reduce((s, i) => s + (i.price || 0), 0)

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h3 className="text-subhead font-semibold text-text-primary">Parts Wishlist</h3>
          {car.wishlist.length > 0 && (
            <p className="text-meta text-text-secondary mt-0.5">
              {car.wishlist.length} items · Est. remaining: {money(totalWanted)}
            </p>
          )}
        </div>
        <Button size="sm" onClick={() => setShowForm((v) => !v)}><Plus size={tokens.iconSize.sm} /> Add part</Button>
      </div>

      {/* Add form */}
      {showForm && (
        <form onSubmit={handleAdd} className="card mb-5 space-y-3">
          <h4 className="text-body font-semibold text-text-primary">New part</h4>
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="wishlist-name" className="label">Part name *</label>
              <input id="wishlist-name" className="input" placeholder="Coilover Kit" value={form.name} onChange={set('name')} required />
            </div>
            <div>
              <label htmlFor="wishlist-category" className="label">Category</label>
              <select id="wishlist-category" className="input" value={form.category} onChange={set('category')}>
                <option value="">Select…</option>
                {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="wishlist-link" className="label">Link <span className="text-text-disabled">(optional)</span></label>
              <input id="wishlist-link" className="input" placeholder="https://..." value={form.link} onChange={set('link')} type="url" />
            </div>
            <div>
              <label htmlFor="wishlist-price" className="label">Price</label>
              <input id="wishlist-price" className="input" placeholder="499.99" type="number" step="0.01" value={form.price} onChange={set('price')} />
            </div>
          </div>
          <div>
            <label htmlFor="wishlist-notes" className="label">Notes</label>
            <textarea id="wishlist-notes" className="input resize-none" rows={2} placeholder="Any notes…" value={form.notes} onChange={set('notes')} />
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button type="submit" size="sm">Add part</Button>
          </div>
        </form>
      )}

      {/* List */}
      {car.wishlist.length === 0 ? (
        <div className="text-center py-16 text-text-secondary">
          <ShoppingCart size={tokens.iconSize.xl} className="mx-auto mb-3 opacity-40" aria-hidden />
          <p>No parts on your wishlist yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {car.wishlist.map((item) => editId === item.id ? (
            <form key={item.id} onSubmit={saveEdit} className="card space-y-3 border-accent/30">
              <h4 className="text-body font-semibold text-text-primary">Edit part</h4>
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="wishlist-edit-name" className="label">Part name *</label>
                  <input id="wishlist-edit-name" className="input" value={editForm.name} onChange={setEdit('name')} required autoFocus />
                </div>
                <div>
                  <label htmlFor="wishlist-edit-category" className="label">Category</label>
                  <select id="wishlist-edit-category" className="input" value={editForm.category} onChange={setEdit('category')}>
                    <option value="">Select…</option>
                    {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="wishlist-edit-link" className="label">Link <span className="text-text-disabled">(optional)</span></label>
                  <input id="wishlist-edit-link" className="input" placeholder="https://..." value={editForm.link} onChange={setEdit('link')} type="url" />
                </div>
                <div>
                  <label htmlFor="wishlist-edit-price" className="label">Price</label>
                  <input id="wishlist-edit-price" className="input" placeholder="499.99" type="number" step="0.01" value={editForm.price} onChange={setEdit('price')} />
                </div>
              </div>
              <div>
                <label htmlFor="wishlist-edit-notes" className="label">Notes</label>
                <textarea id="wishlist-edit-notes" className="input resize-none" rows={2} value={editForm.notes} onChange={setEdit('notes')} />
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="secondary" size="sm" onClick={() => setEditId(null)}>
                  <X size={tokens.iconSize.sm} /> Cancel
                </Button>
                <Button type="submit" size="sm">
                  <Check size={tokens.iconSize.sm} /> Save
                </Button>
              </div>
            </form>
          ) : (
            <div key={item.id} className="card flex gap-4 items-start">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-text-primary">{item.name}</span>
                  {item.category && <span className="text-meta text-text-secondary border border-border rounded-sm px-1.5 py-0.5">{item.category}</span>}
                  <Badge status={STATUS[item.status].role}>{STATUS[item.status].label}</Badge>
                </div>
                {item.notes && <p className="text-meta text-text-secondary mt-1">{item.notes}</p>}
                <div className="flex items-center gap-3 mt-2 flex-wrap">
                  {/* V5: price = passive data → text-primary weight (not orange). */}
                  {item.price != null && (
                    <span className="text-body font-semibold text-text-primary">{money(item.price)}</span>
                  )}
                  {item.link && isSafeHref(item.link) && (
                    <a href={item.link} target="_blank" rel="noreferrer"
                      className="inline-flex items-center gap-1 text-meta text-text-secondary hover:text-accent transition-colors">
                      <ExternalLink size={tokens.iconSize.xs} /> View link
                    </a>
                  )}
                  {item.status === 'installed' && (
                    <button
                      type="button"
                      onClick={() => setMovingItem(item)}
                      className="inline-flex items-center gap-1 text-meta font-medium text-accent hover:text-accent-dim transition-colors rounded-sm"
                    >
                      <Wrench size={tokens.iconSize.xs} /> Move to mods
                    </button>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {item.status === 'wanted' && (
                  <IconButton aria-label={`Mark "${item.name}" as ordered`} onClick={() => updateWishlistItem(car.id, item.id, { status: 'ordered' })}>
                    <Package size={tokens.iconSize.sm} />
                  </IconButton>
                )}
                {item.status === 'ordered' && (
                  <IconButton aria-label={`Mark "${item.name}" as installed`} onClick={() => markInstalled(item)}>
                    <CheckCircle2 size={tokens.iconSize.sm} />
                  </IconButton>
                )}
                {item.status === 'installed' && (
                  <IconButton aria-label={`Move "${item.name}" back to wanted`} onClick={() => updateWishlistItem(car.id, item.id, { status: 'wanted' })}>
                    <CheckCircle2 size={tokens.iconSize.sm} />
                  </IconButton>
                )}
                <IconButton aria-label={`Edit part: ${item.name}`} title="Edit" onClick={() => startEdit(item)}>
                  <Pencil size={tokens.iconSize.sm} />
                </IconButton>
                <IconButton aria-label={`Delete part: ${item.name}`} onClick={() => setConfirmItem(item)}>
                  <Trash2 size={tokens.iconSize.sm} />
                </IconButton>
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
