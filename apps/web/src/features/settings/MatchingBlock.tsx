import { useState } from 'react'
import { KNOWN_MODELS, type SettingsPatch } from '@gighunter/core/schema'
import type { PublicSettings } from '../../api/hooks'
import { Card } from '../../components/ui/Card'
import { Field } from '../../components/ui/Field'
import { NumberInput, Select } from '../../components/ui/Inputs'

export function MatchingBlock({ settings, onPatch }: { settings: PublicSettings; onPatch: (p: SettingsPatch) => void }) {
  const [threshold, setThreshold] = useState(settings.notifyThreshold)
  const [age, setAge] = useState<number | undefined>(settings.maxJobAgeHours)
  const models = KNOWN_MODELS.some((m) => m.id === settings.model) ? KNOWN_MODELS : [...KNOWN_MODELS, { id: settings.model, label: settings.model }]
  return (
    <Card className="space-y-3">
      <h2 className="text-lg font-semibold">Matching & AI</h2>
      <Field label={`Notify when score ≥ ${threshold}`} hint="Jobs below this are stored as “scored” but not sent">
        <input type="range" min={0} max={100} step={5} value={threshold} aria-label="Notify threshold" className="mt-2 w-full accent-brand" onChange={(e) => setThreshold(Number(e.target.value))} onMouseUp={() => onPatch({ notifyThreshold: threshold })} onTouchEnd={() => onPatch({ notifyThreshold: threshold })} onKeyUp={() => onPatch({ notifyThreshold: threshold })} />
      </Field>
      <Field label="Ignore jobs older than (hours)"><NumberInput value={age} onChange={setAge} min={1} max={168} onBlur={() => age && age !== settings.maxJobAgeHours && onPatch({ maxJobAgeHours: age })} /></Field>
      <Field label="Scoring model" hint="Haiku is the cheapest and fast enough for scoring">
        <Select value={settings.model} onChange={(e) => onPatch({ model: e.target.value })}>{models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</Select>
      </Field>
      <Field label="Chat model" hint="A stronger model writes better proposals; cost is per message">
        <Select value={settings.chatModel} onChange={(e) => onPatch({ chatModel: e.target.value })}>{models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</Select>
      </Field>
    </Card>
  )
}
