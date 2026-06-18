import { useState, useEffect, useRef } from 'react'
import type { KeyboardEvent } from 'react'
import { useParams, useNavigate, useLocation, Link } from 'react-router-dom'
import type { LucideIcon } from 'lucide-react'
import { ArrowLeft, Pencil, Trash2, Camera, ShoppingCart, Wrench, ClipboardList, CheckSquare, AlertTriangle, Settings, FileDown, DollarSign, Share2, Gauge } from 'lucide-react'
import useGarageStore from '../store/useGarageStore'
import { authClient } from '../auth/client'
import { getCarStatus, STATUS_CONFIG } from '../utils/carStatus'
import { resolvePhotoSrc } from '../utils/image'
import { formatCurrentMileage, formatMoney } from '../utils/units'
import { carDueMaintenance } from '../utils/maintenanceDue'
import { downloadMarkdown } from '../utils/exportMarkdown'
import PhotosTab from '../components/tabs/PhotosTab'
import WishlistTab from '../components/tabs/WishlistTab'
import ModsTab from '../components/tabs/ModsTab'
import MaintenanceTab from '../components/tabs/MaintenanceTab'
import MileageTab from '../components/tabs/MileageTab'
import TodoTab from '../components/tabs/TodoTab'
import IssuesTab from '../components/tabs/IssuesTab'
import EditCarModal from '../components/EditCarModal'
import MarkAsSoldModal from '../components/MarkAsSoldModal'
import SettingsPanel from '../components/SettingsPanel'
import ConfirmModal from '../components/ConfirmModal'
import CarHero from '../components/CarHero'
import ShareDialog from '../components/ShareDialog'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import IconButton from '../components/ui/IconButton'
import DueBadge from '../components/DueBadge'
import type { CarStatus, StatusRole } from '../types'

type TabId = 'photos' | 'wishlist' | 'mods' | 'maintenance' | 'mileage' | 'todos' | 'issues'

interface TabDef {
  id: TabId
  label: string
  icon: LucideIcon
}

const TABS: TabDef[] = [
  { id: 'photos',      label: 'Photos',       icon: Camera },
  { id: 'wishlist',    label: 'Wishlist',      icon: ShoppingCart },
  { id: 'mods',        label: 'Mods',          icon: Wrench },
  { id: 'maintenance', label: 'Maintenance',   icon: ClipboardList },
  { id: 'mileage',     label: 'Mileage',       icon: Gauge },
  { id: 'todos',       label: 'To-Do',         icon: CheckSquare },
  { id: 'issues',      label: 'Issues',        icon: AlertTriangle },
]

// Car status → design-system status role (canonical map, shared with CarCard):
// current/sold = neutral, for-sale = success, for-trade = info, totaled = warning.
// Orange is reclaimed for action/current/alert — the open-issues count is the
// lone alert (danger). Used for the hero status Badge + the bottom-right alerts.
const STATUS_ROLE: Record<CarStatus, StatusRole> = {
  current: 'neutral',
  'for-sale': 'success',
  'for-trade': 'info',
  sold: 'neutral',
  totaled: 'warning',
}

const fmtDay = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString()

