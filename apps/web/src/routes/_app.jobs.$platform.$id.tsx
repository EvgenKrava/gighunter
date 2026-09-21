import { createFileRoute, Link, notFound } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { PlatformSchema } from '@gighunter/core/schema'
import { DEFAULT_QUICK_ACTIONS } from '@gighunter/core/prompts'
import { useMatch, usePrompts } from '../api/hooks'
import { Spinner } from '../components/ui/Spinner'
import { ChatPanel } from '../features/job/ChatPanel'
import { JobHeader } from '../features/job/JobHeader'

export const Route = createFileRoute('/_app/jobs/$platform/$id')({
  beforeLoad: ({ params }) => { if (!PlatformSchema.safeParse(params.platform).success) throw notFound() },
  component: JobPage,
})

function JobPage() {
  const { platform, id } = Route.useParams()
  const ref = { platform: PlatformSchema.parse(platform), externalId: id }
  const q = useMatch(ref)
  const prompts = usePrompts()
  const quickActions = prompts.data?.overrides.quickActions ?? prompts.data?.defaults.quickActions ?? DEFAULT_QUICK_ACTIONS
  if (q.isLoading) return <div className="py-8 text-center text-slate-500"><Spinner /></div>
  if (q.error || !q.data) return <p className="text-red-600">{q.error?.message ?? 'Job not found'}</p>
  return (
    <div className="space-y-5">
      <Link to="/jobs" search={{ status: 'notified' }} className="inline-flex min-h-11 items-center gap-1 text-sm text-slate-500"><ArrowLeft size={16} />All jobs</Link>
      <JobHeader match={q.data.match} />
      <ChatPanel matchRef={ref} chat={q.data.chat} quickActions={quickActions} />
    </div>
  )
}
