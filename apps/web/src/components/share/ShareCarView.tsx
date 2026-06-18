import { useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Camera, Wrench, ClipboardList, ExternalLink, Calendar, X, Eye } from 'lucide-react'
import { shareImgPath, formatMileage } from '@chudbox/shared'
import type {
  DistanceUnitCode,
  PublicCarSnapshot,
  PublicMaintenance,
  PublicMod,
  PublicPhoto,
} from '@chudbox/shared'
import { STATUS_CONFIG } from '../../utils/carStatus'
import CarHero from '../CarHero'
import MileageText from '../MileageText'

/**
 * Read-only public build viewer. Driven ENTIRELY by the allowlisted
 * PublicCarSnapshot (which structurally omits every excluded field — see
 * publicSnapshot.ts) plus the share token used to build token-scoped image
 * URLs. No store, no auth, no edit controls — it reuses the owner page's visual
 * idioms (CarHero, the tab bar, the card layouts) without any mutation paths.
 */

interface ShareCarViewProps {
  car: PublicCarSnapshot
  /** The share token from the route — turns a photoId into a token-scoped image URL. */
  token: string
}

type TabId = 'photos' | 'mods' | 'maintenance'

interface TabDef {
  id: TabId
  label: string
  icon: LucideIcon
  count: number
}

const fmtDay = (d: string): string => new Date(`${d}T12:00:00`).toLocaleDateString()

export function PhotoGrid({ photos, token }: { photos: PublicPhoto[]; token: string }) {
  const [lightbox, setLightbox] = useState<PublicPhoto | null>(null)
  if (photos.length === 0) {
    return <p className="text-center text-gray-600 py-10">No photos shared.</p>
  }
  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
        {photos.map((photo) => (
          <button
            key={photo.photoId}
            className="relative group rounded-xl overflow-hidden bg-surface-2 aspect-square cursor-pointer text-left"
            onClick={() => setLightbox(photo)}
          >
            <img
              src={shareImgPath(token, photo.photoId)}
              alt={photo.caption || 'Photo'}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            />
            {photo.caption && (
              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent px-2 py-1.5">
                <p className="text-xs text-white truncate">{photo.caption}</p>
              </div>
            )}
          </button>
        ))}
      </div>

      {lightbox && (
        <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4" onClick={() => setLightbox(null)}>
          <button className="absolute top-4 right-4 text-white hover:text-gray-300" aria-label="Close"><X size={24} /></button>
          <img
            src={shareImgPath(token, lightbox.photoId)}
            alt={lightbox.caption || 'Photo'}
            className="max-w-full max-h-full rounded-lg object-contain"
            onClick={(e) => e.stopPropagation()}
          />
          {lightbox.caption && <p className="absolute bottom-6 text-white text-sm">{lightbox.caption}</p>}
        </div>
      )}
    </>
  )
}

