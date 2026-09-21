import { useEffect, useState } from 'react'
import type { SettingsPatch } from '@gighunter/core/schema'
import { useRemoveToken, useSaveToken, type PublicSettings } from '../../api/hooks'
import { useToast } from '../../components/Toast'
import { Card } from '../../components/ui/Card'
import { Details } from '../../components/ui/Details'
import { Field } from '../../components/ui/Field'
import { TextInput } from '../../components/ui/Inputs'
import { Toggle } from '../../components/ui/Toggle'
import { TokenInput } from './TokenInput'

export function FreelancerBlock({ settings, onPatch }: { settings: PublicSettings; onPatch: (p: SettingsPatch) => void }) {
  const save = useSaveToken('freelancer'); const remove = useRemoveToken('freelancer')
  const toast = useToast()
  const f = settings.platforms.freelancer
  const [query, setQuery] = useState(f.query)
  useEffect(() => setQuery(f.query), [f.query])
  const wrap = <T,>(p: Promise<T>) => p.then((r) => { toast('Saved', 'success'); return r }).catch((e) => { toast(e.message, 'error'); throw e })
  return (
    <Card className="space-y-3">
      <h2 className="text-lg font-semibold">Freelancer.com</h2>
      <Details summary="How to get an API token">
        <ol className="list-decimal space-y-1 pl-4">
          <li>Sign in and open <a className="underline" href="https://www.freelancer.com/developers" target="_blank" rel="noreferrer">freelancer.com/developers</a> → create an app.</li>
          <li>Generate an OAuth token for your own account.</li>
          <li>Paste it below — we verify it against your account.</li>
        </ol>
      </Details>
      <TokenInput label="Freelancer token" placeholder="oauth token" tokenSet={f.tokenSet} tokenHint={f.tokenHint}
        onSave={(token) => wrap(save.mutateAsync(token))} onRemove={() => wrap(remove.mutateAsync())} />
      {f.tokenSet && (
        <div className="space-y-3 text-sm">
          <p>Connected as {f.connectedAs} ✓</p>
          <Toggle label="Poll Freelancer.com" checked={f.enabled} onChange={(enabled) => onPatch({ platforms: { freelancer: { enabled } } })} />
          <Field label="Search query" hint="Sent to the Freelancer search API every poll, e.g. “typescript react node”">
            <TextInput value={query} onChange={(e) => setQuery(e.target.value)} onBlur={() => query !== f.query && onPatch({ platforms: { freelancer: { query } } })} enterKeyHint="done" />
          </Field>
        </div>
      )}
    </Card>
  )
}
