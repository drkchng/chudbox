import { useState } from 'react'
import { Camera, ClipboardList, Fingerprint, Repeat2, Tag, Wrench } from 'lucide-react'
import { formatMoney, shareImgPath, tokens } from '@chudbox/shared'
import type { CarStatus, ListingCarSnapshot, StatusRole } from '@chudbox/shared'
import { STATUS_CONFIG } from '../../utils/carStatus'
import CarHero from '../CarHero'
import MileageText from '../MileageText'
import Badge from '../ui/Badge'
import {
  DetailTabBar,
  MaintenanceList,
  ModList,
  PhotoGrid,
  ShareShell,
} from './ShareCarView'
import type { ShareTab } from './ShareCarView'

/**
 * Read-only FOR-SALE LISTING viewer ('listing' scope — DEC-14). Driven ENTIRELY
 * by the ListingCarSnapshot the server built from the link's STORED scope: the
 * curated showcase PLUS the buyer-facing listing fields (salePrice + its entered
 * currency tag, tradeFor, the listing-only VIN) and the owner-opt-in plate +
 * consent-gated seller name. The snapshot is the LEAK GATE — this view only
 * renders fields that are PRESENT (resolve-with-fallback, never assumes a field
 * exists). It withholds the full-only data (wishlist/to-dos/issues, cost/shop/
 * notes) by simply never receiving it.
 *
 * Shares the redesigned chrome + curated detail lists with ShareCarView so the
 * showcase and the listing stay pixel-identical where they overlap; the extra
 * For-Sale treatment lives in the hero + a dedicated listing strip.
 */
interface ShareCarViewListingProps {
  car: ListingCarSnapshot
  /** The share token from the route — turns a photoId into a token-scoped image URL. */
  token: string
}

type TabId = 'mods' | 'maintenance'

const fmtDay = (d: string): string => new Date(`${d}T12:00:00`).toLocaleDateString()

const STATUS_ROLE: Record<CarStatus, StatusRole> = {
  current: 'neutral',
  'for-sale': 'success',
  'for-trade': 'info',
  sold: 'neutral',
  totaled: 'warning',
}

/**
 * Format the asking price in its ENTERED currency (DEC-1 fidelity — the listing
 * carries the salePriceCurrency tag, NOT the viewer's setting). Falls back to the
 * raw string if it isn't a finite number or the tag is missing.
 */
function formatAskingPrice(car: ListingCarSnapshot): string | null {
  const raw = car.salePrice
  if (raw === undefined || raw === '') return null
  const amount = Number(raw)
  if (car.salePriceCurrency && Number.isFinite(amount)) {
    return formatMoney(amount, car.salePriceCurrency)
  }
  return raw
}