function ModList({ mods }: { mods: PublicMod[] }) {
  if (mods.length === 0) {
    return (
      <div className="text-center py-16 text-gray-600">
        <Wrench size={36} className="mx-auto mb-3 opacity-40" />
        <p>No modifications shared.</p>
      </div>
    )
  }
  const grouped = mods.reduce<Record<string, PublicMod[]>>((acc, mod) => {
    const key = mod.category || 'Other'
    if (!acc[key]) acc[key] = []
    acc[key].push(mod)
    return acc
  }, {})
  return (
    <div className="space-y-6">
      {Object.entries(grouped).map(([category, group]) => (
        <div key={category}>
          <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-2">{category}</h4>
          <div className="space-y-2">
            {group.map((mod, i) => (
              <div key={`${mod.name}-${i}`} className="card">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-white">{mod.name}</span>
                </div>
                {mod.description && <p className="text-xs text-gray-400 mt-1">{mod.description}</p>}
                <div className="flex gap-3 mt-1.5 text-xs text-gray-600 flex-wrap items-center">
                  {mod.installedDate && <span>{fmtDay(mod.installedDate)}</span>}
                  {mod.link && (
                    <a href={mod.link} target="_blank" rel="noreferrer"
                      className="flex items-center gap-1 text-blue-400 hover:text-blue-300 transition-colors">
                      <ExternalLink size={11} /> View Link
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function MaintenanceList({ records, unit }: { records: PublicMaintenance[]; unit: DistanceUnitCode }) {
  if (records.length === 0) {
    return (
      <div className="text-center py-16 text-gray-600">
        <ClipboardList size={36} className="mx-auto mb-3 opacity-40" />
        <p>No maintenance records shared.</p>
      </div>
    )
  }
  const sorted = [...records].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
  return (
    <div className="space-y-3">
      {sorted.map((rec, i) => (
        <div key={`${rec.service}-${i}`} className="card">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-white">{rec.service}</span>
          </div>
          <div className="flex gap-3 mt-1.5 text-xs text-gray-500 flex-wrap">
            {rec.date && <span className="flex items-center gap-1"><Calendar size={10} />{fmtDay(rec.date)}</span>}
            <MileageText raw={rec.mileageRaw} miles={rec.mileageMiles} unit={unit} />
          </div>
          {(rec.nextDueDate || rec.nextDueMileageRaw) && (
            <p className="text-xs text-gray-600 mt-1">
              Next:{' '}
              {rec.nextDueDate ? fmtDay(rec.nextDueDate) : ''}
              {rec.nextDueDate && rec.nextDueMileageRaw ? ' / ' : ''}
              {formatMileage(rec.nextDueMileageRaw, rec.nextDueMileageMiles, unit) ?? ''}
            </p>
          )}
        </div>
      ))}
    </div>
  )
}

export default function ShareCarView({ car, token }: ShareCarViewProps) {
  const unit = car.settings.distanceUnit
  const statusCfg = STATUS_CONFIG[car.status] ?? STATUS_CONFIG.current
  const coverSrc = car.coverPhotoId ? shareImgPath(token, car.coverPhotoId) : ''

  const tabs: TabDef[] = [
    { id: 'photos',      label: 'Photos',      icon: Camera,        count: car.photos.length },
    { id: 'mods',        label: 'Mods',        icon: Wrench,        count: car.mods.length },
    { id: 'maintenance', label: 'Maintenance', icon: ClipboardList, count: car.maintenance.length },
  ]
  const firstWithContent = tabs.find((t) => t.count > 0)?.id ?? 'photos'
  const [tab, setTab] = useState<TabId>(firstWithContent)

  return (
    <div className="min-h-screen bg-dark">
      <CarHero
        coverSrc={coverSrc}
        topLeft={
          <span className="absolute top-4 left-4 badge bg-dark/90 border border-white/10 text-gray-300">
            <Eye size={11} className="mr-1" /> Read-only shared build
          </span>
        }
        actions={
          <span className="absolute top-4 right-4 text-sm font-bold tracking-tight text-white/70">
            Chudbox
          </span>
        }
        meta={
          <>
            <span className={`badge border text-xs ${statusCfg.class}`}>{statusCfg.label}</span>
            {car.purchaseDate && (
              <span className="text-xs text-gray-500">Owned since {fmtDay(car.purchaseDate)}</span>
            )}
            {car.status === 'sold' && car.saleDate && (
              <span className="text-xs text-gray-500">Sold {fmtDay(car.saleDate)}</span>
            )}
          </>
        }
        title={<>{car.year} {car.make} {car.model}</>}
        subline={
          <>
            {car.trim && <span className="text-sm text-gray-300">{car.trim}</span>}
            {car.color && <span className="text-sm text-gray-400">· {car.color}</span>}
            {car.mileageRaw && (
              <span className="text-sm text-gray-400">· <MileageText raw={car.mileageRaw} miles={car.mileageMiles} unit={unit} /></span>
            )}
            {car.nickname && <span className="text-sm text-accent font-medium">· "{car.nickname}"</span>}
          </>
        }
      />

      {/* Tab bar */}
      <div className="border-b border-border bg-surface/30 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex gap-1 py-2 overflow-x-auto no-scrollbar" style={{ scrollbarWidth: 'none' }}>
            {tabs.map(({ id: tid, label, icon: Icon }) => (
              <button
                key={tid}
                onClick={() => setTab(tid)}
                className={`tab-btn flex items-center gap-1.5 ${tab === tid ? 'tab-active' : 'tab-inactive'}`}
              >
                <Icon size={14} />
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Tab content */}
      <div className="max-w-7xl mx-auto px-6 py-8">
        {tab === 'photos'      && <PhotoGrid photos={car.photos} token={token} />}
        {tab === 'mods'        && <ModList mods={car.mods} />}
        {tab === 'maintenance' && <MaintenanceList records={car.maintenance} unit={unit} />}
      </div>
    </div>
  )
}
