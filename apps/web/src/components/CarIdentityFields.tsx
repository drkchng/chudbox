import { AlertTriangle, Eye, EyeOff } from 'lucide-react'
import { vinHint } from '@chudbox/shared'

/**
 * DEC-13 (VIN) + DEC-19 (plate) — the car's private identity fields, shared by
 * AddCarModal and EditCarModal so the two forms stay identical.
 *
 * Both are PRIVATE by default. VIN is purpose-gated (it surfaces ONLY on a
 * For-Sale listing share, so buyers can run a history check). The plate is the
 * INVERSE — owner-opt-in via `showPlate`: hidden unless the owner flips the
 * toggle (then it shows on every share). Neither is ever exposed by the curated
 * showcase or the crawler/OG preview.
 *
 * VIN validation is a LIGHT nudge (vinHint) — never a hard block; the value is
 * stored verbatim.
 */
interface CarIdentityFieldsProps {
  /** Namespaces the input ids so add/edit forms don't collide (e.g. 'add-car'). */
  idPrefix: string
  vin: string
  plate: string
  showPlate: boolean
  onVin: (value: string) => void
  onPlate: (value: string) => void
  onShowPlate: (value: boolean) => void
}

export default function CarIdentityFields({
  idPrefix,
  vin,
  plate,
  showPlate,
  onVin,
  onPlate,
  onShowPlate,
}: CarIdentityFieldsProps) {
  const hint = vinHint(vin)

  return (
    <div className="border-t border-border pt-4 space-y-3">
      <div>
        <p className="text-xs font-semibold text-text-tertiary uppercase tracking-widest">Identity</p>
        <p className="mt-1 text-meta text-text-secondary">
          Private to you. The VIN appears only on a For-Sale listing share; the plate stays hidden unless
          you turn it on below.
        </p>
      </div>

      <div>
        <label htmlFor={`${idPrefix}-vin`} className="label">
          VIN <span className="text-text-disabled">(optional)</span>
        </label>
        <input
          id={`${idPrefix}-vin`}
          className="input font-mono uppercase"
          value={vin}
          onChange={(e) => onVin(e.target.value)}
          placeholder="1HGCM82633A004352"
          maxLength={32}
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          aria-describedby={hint ? `${idPrefix}-vin-hint` : undefined}
        />
        {hint && (
          <p
            id={`${idPrefix}-vin-hint`}
            className="mt-1 flex items-center gap-1.5 text-meta text-warning-fg"
          >
            <AlertTriangle size={12} aria-hidden /> {hint}
          </p>
        )}
      </div>

      <div>
        <label htmlFor={`${idPrefix}-plate`} className="label">
          License plate <span className="text-text-disabled">(optional)</span>
        </label>
        <input
          id={`${idPrefix}-plate`}
          className="input uppercase"
          value={plate}
          onChange={(e) => onPlate(e.target.value)}
          placeholder="ABC 1234"
          maxLength={16}
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
        />
      </div>

      {/* showPlate consent — an accessible switch (role="switch" + aria-checked),
          never colour alone: it carries an explicit on/off label + icon. */}
      <button
        type="button"
        role="switch"
        aria-checked={showPlate}
        onClick={() => onShowPlate(!showPlate)}
        className="flex w-full items-center justify-between gap-3 rounded-lg border border-border bg-surface-2 px-3 py-2.5 text-left transition-colors hover:border-accent/40"
      >
        <span className="flex min-w-0 items-center gap-2">
          {showPlate ? (
            <Eye size={15} aria-hidden className="shrink-0 text-accent" />
          ) : (
            <EyeOff size={15} aria-hidden className="shrink-0 text-text-tertiary" />
          )}
          <span className="min-w-0">
            <span className="block text-body font-medium text-text-primary">Show plate on shares</span>
            <span className="block text-meta text-text-secondary">
              {showPlate ? 'Your plate appears on shared builds.' : 'Your plate stays private.'}
            </span>
          </span>
        </span>
        <span
          aria-hidden
          className={`relative h-6 w-10 shrink-0 rounded-full transition-colors ${
            showPlate ? 'bg-accent' : 'bg-border'
          }`}
        >
          <span
            className={`absolute top-0.5 size-5 rounded-full bg-surface transition-all ${
              showPlate ? 'left-[1.125rem]' : 'left-0.5'
            }`}
          />
        </span>
      </button>
    </div>
  )
}
