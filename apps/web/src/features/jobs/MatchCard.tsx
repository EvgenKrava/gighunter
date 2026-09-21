import { Link } from '@tanstack/react-router'
import { ThumbsDown, ThumbsUp } from 'lucide-react'
import type { Match } from '@gighunter/core/schema'
import { Badge } from '../../components/ui/Badge'
import { budgetLabel, timeAgo, verdictTone } from '../../lib/format'

const platformLabel = { freelancer: 'Freelancer', upwork: 'Upwork' } as const

export function MatchCard({ match }: { match: Match }) {
  const { job, score, verdict, feedback } = match
  return (
    <article className="relative rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-start gap-3">
        <div className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-slate-100 text-lg font-bold dark:bg-slate-800">{score ? score.score : '–'}</div>
        <div className="min-w-0 flex-1">
          <Link to="/jobs/$platform/$id" params={{ platform: job.platform, id: job.externalId }} className="block text-base font-semibold leading-snug after:absolute after:inset-0 after:content-[''] hover:underline">{job.title}</Link>
          <p className="mt-0.5 text-sm text-slate-500">{budgetLabel(job.budget)} · {platformLabel[job.platform]}</p>
        </div>
        {feedback && <span aria-label={feedback === 'up' ? 'Marked useful' : 'Marked not for me'} className="text-slate-400">{feedback === 'up' ? <ThumbsUp size={18} /> : <ThumbsDown size={18} />}</span>}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
        {verdict && <Badge tone={verdictTone(verdict)}>{verdict}</Badge>}
        {score && <span className="text-slate-500">~{score.estimatedHours}h</span>}
        {match.filterReason && <Badge tone="slate">{match.filterReason}</Badge>}
        <span className="ml-auto text-slate-400">{timeAgo(job.postedAt)}</span>
      </div>
      {score?.reasoning && <p className="mt-2 line-clamp-2 text-sm text-slate-600 dark:text-slate-300">{score.reasoning}</p>}
      {score && score.risks.length > 0 && <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">{score.risks.length} risk{score.risks.length > 1 ? 's' : ''}: {score.risks.join('; ')}</p>}
    </article>
  )
}
