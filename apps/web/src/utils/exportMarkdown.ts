import { getCarStatus, STATUS_CONFIG } from './carStatus'
import { formatMileage } from './units'
import type { DistanceUnitCode } from './units'
import type { StoredCar, Issue } from '../types'

const fmt = (dateStr?: string | null): string => {
  if (!dateStr) return '—'
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-CA', {
    year: 'numeric', month: 'short', day: 'numeric',
  })
}

const money = (val: number | null | undefined): string =>
  val != null ? `$${val.toFixed(2)}` : '—'
const dash = (val: string | null | undefined): string => (val ? String(val) : '—')

// Pad table columns so Obsidian renders them cleanly
function table(headers: string[], rows: string[][]): string {
  if (rows.length === 0) return '_None recorded._\n'
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ? String(r[i]).length : 1)))
  )
  const pad = (s: string, w: number): string => s.padEnd(w)
  const divider = widths.map((w) => '-'.repeat(w)).join(' | ')
  const header  = headers.map((h, i) => pad(h, widths[i])).join(' | ')
  const body    = rows.map((r) => r.map((c, i) => pad(c ?? '', widths[i])).join(' | '))
  return ['| ' + header + ' |', '| ' + divider + ' |', ...body.map((r) => '| ' + r + ' |')].join('\n') + '\n'
}

export function generateMarkdown(car: StoredCar, distanceUnit: DistanceUnitCode): string {
  const status      = getCarStatus(car)
  const statusLabel = STATUS_CONFIG[status]?.label ?? status
  const title       = `${car.year} ${car.make} ${car.model}${car.trim ? ' ' + car.trim : ''}`
  const mileageText = formatMileage(car.mileage, car.mileageMiles, distanceUnit)
  const totalMods   = car.mods.reduce((s, m) => s + (m.cost || 0), 0)
  const totalMaint  = car.maintenance.reduce((s, r) => s + (r.cost || 0), 0)
  const openIssues     = car.issues.filter((i) => i.status !== 'resolved')
  const resolvedIssues = car.issues.filter((i) => i.status === 'resolved')

  // ── Frontmatter ─────────────────────────────────────────────────────────────
  const frontmatter = [
    '---',
    `title: "${title}"`,
    `year: ${car.year}`,
    `make: ${car.make}`,
    `model: ${car.model}`,
    car.trim     ? `trim: ${car.trim}`         : null,
    car.color    ? `color: ${car.color}`        : null,
    car.mileage  ? `mileage: ${car.mileage}`    : null,
    car.nickname ? `nickname: "${car.nickname}"`: null,
    `status: ${statusLabel}`,
    car.purchaseDate ? `purchased: ${fmt(car.purchaseDate)}` : null,
    car.saleDate     ? `sold: ${fmt(car.saleDate)}`          : null,
    `tags: [chudbox, car, ${car.make.toLowerCase()}]`,
    `exported: ${fmt(new Date().toISOString().slice(0, 10))}`,
    '---',
  ].filter(Boolean).join('\n')

  // ── Header ───────────────────────────────────────────────────────────────────
  const header = [
    `# ${title}`,
    '',
    `> [!info] Overview`,
    `> **Status:** ${statusLabel}${status === 'for-sale' && car.salePrice ? `  ·  Asking $${Number(car.salePrice).toLocaleString()}` : ''}`,
    mileageText  ? `> **Mileage:** ${mileageText}` : null,
    car.color    ? `> **Color:** ${car.color}` : null,
    car.nickname ? `> **Nickname:** "${car.nickname}"` : null,
    car.purchaseDate ? `> **Purchased:** ${fmt(car.purchaseDate)}` : null,
    status === 'for-trade' && car.tradeFor
      ? `> **Trade for:** ${car.tradeFor.split('\n').filter(Boolean).join(', ')}`
      : null,
  ].filter(Boolean).join('\n')

  // ── Mods ─────────────────────────────────────────────────────────────────────
  const modsRows = [...car.mods]
    .sort((a, b) => (a.category || '').localeCompare(b.category || ''))
    .map((m) => [
      dash(m.name),
      dash(m.category),
      money(m.cost),
      fmt(m.installedDate),
      dash(m.shop),
      m.link ? `[Link](${m.link})` : '—',
    ])

  const modsSection = [
    '## Mods',
    '',
    table(
      ['Part', 'Category', 'Cost', 'Date Installed', 'Shop', 'Link'],
      modsRows
    ),
    car.mods.length > 0 ? `**Total invested:** ${money(totalMods)}` : '',
  ].join('\n')

  // ── Maintenance ───────────────────────────────────────────────────────────────
  const maintRows = [...car.maintenance]
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    .map((r) => [
      dash(r.service),
      fmt(r.date),
      formatMileage(r.mileage, r.mileageMiles, distanceUnit) ?? '—',
      money(r.cost),
      dash(r.shop),
      r.nextDueDate || r.nextDueMileage
        ? [r.nextDueDate ? fmt(r.nextDueDate) : null, formatMileage(r.nextDueMileage, r.nextDueMileageMiles, distanceUnit)].filter(Boolean).join(' / ')
        : '—',
    ])

  const maintSection = [
    '## Maintenance Log',
    '',
    table(
      ['Service', 'Date', 'Mileage', 'Cost', 'Shop', 'Next Due'],
      maintRows
    ),
    car.maintenance.length > 0 ? `**Total spent:** ${money(totalMaint)}` : '',
  ].join('\n')

  // ── Issues ────────────────────────────────────────────────────────────────────
  const renderIssue = (issue: Issue): string => {
    const checkbox = issue.status === 'resolved' ? '- [x]' : '- [ ]'
    const severity = issue.severity ? ` *(${issue.severity[0].toUpperCase() + issue.severity.slice(1)})*` : ''
    const inProgress = issue.status === 'in-progress' ? ' 🔧' : ''
    const lines = [`${checkbox} **${issue.title}**${severity}${inProgress}`]
    if (issue.description) lines.push(`  > ${issue.description}`)
    const meta = [
      `Opened: ${fmt(issue.createdAt.slice(0, 10))}`,
      issue.resolvedAt ? `Resolved: ${fmt(issue.resolvedAt.slice(0, 10))}` : null,
    ].filter(Boolean).join('  ·  ')
    lines.push(`  <sub>${meta}</sub>`)
    return lines.join('\n')
  }

  const issuesSection = [
    '## Issues',
    '',
    openIssues.length > 0
      ? ['### Open', '', ...openIssues.map(renderIssue)].join('\n')
      : '### Open\n\n_No open issues._',
    '',
    resolvedIssues.length > 0
      ? ['### Resolved', '', ...resolvedIssues.map(renderIssue)].join('\n')
      : '',
  ].filter((s) => s !== '').join('\n')

  return [frontmatter, header, modsSection, maintSection, issuesSection].join('\n\n') + '\n'
}

export function downloadMarkdown(car: StoredCar, distanceUnit: DistanceUnitCode): void {
  const content  = generateMarkdown(car, distanceUnit)
  const filename = `${car.year}-${car.make}-${car.model}${car.trim ? '-' + car.trim : ''}`
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9-]/g, '') + '.md'
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