export default function CarProfile() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  // DEC-4 (U1) log-first: AddCarModal navigates here with `focusLog` right after
  // a car is created, signalling the Mods tab to open + focus its add-mod form.
  // Read once at mount (frozen) so it doesn't re-fire on every render.
  const [autoFocusAdd] = useState(
    () => Boolean((location.state as { focusLog?: boolean } | null)?.focusLog),
  )
  const car          = useGarageStore((s) => s.cars.find((c) => c.id === id))
  const deleteCar    = useGarageStore((s) => s.deleteCar)
  const currency     = useGarageStore((s) => s.currency)
  const distanceUnit = useGarageStore((s) => s.distanceUnit)
  // Sharing requires the car to live in the owner's DO, so it is offered only
  // when signed in. The probe never gates rendering — logged out simply hides
  // the button (the app stays fully local-first).
  const { data: session } = authClient.useSession()
  const signedIn = Boolean(session?.user)
  const [tab, setTab] = useState<TabId>('mods')
  // DEC-16: the toolbar "Log mileage" action jumps to the Mileage tab and opens
  // its log form (cleared whenever the user picks any tab themselves).
  const [autoLog, setAutoLog] = useState(false)
  const changeTab = (next: TabId) => { setAutoLog(false); setTab(next) }
  const [editing, setEditing]             = useState(false)
  const [showSettings, setShowSettings]   = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [showSell, setShowSell]           = useState(false)
  const [showShare, setShowShare]         = useState(false)

  // U3 sticky identity: the condensed back + year/make/model fades into the
  // sticky tab bar once the hero has scrolled up under it. A zero-height sentinel
  // sits just above the sticky bar; when it passes behind the bar the hero is
  // gone, so we reveal the identity. IntersectionObserver keeps it off the
  // scroll thread (no per-frame work).
  const sentinelRef = useRef<HTMLDivElement>(null)
  const [condensed, setCondensed] = useState(false)
  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const io = new IntersectionObserver(
      ([entry]) => setCondensed(!entry.isIntersecting),
      { rootMargin: '-56px 0px 0px 0px', threshold: 0 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  // A14 roving tabs: arrow/Home/End move focus between tabs and activate them
  // (automatic activation). Only the selected tab is in the tab order
  // (tabIndex 0); the rest are -1 and reached via arrows.
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])
  const onTabKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = TABS.length - 1
    let next: number
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown': next = index === last ? 0 : index + 1; break
      case 'ArrowLeft':
      case 'ArrowUp':   next = index === 0 ? last : index - 1; break
      case 'Home':      next = 0; break
      case 'End':       next = last; break
      default: return
    }
    e.preventDefault()
    changeTab(TABS[next].id)
    tabRefs.current[next]?.focus()
  }

  if (!car) {
    return (
      <div className="min-h-screen bg-dark flex items-center justify-center">
        <div className="text-center">
          <p className="text-text-secondary mb-4">Car not found.</p>
          <Button variant="secondary" onClick={() => navigate('/')}>
            <ArrowLeft size={16} /> Back to garage
          </Button>
        </div>
      </div>
    )
  }

  const coverPhoto   = car.photos.find((p) => p.id === car.coverPhoto) || car.photos[0]
  const coverSrc     = coverPhoto ? resolvePhotoSrc(coverPhoto) : ''
  const openIssues   = car.issues.filter((i) => i.status !== 'resolved').length
  const pendingTodos = car.todos.filter((t) => !t.done).length
  const status       = getCarStatus(car)
  const statusCfg    = STATUS_CONFIG[status]
  // DEC-16: current mileage = the latest check-in (scalar mirror as fallback).
  const mileageText  = formatCurrentMileage(car, car.mileageMiles, distanceUnit)
  const due          = carDueMaintenance(car)
  const carLabel     = `${car.year} ${car.make} ${car.model}`
  const askingPrice  =
    status === 'for-sale' && car.salePrice ? formatMoney(Number(car.salePrice), currency) : ''

  const handleDelete = () => {
    if (!id) return
    deleteCar(id)
    navigate('/')
  }

  return (
    <div className="min-h-screen bg-dark">
      {/* Hero banner (banner landmark) */}
      <header>
        <CarHero
          coverSrc={coverSrc}
          topLeft={
            <Link
              to="/"
              className="absolute top-4 left-4 inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface/85 px-3.5 py-2 text-body font-semibold text-text-primary transition-colors hover:border-accent/50 hover:text-accent focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
            >
              <ArrowLeft size={16} aria-hidden /> Garage
            </Link>
          }
          meta={
            <>
              <Badge status={STATUS_ROLE[status]}>{statusCfg.label}</Badge>
              {/* V5: price = passive data → primary weight, not orange. */}
              {askingPrice && (
                <span className="text-body font-semibold text-text-primary">{askingPrice}</span>
              )}
              {car.purchaseDate && (
                <span className="text-meta text-text-secondary">Owned since {fmtDay(car.purchaseDate)}</span>
              )}
              {status === 'sold' && car.saleDate && (
                <span className="text-meta text-text-secondary">Sold {fmtDay(car.saleDate)}</span>
              )}
            </>
          }
          title={<>{carLabel}</>}
          subline={
            <>
              {car.trim && <span className="text-meta text-text-secondary">{car.trim}</span>}
              {car.color && <span className="text-meta text-text-secondary">· {car.color}</span>}
              {mileageText && <span className="text-meta text-text-secondary">· {mileageText}</span>}
              {/* V5: nickname = identity → italic text-secondary, not orange. */}
              {car.nickname && <span className="text-meta italic text-text-secondary">· “{car.nickname}”</span>}
            </>
          }
          belowTitle={
            status === 'for-trade' && car.tradeFor ? (
              <p className="mt-1.5 max-w-xs text-meta text-text-secondary">
                Trade for: {car.tradeFor.split('\n').filter(Boolean).join(', ')}
              </p>
            ) : undefined
          }
          bottomRight={
            due.count > 0 || openIssues > 0 || pendingTodos > 0 ? (
              <>
                {/* U2: surface overdue/due maintenance in the hero cluster too. */}
                <DueBadge due={due} />
                {openIssues > 0 && (
                  <Badge status="danger">{openIssues} issue{openIssues > 1 ? 's' : ''}</Badge>
                )}
                {pendingTodos > 0 && (
                  <Badge status="neutral">{pendingTodos} to-do{pendingTodos > 1 ? 's' : ''}</Badge>
                )}
              </>
            ) : undefined
          }
        />
      </header>

      {/* Owner action toolbar — full-width row so the 44px controls never crowd
          the hero on mobile; scrolls horizontally when it overflows. */}
      <div className="border-b border-border bg-surface/30">
        <div className="max-w-7xl mx-auto px-6 py-2.5 flex items-center gap-2 overflow-x-auto no-scrollbar justify-start md:justify-end">
          <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
            <Pencil size={16} aria-hidden /> Edit
          </Button>
          {/* DEC-16: mileage is a quick action, not a fixed edit field. */}
          <Button variant="secondary" size="sm" onClick={() => { setAutoLog(true); setTab('mileage') }}>
            <Gauge size={16} aria-hidden /> Log mileage
          </Button>
          {signedIn && (
            <Button variant="secondary" size="sm" onClick={() => setShowShare(true)} title="Share this build">
              <Share2 size={16} aria-hidden /> Share
            </Button>
          )}
          {status === 'for-sale' && (
            <Button variant="secondary" size="sm" onClick={() => setShowSell(true)}>
              <DollarSign size={16} aria-hidden /> Sold
            </Button>
          )}
          <IconButton aria-label="Export to Markdown" variant="secondary" title="Export to Markdown" onClick={() => downloadMarkdown(car, distanceUnit)}>
            <FileDown size={16} aria-hidden />
          </IconButton>
          <IconButton aria-label="Settings" variant="secondary" title="Settings" onClick={() => setShowSettings(true)}>
            <Settings size={16} aria-hidden />
          </IconButton>
          <IconButton aria-label="Delete car" variant="danger" title="Delete car" onClick={() => setConfirmDelete(true)}>
            <Trash2 size={16} aria-hidden />
          </IconButton>
        </div>
      </div>

      {/* Sentinel: when this scrolls behind the sticky bar, reveal the identity. */}
      <div ref={sentinelRef} aria-hidden className="h-px" />

      {/* Sticky tab bar — carries the condensed back + identity (U3) and the
          tablist (A14). bg is near-opaque so scrolled content reads under it. */}
      <div className="sticky top-0 z-20 border-b border-border bg-surface/95">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex items-center">
            {/* Condensed identity: back chevron + truncated car, revealed on scroll.
                Collapses to zero width (no layout jank) until the hero is gone. */}
            <div
              aria-hidden={!condensed}
              className={`flex min-w-0 items-center gap-2 overflow-hidden transition-all duration-200 ease-out motion-reduce:transition-none ${condensed ? 'max-w-[60%] pr-3 opacity-100' : 'max-w-0 opacity-0 pointer-events-none'}`}
            >
              <Link
                to="/"
                aria-label="Back to garage"
                tabIndex={condensed ? 0 : -1}
                className="inline-flex size-9 shrink-0 items-center justify-center rounded-md text-text-secondary transition-colors hover:text-accent focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
              >
                <ArrowLeft size={18} aria-hidden />
              </Link>
              <span className="truncate text-body font-semibold text-text-primary">{carLabel}</span>
            </div>

            {/* A14: real tablist with aria-selected + roving arrow keys. */}
            <div
              role="tablist"
              aria-label="Car details"
              aria-orientation="horizontal"
              className="flex flex-1 gap-1 py-2 overflow-x-auto no-scrollbar"
              style={{ scrollbarWidth: 'none' }}
            >
              {TABS.map(({ id: tid, label, icon: Icon }, i) => {
                const selected = tab === tid
                return (
                  <button
                    key={tid}
                    ref={(el) => { tabRefs.current[i] = el }}
                    role="tab"
                    id={`tab-${tid}`}
                    aria-selected={selected}
                    aria-controls={`panel-${tid}`}
                    tabIndex={selected ? 0 : -1}
                    onClick={() => changeTab(tid)}
                    onKeyDown={(e) => onTabKeyDown(e, i)}
                    className={`tab-btn flex items-center gap-1.5 ${selected ? 'tab-active' : 'tab-inactive'}`}
                  >
                    <Icon size={14} aria-hidden />
                    {label}
                    {/* Issues count = alert → danger tokens. */}
                    {tid === 'issues' && openIssues > 0 && (
                      <span className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-pill bg-danger px-1 text-meta font-semibold leading-none text-danger-fg">
                        {openIssues}
                      </span>
                    )}
                    {/* To-do count = passive → neutral, NOT orange (reclaimed). */}
                    {tid === 'todos' && pendingTodos > 0 && (
                      <span className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-pill bg-surface-2 px-1 text-meta font-semibold leading-none text-text-secondary">
                        {pendingTodos}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Tab content (main landmark). Each panel is wired to its tab via
          aria-labelledby; panels contain focusable controls so the panel itself
          needs no tabindex. */}
      <main className="max-w-7xl mx-auto px-6 py-8">
        <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
          {tab === 'photos'      && <PhotosTab car={car} />}
          {tab === 'wishlist'    && <WishlistTab car={car} />}
          {tab === 'mods'        && <ModsTab car={car} autoFocusAdd={autoFocusAdd} />}
          {tab === 'maintenance' && <MaintenanceTab car={car} />}
          {tab === 'mileage'     && <MileageTab car={car} autoLog={autoLog} />}
          {tab === 'todos'       && <TodoTab car={car} />}
          {tab === 'issues'      && <IssuesTab car={car} />}
        </div>
      </main>

      {showSell     && <MarkAsSoldModal car={car} onClose={() => setShowSell(false)} />}
      {editing      && <EditCarModal car={car} onClose={() => setEditing(false)} />}
      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
      {showShare && (
        <ShareDialog
          carId={car.id}
          carLabel={carLabel}
          onClose={() => setShowShare(false)}
        />
      )}
      {confirmDelete && (
        <ConfirmModal
          title={`Delete ${carLabel}?`}
          message="All photos, mods, maintenance records, todos, and issues will be permanently deleted."
          onConfirm={handleDelete}
          onClose={() => setConfirmDelete(false)}
        />
      )}
    </div>
  )
}
