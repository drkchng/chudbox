import type { ReactNode } from 'react'
import { Car } from 'lucide-react'

/**
 * Presentational hero banner shared by the owner CarProfile and the read-only
 * public share viewer. It owns ONLY the visual shell (the 56-tall banner, the
 * cover-image-or-placeholder, the gradient, and the title-block layout); every
 * piece of content — and crucially every owner-only control — is passed in as a
 * slot, so the share viewer simply omits the edit/delete/price slots rather
 * than threading a `readOnly` flag through edit logic.
 */
export interface CarHeroProps {
  /** Resolved cover image src (already token-scoped for the public viewer); '' → placeholder. */
  coverSrc: string
  /** Top-left affordance (owner: back button; viewer: a brand/read-only chip). */
  topLeft?: ReactNode
  /** Top-right actions (owner only — share/edit/delete/etc.). */
  actions?: ReactNode
  /** Status badge + inline meta row (the `flex` row above the title). */
  meta: ReactNode
  /** The car title (year / make / model). */
  title: ReactNode
  /** The detail row under the title (trim / color / mileage / nickname). */
  subline?: ReactNode
  /** An extra line below the title block (owner: trade-for note). */
  belowTitle?: ReactNode
  /** Bottom-right badges (owner: open issues / pending todos). */
  bottomRight?: ReactNode
}

export default function CarHero({
  coverSrc,
  topLeft,
  actions,
  meta,
  title,
  subline,
  belowTitle,
  bottomRight,
}: CarHeroProps) {
  return (
    <div className="relative h-56 bg-surface-2 overflow-hidden">
      {coverSrc ? (
        <img src={coverSrc} alt="cover" className="w-full h-full object-cover opacity-60" />
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          <Car size={64} className="text-gray-700" />
        </div>
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-dark via-dark/60 to-transparent" />

      {topLeft}
      {actions}

      {/* Car info */}
      <div className="absolute bottom-5 left-6">
        <div className="flex items-center gap-2 mb-1.5">{meta}</div>
        <h1 className="text-3xl font-bold text-white leading-tight">{title}</h1>
        {subline && <div className="flex items-center gap-3 mt-1 flex-wrap">{subline}</div>}
        {belowTitle}
      </div>

      {bottomRight && (
        <div className="absolute bottom-5 right-6 flex gap-2 flex-wrap justify-end">{bottomRight}</div>
      )}
    </div>
  )
}
