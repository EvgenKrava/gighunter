import { Play } from 'lucide-react'
import { useRunNow } from '../api/hooks'
import { useToast } from './Toast'
import { Button } from './ui/Button'

export function RunNowButton({ compact }: { compact?: boolean }) {
  const run = useRunNow()
  const toast = useToast()
  const onClick = () => run.mutate(undefined, { onSuccess: () => toast('Search queued — results in ~30 s', 'success'), onError: (e) => toast(e.message, 'error') })
  return (
    <Button variant={compact ? 'ghost' : 'secondary'} size={compact ? 'sm' : 'md'} onClick={onClick} loading={run.isPending} aria-label="Run search now" title="Run search now">
      <Play size={16} />{!compact && 'Run now'}
    </Button>
  )
}
