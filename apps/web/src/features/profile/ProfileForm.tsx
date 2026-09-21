import { useState } from 'react'
import { useForm } from '@tanstack/react-form'
import { Trash2 } from 'lucide-react'
import { ProfileInputSchema, SkillLevelSchema, defaultProfileFilters, type Profile, type ProfileInput } from '@gighunter/core/schema'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { Field } from '../../components/ui/Field'
import { NumberInput, Select, Textarea, TextInput } from '../../components/ui/Inputs'
import { TagInput } from '../../components/ui/TagInput'
import { Toggle } from '../../components/ui/Toggle'

const emptyProfile = (): ProfileInput => ({
  displayName: '', skills: [], budget: { min: 50, max: 500, currency: 'USD' }, maxHours: 6, languages: ['en'], stopWords: [], freeText: '', filters: defaultProfileFilters(),
})
const toInput = ({ updatedAt: _u, ...rest }: Profile): ProfileInput => rest

export function ProfileForm({ initial, onSubmit, saving }: { initial: Profile | null; onSubmit: (v: ProfileInput) => Promise<unknown>; saving: boolean }) {
  const [formErrors, setFormErrors] = useState<string[]>([])
  const form = useForm({
    defaultValues: initial ? toInput(initial) : emptyProfile(),
    onSubmit: async ({ value }) => {
      const parsed = ProfileInputSchema.safeParse(value)
      if (!parsed.success) {
        setFormErrors(parsed.error.issues.map((i) => `${i.path.join('.') || 'form'}: ${i.message}`))
        return
      }
      setFormErrors([])
      await onSubmit(parsed.data)
    },
  })

  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); e.stopPropagation(); void form.handleSubmit() }} noValidate>
      <Card className="space-y-4">
        <h2 className="text-lg font-semibold">About you</h2>
        <form.Field name="displayName" children={(f) => (
          <Field label="Display name"><TextInput value={f.state.value} onChange={(e) => f.handleChange(e.target.value)} onBlur={f.handleBlur} autoComplete="name" /></Field>
        )} />
        <form.Field name="skills" mode="array" children={(f) => (
          <div>
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Skills</span>
            <div className="mt-1 space-y-2">
              {f.state.value.map((_, i) => (
                <div key={i} className="flex items-end gap-2">
                  <form.Field name={`skills[${i}].name`} children={(sf) => (
                    <div className="min-w-0 flex-1"><TextInput aria-label="Skill name" placeholder="Skill name" className="mt-0" value={sf.state.value} onChange={(e) => sf.handleChange(e.target.value)} /></div>
                  )} />
                  <form.Field name={`skills[${i}].level`} children={(sf) => (
                    <div className="w-32 shrink-0">
                      <Select aria-label="Level" className="mt-0" value={sf.state.value} onChange={(e) => sf.handleChange(SkillLevelSchema.parse(e.target.value))}>
                        {SkillLevelSchema.options.map((l) => <option key={l} value={l}>{l}</option>)}
                      </Select>
                    </div>
                  )} />
                  <button type="button" aria-label="Remove skill" className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" onClick={() => f.removeValue(i)}><Trash2 size={18} /></button>
                </div>
              ))}
            </div>
            <Button type="button" variant="secondary" className="mt-2" onClick={() => f.pushValue({ name: '', level: 'solid' })}>Add skill</Button>
          </div>
        )} />
        <form.Field name="freeText" children={(f) => (
          <Field label="About / what you're looking for" hint="Shown to the model verbatim. Mention what you enjoy, what you avoid, and how you work.">
            <Textarea value={f.state.value} onChange={(e) => f.handleChange(e.target.value)} rows={5} maxLength={4000} />
          </Field>
        )} />
      </Card>

      <Card className="space-y-4">
        <h2 className="text-lg font-semibold">Gig size</h2>
        <div className="grid grid-cols-2 gap-3">
          <form.Field name="budget.min" children={(f) => <Field label="Min budget ($)"><NumberInput value={f.state.value} onChange={(n) => f.handleChange(n ?? 0)} min={0} /></Field>} />
          <form.Field name="budget.max" children={(f) => <Field label="Max budget ($)"><NumberInput value={f.state.value} onChange={(n) => f.handleChange(n ?? 0)} min={0} /></Field>} />
        </div>
        <form.Field name="maxHours" children={(f) => <Field label="Max hours per gig"><NumberInput value={f.state.value} onChange={(n) => f.handleChange(n ?? 0)} min={1} max={200} /></Field>} />
        <form.Field name="languages" children={(f) => (
          <Field label="Job languages" hint="Two-letter codes, e.g. en, uk, de"><TagInput value={f.state.value} onChange={f.handleChange} placeholder="Add a language code" normalize={(s) => s.trim().toLowerCase().slice(0, 2)} /></Field>
        )} />
        <form.Field name="stopWords" children={(f) => (
          <Field label="Stop words" hint="Whole-word match in title or description drops the job before scoring"><TagInput value={f.state.value} onChange={f.handleChange} placeholder="Add a stop word" /></Field>
        )} />
      </Card>

      <Card className="space-y-4">
        <h2 className="text-lg font-semibold">Pre-AI filters</h2>
        <p className="text-sm text-slate-500">Cheap rules that run before any model call. Everything here has a permissive default.</p>
        <form.Field name="filters.mustHaveAny" children={(f) => (
          <Field label="Required keywords" hint="At least one must appear; leave empty to skip"><TagInput value={f.state.value} onChange={f.handleChange} placeholder="Add a keyword" /></Field>
        )} />
        <form.Field name="filters.jobTypes" children={(f) => (
          <div className="space-y-1">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Job types</span>
            {(['fixed', 'hourly'] as const).map((t) => (
              <Toggle key={t} label={t === 'fixed' ? 'Fixed price' : 'Hourly'} checked={f.state.value.includes(t)}
                onChange={(on) => f.handleChange(on ? [...f.state.value, t] : f.state.value.filter((x) => x !== t))} />
            ))}
          </div>
        )} />
        <form.Field name="filters.minHourlyRate" children={(f) => <Field label="Min hourly rate ($/h)" hint="Applies to hourly jobs only"><NumberInput value={f.state.value} onChange={f.handleChange} min={0} /></Field>} />
        <form.Field name="filters.requirePaymentVerified" children={(f) => <Toggle label="Require payment-verified client (when the platform reports it)" checked={f.state.value} onChange={f.handleChange} />} />
        <div className="grid grid-cols-2 gap-3">
          <form.Field name="filters.minClientRating" children={(f) => <Field label="Min client rating (0–5)"><NumberInput value={f.state.value} onChange={f.handleChange} min={0} max={5} step={0.1} /></Field>} />
          <form.Field name="filters.minClientReviews" children={(f) => <Field label="Min client reviews"><NumberInput value={f.state.value} onChange={f.handleChange} min={0} /></Field>} />
        </div>
      </Card>

      {formErrors.length > 0 && (
        <div role="alert" className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:bg-red-900/20 dark:text-red-200">
          <ul className="list-disc pl-4">{formErrors.map((e) => <li key={e}>{e}</li>)}</ul>
        </div>
      )}
      <div className="sticky bottom-16 z-30 -mx-4 border-t border-slate-200 bg-white px-4 py-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] md:static md:m-0 md:border-0 md:bg-transparent md:p-0 dark:border-slate-800 dark:bg-slate-950">
        <Button type="submit" className="w-full md:w-auto" loading={saving}>Save profile</Button>
      </div>
    </form>
  )
}
