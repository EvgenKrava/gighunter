import type { Run } from '@gighunter/core/schema'
import { Details } from '../../components/ui/Details'
import { Skeleton } from '../../components/ui/Skeleton'
import { timeAgo } from '../../lib/format'

const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))

export function RunsList({ runs }: { runs: Run[] }) {
  if (!runs.length) return <p className="text-sm text-slate-500">No runs yet — press “Run now” or wait for the next scheduled poll.</p>
  return (
    <ul className="space-y-2">
      {runs.map((r) => (
        <li key={r.startedAt} className="rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-800">
          <div className="flex items-center gap-2">
            <span className="font-medium">{timeAgo(r.startedAt)}</span>
            <span className="text-slate-500">· {r.trigger}</span>
            <span className="ml-auto text-slate-500">{k(r.usage.inputTokens + r.usage.outputTokens)} tokens</span>
          </div>
          {Object.entries(r.perPlatform).map(([p, s]) => (
            <p key={p} className="mt-1 text-slate-600 dark:text-slate-300">
              <span className="font-medium">{p}</span>: {s.fetched} fetched · {s.new} new · {s.filtered} filtered · {s.scored} scored · {s.notified} notified{s.error && <span className="text-red-600"> · {s.error}</span>}
            </p>
          ))}
          {r.errors.length > 0 && (
            <div className="mt-2"><Details summary={`${r.errors.length} issue${r.errors.length > 1 ? 's' : ''}`}><ul className="list-disc pl-4">{r.errors.map((e, i) => <li key={i} className="break-all">{e}</li>)}</ul></Details></div>
          )}
        </li>
      ))}
    </ul>
  )
}

export const RunsListSkeleton = () => (
  <ul className="space-y-2">
    {[0, 1, 2].map((i) => (
      <li key={i} className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
        <div className="flex items-center gap-2">
          <Skeleton className="h-3.5 w-16" />
          <Skeleton className="h-3.5 w-12" />
          <Skeleton className="ml-auto h-3.5 w-14" />
        </div>
        <Skeleton className="mt-2.5 h-3.5 w-3/4" />
      </li>
    ))}
  </ul>
)
