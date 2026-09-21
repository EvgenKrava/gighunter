export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)} className="flex min-h-11 items-center gap-3">
      <span className={`relative inline-block h-7 w-12 rounded-full transition ${checked ? 'bg-brand' : 'bg-slate-300 dark:bg-slate-700'}`}>
        <span className={`absolute top-1 h-5 w-5 rounded-full bg-white transition ${checked ? 'left-6' : 'left-1'}`} />
      </span>
      <span className="text-base">{label}</span>
    </button>
  )
}
