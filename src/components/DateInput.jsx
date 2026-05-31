import { useRef, useEffect, useState } from 'react'

export default function DateInput({ value = '', onChange, className = '' }) {
  const dayRef   = useRef()
  const monthRef = useRef()
  const yearRef  = useRef()

  // Keep local state for each segment so partial typing works
  const [d, setD] = useState('')
  const [m, setM] = useState('')
  const [y, setY] = useState('')

  // Sync from parent value (YYYY-MM-DD)
  useEffect(() => {
    if (value && value.length === 10) {
      setY(value.slice(0, 4))
      setM(value.slice(5, 7))
      setD(value.slice(8, 10))
    } else if (!value) {
      setD(''); setM(''); setY('')
    }
  }, [value])

  const emit = (newD, newM, newY) => {
    if (newD && newM && newY && newY.length === 4) {
      onChange(`${newY}-${newM.padStart(2, '0')}-${newD.padStart(2, '0')}`)
    } else if (!newD && !newM && !newY) {
      onChange('')
    }
  }

  const handleDay = (e) => {
    const raw = e.target.value.replace(/\D/g, '').slice(0, 2)
    if (raw !== '' && Number(raw) > 31) return
    setD(raw)
    emit(raw, m, y)
    if (raw.length === 2) monthRef.current?.focus()
  }

  const handleMonth = (e) => {
    const raw = e.target.value.replace(/\D/g, '').slice(0, 2)
    if (raw !== '' && Number(raw) > 12) return
    setM(raw)
    emit(d, raw, y)
    if (raw.length === 2) yearRef.current?.focus()
  }

  const handleYear = (e) => {
    const raw = e.target.value.replace(/\D/g, '').slice(0, 4)
    setY(raw)
    emit(d, m, raw)
  }

  const handleKeyDown = (field, e) => {
    if (e.key === 'Backspace') {
      if (field === 'month' && m === '') { e.preventDefault(); dayRef.current?.focus() }
      if (field === 'year'  && y === '') { e.preventDefault(); monthRef.current?.focus() }
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
        className={`${seg} w-12`}
        maxLength={4}
      />
    </div>
  )
}
