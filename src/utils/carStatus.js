export const STATUS_CONFIG = {
  current:    { label: 'Current',   class: 'bg-gray-800 text-gray-300 border-gray-700' },
  'for-sale': { label: 'For Sale',  class: 'bg-green-900/60 text-green-300 border-green-700/50' },
  'for-trade':{ label: 'For Trade', class: 'bg-blue-900/60 text-blue-300 border-blue-700/50' },
  sold:       { label: 'Sold',      class: 'bg-red-900/40 text-red-400 border-red-800/50' },
  totaled:    { label: 'Totaled',   class: 'bg-orange-900/50 text-orange-300 border-orange-700/50' },
}

export function getCarStatus(car) {
  if (car.status === 'sold') return 'sold'
  if (car.saleDate && new Date(car.saleDate + 'T12:00:00') <= new Date()) return 'sold'
  return car.status || 'current'
}
