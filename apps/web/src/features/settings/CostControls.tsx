import { POLL_INTERVAL_OPTIONS, type SettingsPatch } from '@gighunter/core/schema'
import type { PublicSettings } from '../../api/hooks'
import { Card } from '../../components/ui/Card'
import { Field } from '../../components/ui/Field'
import { Select } from '../../components/ui/Inputs'
import { Toggle } from '../../components/ui/Toggle'

const label = (m: number) => (m < 60 ? `Every ${m} min` : m === 60 ? 'Every hour' : m < 1440 ? `Every ${m / 60} hours` : 'Daily')

export function CostControls({ settings, onPatch }: { settings: PublicSettings; onPatch: (p: SettingsPatch) => void }) {
  return (
    <Card className="space-y-3">
      <h2 className="text-lg font-semibold">Job search</h2>
      <Toggle label={settings.active ? 'Job search is ON' : 'Job search is OFF'} checked={settings.active} onChange={(active) => onPatch({ active })} />
      <Field label="Poll every" hint="Longer intervals mean fewer API and model calls. “Run now” always works.">
        <Select value={settings.pollIntervalMinutes} onChange={(e) => onPatch({ pollIntervalMinutes: Number(e.target.value) })}>
          {POLL_INTERVAL_OPTIONS.map((m) => <option key={m} value={m}>{label(m)}</option>)}
        </Select>
      </Field>
      {settings.lastPolledAt && <p className="text-xs text-slate-500">Last polled {new Date(settings.lastPolledAt).toLocaleString()}</p>}
    </Card>
  )
}
