import { useRef, useState } from 'react'
import type { ChangeEvent, KeyboardEvent, RefObject } from 'react'

interface DateInputProps {
  value?: string
  onChange: (value: string) => void
  className?: string
}

export default function DateInput({ value = '', onChange, className = '' }: DateInputProps) {
  const dayRef   = useRef<HTMLInputElement | null>(null)
  const monthRef = useRef<HTMLInputElement | null>(null)
  const yearRef  = useRef<HTMLInputElement | null>(null)

  const [d, setD] = useState<string>(() => value.slice(8, 10))
  const [m, setM] = useState<string>(() => value.slice(5, 7))
  const [y, setY] = useState<string>(() => value.slice(0, 4))

  // Adjust local segments during render when the parent changes `value` (e.g. a
  // reset). When we emit a value ourselves we advance `prevValue` in emit() so
  // this sync is skipped and the user's unpadded input is preserved. This is
  // React's recommended way to sync state to a prop without an effect.
  const [prevValue, setPrevValue] = useState<string>(value)
  if (value !== prevValue) {
    setPrevValue(value)
    if (value.length === 10) {
      setY(value.slice(0, 4))
      setM(value.slice(5, 7))
      setD(value.slice(8, 10))
    } else {
      setD(''); setM(''); setY('')
    }
  }

  const emit = (newD: string, newM: string, newY: string): void => {
    if (newD && newM && newY && newY.length === 4) {
      const result = `${newY}-${newM.padStart(2, '0')}-${newD.padStart(2, '0')}`
      setPrevValue(result)
      onChange(result)
    } else if (!newD && !newM && !newY) {
      setPrevValue('')
      onChange('')
    }
    // If partially filled, don't call onChange — value stays unchanged, so the
    // render-time sync above is skipped (prevValue is unchanged too).
  }

  const focusAndSelect = (ref: RefObject<HTMLInputElement | null>): void => {
    ref.current?.focus()
    ref.current?.select()
  }

  const handleDay = (e: ChangeEvent<HTMLInputElement>): void => {
    const raw = e.target.value.replace(/\D/g, '').slice(0, 2)
    if (raw !== '' && Number(raw) > 31) return
    setD(raw)
    emit(raw, m, y)
    // Smart advance: if the digit can't be a valid tens digit, move on immediately
    if (raw.length === 2 || (raw.length === 1 && Number(raw) > 3)) {
      focusAndSelect(monthRef)
    }
  }

  const handleMonth = (e: ChangeEvent<HTMLInputElement>): void => {
    const raw = e.target.value.replace(/\D/g, '').slice(0, 2)
    if (raw !== '' && Number(raw) > 12) return
    setM(raw)
    emit(d, raw, y)
    if (raw.length === 2 || (raw.length === 1 && Number(raw) > 1)) {
      focusAndSelect(yearRef)
    }
  }

  const handleYear = (e: ChangeEvent<HTMLInputElement>): void => {
    const raw = e.target.value.replace(/\D/g, '').slice(0, 4)
    setY(raw)
    emit(d, m, raw)
  }

  const handleKeyDown = (field: 'month' | 'year', e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Backspace') {
      if (field === 'month' && m === '') { e.preventDefault(); focusAndSelect(dayRef) }
      if (field === 'year'  && y === '') { e.preventDefault(); focusAndSelect(monthRef) }
    }
  }

  const seg = 'bg-transparent text-center text-sm text-gray-200 focus:outline-none focus:text-accent placeholder-gray-600 caret-accent'

  return (
    <div className={`flex items-center bg-surface-2 border border-border rounded-lg px-3 py-2 gap-1 focus-within:border-accent/60 transition-colors ${className}`}>
      <input
        ref={dayRef}
        type="text"
        inputMode="numeric"
        placeholder="DD"
        value={d}
        onChange={handleDay}
        onFocus={(e) => e.target.select()}
        className={`${seg} w-7`}
        maxLength={2}
      />
      <span className="text-gray-600 select-none text-sm">/</span>
      <input
        ref={monthRef}
        type="text"
        inputMode="numeric"
        placeholder="MM"
        value={m}
        onChange={handleMonth}
        onKeyDown={(e) => handleKeyDown('month', e)}
        onFocus={(e) => e.target.select()}
        className={`${seg} w-7`}
        maxLength={2}
      />
      <span className="text-gray-600 select-none text-sm">/</span>
      <input
        ref={yearRef}
        type="text"
        inputMode="numeric"
        placeholder="YYYY"
        value={y}
        onChange={handleYear}
        onKeyDown={(e) => handleKeyDown('year', e)}
        onFocus={(e) => e.target.select()}
        className={`${seg} w-12`}
        maxLength={4}
      />
    </div>
  )
}
