import type { SortDir } from '../utils/groupSort'

interface SortControlsProps<TBy extends string> {
  sortBy: TBy
  sortByOptions: Array<{ value: TBy; label: string }>
  onSortByChange: (value: TBy) => void
  dir: SortDir
  dirLabels: { desc: string; asc: string }
  onDirChange: (dir: SortDir) => void
}

/** Segmented control (what to sort by) + dropdown (direction), shared by the
 *  Mods/Maintenance/Issues tabs. Generic over the sort-by union so each tab
 *  keeps its own literal type. */
export default function SortControls<TBy extends string>({
  sortBy,
  sortByOptions,
  onSortByChange,
  dir,
  dirLabels,
  onDirChange,
}: SortControlsProps<TBy>) {
  return (
    <div className="flex flex-wrap items-center gap-2 mb-4">
      <div className="flex gap-2" role="group" aria-label="Sort by">
        {sortByOptions.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onSortByChange(opt.value)}
            aria-pressed={sortBy === opt.value}
            className={`tab-btn ${sortBy === opt.value ? 'tab-active' : 'tab-inactive'}`}
          >
            {opt.label}
          </button>
        ))}
      </div>
      <select
        className="input w-auto"
        aria-label="Sort direction"
        value={dir}
        onChange={(e) => onDirChange(e.target.value as SortDir)}
      >
        <option value="desc">{dirLabels.desc}</option>
        <option value="asc">{dirLabels.asc}</option>
      </select>
    </div>
  )
}
