import { useState, type KeyboardEvent } from 'react'
import { X } from 'lucide-react'
import { inputClass } from './Inputs'

export function TagInput({ value, onChange, placeholder, normalize = (s) => s.trim().toLowerCase() }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string; normalize?: (s: string) => string }) {
  const [draft, setDraft] = useState('')
  const add = (raw: string) => {
    const tag = normalize(raw)
    setDraft('')
    if (tag && !value.includes(tag)) onChange([...value, tag])
  }
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(draft) }
    else if (e.key === 'Backspace' && !draft && value.length) onChange(value.slice(0, -1))
  }
  return (
    <div className={`${inputClass} flex min-h-11 flex-wrap items-center gap-1.5 py-1.5`}>
      {value.map((t) => (
        <span key={t} className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1 text-sm dark:bg-slate-800">
          {t}
          <button type="button" aria-label={`Remove ${t}`} className="grid h-6 w-6 place-items-center rounded hover:bg-slate-200 dark:hover:bg-slate-700" onClick={() => onChange(value.filter((v) => v !== t))}><X size={14} /></button>
        </span>
      ))}
      <input className="min-w-24 flex-1 bg-transparent py-1 text-base outline-none" value={draft} placeholder={placeholder} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} onBlur={() => draft && add(draft)} enterKeyHint="done" />
    </div>
  )
}
