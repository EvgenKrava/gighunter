import { ExternalLink } from 'lucide-react'
import type { Match } from '@gighunter/core/schema'
import { Badge } from '../../components/ui/Badge'
import { Details } from '../../components/ui/Details'
import { Skeleton } from '../../components/ui/Skeleton'
import { budgetLabel, timeAgo, verdictTone } from '../../lib/format'
import { FeedbackButtons } from './FeedbackButtons'

export function JobHeader({ match }: { match: Match }) {
  const { job, score, verdict } = match
  const client = job.client
    ? [job.client.country, job.client.rating !== undefined && `★ ${job.client.rating}`, job.client.reviews !== undefined && `${job.client.reviews} reviews`, job.client.paymentVerified ? 'payment verified' : 'unverified'].filter(Boolean).join(' · ')
    : 'client unknown'
  return (
    <header className="space-y-3">
      <div className="flex items-start gap-3">
        <div className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-slate-100 text-lg font-bold dark:bg-slate-800">{score ? score.score : '–'}</div>
        <div className="min-w-0">
          <h1 className="text-lg font-semibold leading-snug">{job.title}</h1>
          <p className="text-sm text-slate-500">{budgetLabel(job.budget)} · {job.platform} · {timeAgo(job.postedAt)}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {verdict && <Badge tone={verdictTone(verdict)}>{verdict}</Badge>}
        {score && <span className="text-slate-500">~{score.estimatedHours}h</span>}
        {match.filterReason && <Badge tone="slate">filtered: {match.filterReason}</Badge>}
        <a href={job.url} target="_blank" rel="noreferrer" className="ml-auto inline-flex min-h-11 items-center gap-1 text-brand"><ExternalLink size={16} />Open on {job.platform}</a>
      </div>
      <Details summary="Job details, assessment and client">
        {score && <p className="mb-2"><span className="font-medium">Why:</span> {score.reasoning}</p>}
        {score && score.risks.length > 0 && <p className="mb-2"><span className="font-medium">Risks:</span> {score.risks.join('; ')}</p>}
        <p className="mb-2"><span className="font-medium">Client:</span> {client}</p>
        {job.skills.length > 0 && <p className="mb-2"><span className="font-medium">Skills:</span> {job.skills.join(', ')}</p>}
        <p className="whitespace-pre-wrap">{job.description}</p>
      </Details>
      <FeedbackButtons matchRef={{ platform: job.platform, externalId: job.externalId }} feedback={match.feedback} />
    </header>
  )
}

export const JobHeaderSkeleton = () => (
  <div className="space-y-3">
    <div className="flex items-start gap-3">
      <Skeleton className="h-12 w-12 shrink-0 rounded-lg" />
      <div className="min-w-0 flex-1 space-y-2 pt-1">
        <Skeleton className="h-5 w-11/12" />
        <Skeleton className="h-5 w-1/2" />
        <Skeleton className="h-3.5 w-2/3" />
      </div>
    </div>
    <div className="flex items-center gap-2">
      <Skeleton className="h-5 w-14 rounded-full" />
      <Skeleton className="h-3.5 w-10" />
      <Skeleton className="ml-auto h-3.5 w-32" />
    </div>
    <Skeleton className="h-11 w-full rounded-lg" />
    <div className="flex gap-2">
      <Skeleton className="h-11 w-24 rounded-lg" />
      <Skeleton className="h-11 w-32 rounded-lg" />
    </div>
  </div>
)
