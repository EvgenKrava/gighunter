import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'

export const inputClass =
  'mt-1 block w-full min-h-11 rounded-lg border border-slate-300 bg-white px-3 text-base text-slate-900 outline-none focus:border-brand focus:ring-2 focus:ring-brand/30 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100'

export const TextInput = (p: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={`${inputClass} ${p.className ?? ''}`} />

export function NumberInput({ value, onChange, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & { value: number | undefined; onChange: (n: number | undefined) => void }) {
  return (
    <input
      {...rest}
      type="number"
      inputMode="decimal"
      className={`${inputClass} ${rest.className ?? ''}`}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
    />
  )
}

// Explicit height, not just min-h: WebKit's native menulist clamps author min-height (18px on macOS), leaving the
// select 23px tall beside a 44px text input. It does honour height, and keeps the native chevron.
export const Select = (p: SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} className={`${inputClass} h-11 ${p.className ?? ''}`} />
export const Textarea = (p: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...p} className={`${inputClass} min-h-24 py-2 ${p.className ?? ''}`} />
