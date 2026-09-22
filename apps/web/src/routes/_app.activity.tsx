import { createFileRoute } from '@tanstack/react-router'
import { useRuns } from '../api/hooks'
import { RunNowButton } from '../components/RunNowButton'
import { Spinner } from '../components/ui/Spinner'
import { RunsList } from '../features/jobs/RunsList'

export const Route = createFileRoute('/_app/activity')({ component: ActivityPage })

/** The search itself — manual trigger and the last runs — kept apart from the jobs it finds. */
function ActivityPage() {
  const runs = useRuns()
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Activity</h1>
        <RunNowButton />
      </div>
      {runs.isLoading && <div className="py-8 text-center text-slate-500"><Spinner /></div>}
      {runs.error && <p className="text-red-600">{runs.error.message}</p>}
      {!runs.isLoading && !runs.error && <RunsList runs={runs.data ?? []} />}
    </div>
  )
}
