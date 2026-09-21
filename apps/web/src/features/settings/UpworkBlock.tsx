import { Card } from '../../components/ui/Card'
export const UpworkBlock = () => (
  <Card className="space-y-2 opacity-80">
    <h2 className="text-lg font-semibold">Upwork <span className="ml-2 rounded bg-slate-100 px-2 py-0.5 text-xs font-normal text-slate-600 dark:bg-slate-800 dark:text-slate-300">coming soon</span></h2>
    <p className="text-sm text-slate-600 dark:text-slate-300">Upwork requires an approved API key. <a className="underline" href="https://www.upwork.com/developer/keys/apply" target="_blank" rel="noreferrer">Apply here</a> — approval takes a few weeks; the adapter lands once keys are available.</p>
  </Card>
)