export default function ShareCarViewListing({ car, token }: ShareCarViewListingProps) {
  const unit = car.settings.distanceUnit
  const coverSrc = car.coverPhotoId ? shareImgPath(token, car.coverPhotoId) : ''
  const price = formatAskingPrice(car)

  const tabs: ShareTab<TabId>[] = [
    { id: 'mods', label: 'Mods', icon: Wrench },
    { id: 'maintenance', label: 'Maintenance', icon: ClipboardList },
  ]
  const [tab, setTab] = useState<TabId>(
    car.mods.length === 0 && car.maintenance.length > 0 ? 'maintenance' : 'mods',
  )

  return (
    <ShareShell>
      <CarHero
        coverSrc={coverSrc}
        topLeft={
          <div className="absolute left-4 top-4">
            <Badge status="success" icon={Tag}>
              For sale
            </Badge>
          </div>
        }
        meta={
          <>
            <Badge status={STATUS_ROLE[car.status] ?? 'neutral'}>
              {(STATUS_CONFIG[car.status] ?? STATUS_CONFIG.current).label}
            </Badge>
            {/* DEC-10: seller name — present iff the server resolved consent on. */}
            {car.ownerName && (
              <span className="text-meta text-text-secondary">Seller: {car.ownerName}</span>
            )}
            {price && (
              <span className="text-body font-semibold text-text-primary">{price}</span>
            )}
            {car.purchaseDate && (
              <span className="text-meta text-text-secondary">Owned since {fmtDay(car.purchaseDate)}</span>
            )}
          </>
        }
        title={
          <>
            {car.year} {car.make} {car.model}
          </>
        }
        subline={
          <>
            {car.trim && <span className="text-body text-text-secondary">{car.trim}</span>}
            {car.color && <span className="text-body text-text-secondary">· {car.color}</span>}
            {car.mileageRaw && (
              <span className="text-body text-text-secondary">
                · <MileageText raw={car.mileageRaw} miles={car.mileageMiles} unit={unit} />
              </span>
            )}
            {car.nickname && (
              <span className="text-body italic text-text-secondary">· “{car.nickname}”</span>
            )}
          </>
        }
        belowTitle={
          /* DEC-19: plate present iff the owner opted in (showPlate). */
          car.plate ? (
            <p className="mt-1.5 text-meta text-text-tertiary">
              Plate <span className="font-mono text-text-secondary">{car.plate}</span>
            </p>
          ) : undefined
        }
      />

      {/* For-Sale details strip — the buyer-facing listing fields. Each renders
          only when the snapshot carries it (the snapshot is the gate). */}
      {(price || car.tradeFor || car.vin) && (
        <section
          aria-label="For-sale details"
          className="border-b border-border bg-surface/40"
        >
          <div className="mx-auto grid w-full max-w-7xl gap-4 px-6 py-5 sm:grid-cols-3">
            {price && (
              <div>
                <p className="text-meta uppercase tracking-widest text-text-tertiary">Asking price</p>
                <p className="mt-1 inline-flex items-center gap-1.5 text-title font-bold text-text-primary">
                  <Tag size={tokens.iconSize.sm} className="text-text-tertiary" aria-hidden />
                  {price}
                </p>
              </div>
            )}
            {car.tradeFor && (
              <div>
                <p className="text-meta uppercase tracking-widest text-text-tertiary">Open to trades</p>
                <p className="mt-1 inline-flex items-start gap-1.5 text-body text-text-secondary">
                  <Repeat2 size={tokens.iconSize.sm} className="mt-0.5 shrink-0 text-text-tertiary" aria-hidden />
                  {car.tradeFor.split('\n').filter(Boolean).join(', ')}
                </p>
              </div>
            )}
            {car.vin && (
              <div>
                <p className="text-meta uppercase tracking-widest text-text-tertiary">VIN</p>
                <p className="mt-1 inline-flex items-center gap-1.5 font-mono text-body text-text-secondary">
                  <Fingerprint size={tokens.iconSize.sm} className="text-text-tertiary" aria-hidden />
                  {car.vin}
                </p>
              </div>
            )}
          </div>
        </section>
      )}

      {/* DEC-8: lead with photos — the gallery is the showcase. */}
      {car.photos.length > 0 && (
        <section aria-labelledby="gallery-heading" className="mx-auto w-full max-w-7xl px-6 pt-8">
          <div className="mb-4 flex items-center gap-2">
            <Camera size={tokens.iconSize.md} className="text-text-tertiary" aria-hidden />
            <h2 id="gallery-heading" className="text-subhead font-semibold text-text-primary">
              Gallery
            </h2>
            <span className="text-meta text-text-secondary">
              {car.photos.length} photo{car.photos.length === 1 ? '' : 's'}
            </span>
          </div>
          <PhotoGrid photos={car.photos} token={token} />
        </section>
      )}

      <DetailTabBar tabs={tabs} current={tab} onSelect={setTab} className="mt-8" />
      <div className="mx-auto w-full max-w-7xl px-6 py-8">
        {tab === 'mods' && <ModList mods={car.mods} />}
        {tab === 'maintenance' && <MaintenanceList records={car.maintenance} unit={unit} />}
      </div>
    </ShareShell>
  )
}
