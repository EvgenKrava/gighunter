import { createFileRoute } from '@tanstack/react-router'
import { MatchStatusSchema } from '@gighunter/core/schema'
import { useMatches, useRuns } from '../api/hooks'
import { Button } from '../components/ui/Button'
import { Spinner } from '../components/ui/Spinner'
import { MatchCard } from '../features/jobs/MatchCard'
import { RunsList } from '../features/jobs/RunsList'
import { StatusChips } from '../features/jobs/StatusChips'

export const Route = createFileRoute('/_app/jobs/')({
  validateSearch: (s: Record<string, unknown>) => ({ status: MatchStatusSchema.catch('notified').parse(s.status) }),
  component: JobsPage,
})

const empty = {
  notified: 'Nothing delivered yet. Matches above your threshold land here after they reach Telegram.',
  pending: 'Nothing waiting to be sent.',
  scored: 'No jobs below the threshold yet.',
  filtered: 'Nothing filtered out yet.',
}

function JobsPage() {
  const { status } = Route.useSearch()
  const matches = useMatches(status)
  const runs = useRuns()
  const items = matches.data?.pages.flatMap((p) => p.items) ?? []
  return (
    <div className="space-y-6">
      <StatusChips current={status} />
      {matches.isLoading && <div className="py-8 text-center text-slate-500"><Spinner /></div>}
      {matches.error && <p className="text-red-600">{matches.error.message}</p>}
      {!matches.isLoading && items.length === 0 && <p className="text-slate-500">{empty[status]}</p>}
      <div className="space-y-3">{items.map((m) => <MatchCard key={`${m.job.platform}#${m.job.externalId}`} match={m} />)}</div>
      {matches.hasNextPage && <Button variant="secondary" className="w-full" onClick={() => matches.fetchNextPage()} loading={matches.isFetchingNextPage}>Load more</Button>}
      <section>
        <h2 className="mb-2 text-lg font-semibold">Recent runs</h2>
        {runs.isLoading && <div className="py-8 text-center text-slate-500"><Spinner /></div>}
        {runs.error && <p className="text-red-600">{runs.error.message}</p>}
        {!runs.isLoading && !runs.error && <RunsList runs={runs.data ?? []} />}
      </section>
    </div>
  )
}
