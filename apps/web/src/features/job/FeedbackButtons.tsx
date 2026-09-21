import { ThumbsDown, ThumbsUp } from 'lucide-react'
import type { Feedback, MatchRef } from '@gighunter/core/schema'
import { useFeedback } from '../../api/hooks'
import { useToast } from '../../components/Toast'

export function FeedbackButtons({ matchRef, feedback }: { matchRef: MatchRef; feedback?: Feedback }) {
  const m = useFeedback(matchRef)
  const toast = useToast()
  const btn = (value: Feedback, Icon: typeof ThumbsUp, label: string) => (
    <button type="button" aria-pressed={feedback === value} aria-label={label} onClick={() => m.mutate(value, { onError: (e) => toast(e.message, 'error') })}
      className={`inline-flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm ${feedback === value ? 'border-brand bg-indigo-50 text-brand dark:bg-indigo-900/30' : 'border-slate-300 dark:border-slate-700'}`}>
      <Icon size={18} />{label}
    </button>
  )
  return <div className="flex gap-2">{btn('up', ThumbsUp, 'Useful')}{btn('down', ThumbsDown, 'Not for me')}</div>
}
