import { Link } from '@tanstack/react-router'
import type { MatchStatus } from '@gighunter/core/schema'
import { statusLabel } from '../../lib/format'

const STATUS_ORDER = ['notified', 'pending', 'scored', 'filtered'] as const satisfies readonly MatchStatus[]

export function StatusChips({ current }: { current: MatchStatus }) {
  return (
    <div className="flex flex-wrap gap-2" role="tablist" aria-label="Job status">
      {STATUS_ORDER.map((s) => (
        <Link key={s} to="/jobs" search={{ status: s }} role="tab" aria-selected={s === current}
          className={`min-h-11 rounded-full border px-3 text-sm font-medium ${s === current ? 'border-brand bg-brand text-white' : 'border-slate-300 text-slate-700 dark:border-slate-700 dark:text-slate-200'} inline-flex items-center`}>
          {statusLabel(s)}
        </Link>
      ))}
    </div>
  )
}
