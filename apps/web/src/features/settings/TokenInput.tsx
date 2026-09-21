import { useState } from 'react'
import { Button } from '../../components/ui/Button'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { TextInput } from '../../components/ui/Inputs'

export function TokenInput({ label, placeholder, tokenSet, tokenHint, onSave, onRemove }: { label: string; placeholder: string; tokenSet: boolean; tokenHint?: string; onSave: (token: string) => Promise<unknown>; onRemove: () => Promise<unknown> }) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const run = async (fn: () => Promise<unknown>) => { setBusy(true); try { await fn(); setValue('') } finally { setBusy(false) } }
  if (tokenSet) {
    return (
      <div className="flex items-center gap-3">
        <span className="text-sm">✓ {label} set <span className="font-mono text-slate-500">···{tokenHint ?? '????'}</span></span>
        <Button variant="ghost" size="sm" className="ml-auto text-red-700" onClick={() => setConfirm(true)}>Remove</Button>
        <ConfirmDialog open={confirm} title={`Remove ${label}?`} body="Polling and notifications that depend on it stop until you add a new one." confirmLabel="Remove token" danger onCancel={() => setConfirm(false)} onConfirm={() => { setConfirm(false); void run(onRemove) }} />
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
      <TextInput aria-label={label} className="mt-0 flex-1 font-mono" type="password" autoComplete="off" placeholder={placeholder} value={value} onChange={(e) => setValue(e.target.value)} />
      <Button onClick={() => run(() => onSave(value.trim()))} disabled={value.trim().length < 10} loading={busy}>Save token</Button>
    </div>
  )
}
