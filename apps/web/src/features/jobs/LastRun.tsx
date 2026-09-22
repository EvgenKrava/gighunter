import { Link } from '@tanstack/react-router'
import { ChevronRight } from 'lucide-react'
import type { Run } from '@gighunter/core/schema'
import { timeAgo } from '../../lib/format'

/** One line under the Jobs title: when the search last ran and what it brought, linking to Activity. */
export function LastRun({ runs }: { runs: Run[] | undefined }) {
  if (!runs) return null
  const cls = 'inline-flex min-h-11 items-center gap-1 text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
  const latest = runs[0]
  if (!latest) return <Link to="/activity" className={cls}>No searches yet<ChevronRight size={16} /></Link>
  const stats = Object.values(latest.perPlatform)
  const sum = (k: 'new' | 'notified') => stats.reduce((n, s) => n + s[k], 0)
  const issues = latest.errors.length
  return (
    <Link to="/activity" className={cls}>
      Last search {timeAgo(latest.startedAt)} · {sum('new')} new · {sum('notified')} notified
      {issues > 0 && <span className="text-amber-700 dark:text-amber-300"> · {issues} issue{issues > 1 ? 's' : ''}</span>}
      <ChevronRight size={16} />
    </Link>
  )
}
