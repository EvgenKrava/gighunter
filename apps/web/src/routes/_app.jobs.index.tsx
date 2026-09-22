import { createFileRoute } from '@tanstack/react-router'
import { MatchStatusSchema } from '@gighunter/core/schema'
import { useMatches, useRuns } from '../api/hooks'
import { Button } from '../components/ui/Button'
import { SkeletonPage } from '../components/ui/Skeleton'
import { LastRun } from '../features/jobs/LastRun'
import { MatchCard, MatchCardSkeleton } from '../features/jobs/MatchCard'
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
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Jobs</h1>
        <LastRun runs={runs.data} />
      </div>
      <StatusChips current={status} />
      {matches.isLoading && <SkeletonPage className="space-y-3">{[0, 1, 2].map((i) => <MatchCardSkeleton key={i} />)}</SkeletonPage>}
      {matches.error && <p className="text-red-600">{matches.error.message}</p>}
      {!matches.isLoading && items.length === 0 && <p className="text-slate-500">{empty[status]}</p>}
      <div className="space-y-3">{items.map((m) => <MatchCard key={`${m.job.platform}#${m.job.externalId}`} match={m} />)}</div>
      {matches.hasNextPage && <Button variant="secondary" className="w-full" onClick={() => matches.fetchNextPage()} loading={matches.isFetchingNextPage}>Load more</Button>}
    </div>
  )
}
