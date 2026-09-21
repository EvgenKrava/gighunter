import { createFileRoute } from '@tanstack/react-router'
import { usePatchSettings, useSettings } from '../api/hooks'
import { useToast } from '../components/Toast'
import { Spinner } from '../components/ui/Spinner'
import { CostControls } from '../features/settings/CostControls'
import { FreelancerBlock } from '../features/settings/FreelancerBlock'
import { MatchingBlock } from '../features/settings/MatchingBlock'
import { PromptsBlock } from '../features/settings/PromptsBlock'
import { TelegramBlock } from '../features/settings/TelegramBlock'
import { UpworkBlock } from '../features/settings/UpworkBlock'

export const Route = createFileRoute('/_app/settings')({ component: SettingsPage })

function SettingsPage() {
  const settings = useSettings()
  const patch = usePatchSettings()
  const toast = useToast()
  if (settings.isLoading || !settings.data) return <div className="py-8 text-center text-slate-500">{settings.error ? <span className="text-red-600">{settings.error.message}</span> : <Spinner />}</div>
  const onPatch = (p: Parameters<typeof patch.mutate>[0]) => patch.mutate(p, { onSuccess: () => toast('Saved', 'success'), onError: (e) => toast(e.message, 'error') })
  const s = settings.data
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Settings</h1>
      <CostControls settings={s} onPatch={onPatch} />
      <TelegramBlock settings={s} onPatch={onPatch} />
      <FreelancerBlock settings={s} onPatch={onPatch} />
      <UpworkBlock />
      <MatchingBlock settings={s} onPatch={onPatch} />
      <PromptsBlock />
    </div>
  )
}
