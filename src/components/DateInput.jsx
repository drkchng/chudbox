import { useRef, useEffect, useState } from 'react'

export default function DateInput({ value = '', onChange, className = '' }) {
  const dayRef   = useRef()
  const monthRef = useRef()
  const yearRef  = useRef()

  // Track the last value we emitted so the useEffect doesn't reset
  // local state while the user is mid-edit (e.g. clearing a field).
  const lastEmitted = useRef(value)

  const [d, setD] = useState(() => value?.slice(8, 10) ?? '')
  const [m, setM] = useState(() => value?.slice(5, 7)  ?? '')
  const [y, setY] = useState(() => value?.slice(0, 4)  ?? '')

  // Only sync from the parent when the parent *externally* changed the value
  // (not when we ourselves emitted it).
  useEffect(() => {
    if (value === lastEmitted.current) return
    lastEmitted.current = value
    if (value && value.length === 10) {
      setY(value.slice(0, 4))
      setM(value.slice(5, 7))
      setD(value.slice(8, 10))
    } else {
      setD(''); setM(''); setY('')
    }
  }, [value])

  const emit = (newD, newM, newY) => {
    if (newD && newM && newY && newY.length === 4) {
      const result = `${newY}-${newM.padStart(2, '0')}-${newD.padStart(2, '0')}`
      lastEmitted.current = result
      onChange(result)
    } else if (!newD && !newM && !newY) {
      lastEmitted.current = ''
      onChange('')
    }
    // If partially filled, don't call onChange — and don't let the
    // useEffect reset us since lastEmitted hasn't changed.
  }

  const focusAndSelect = (ref) => {
    ref.current?.focus()
    ref.current?.select()
  }

  const handleDay = (e) => {
    const raw = e.target.value.replace(/\D/g, '').slice(0, 2)
    if (raw !== '' && Number(raw) > 31) return
    setD(raw)
    emit(raw, m, y)
    // Smart advance: if the digit can't be a valid tens digit, move on immediately
    if (raw.length === 2 || (raw.length === 1 && Number(raw) > 3)) {
      focusAndSelect(monthRef)
    }
  }

  const handleMonth = (e) => {
    const raw = e.target.value.replace(/\D/g, '').slice(0, 2)
    if (raw !== '' && Number(raw) > 12) return
    setM(raw)
    emit(d, raw, y)
    if (raw.length === 2 || (raw.length === 1 && Number(raw) > 1)) {
      focusAndSelect(yearRef)
    }
  }

  const handleYear = (e) => {
    const raw = e.target.value.replace(/\D/g, '').slice(0, 4)
    setY(raw)
    emit(d, m, raw)
  }

  const handleKeyDown = (field, e) => {
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
